const fs = require('fs-extra')
const moment = require('moment')
const Mustache = require('mustache')
const path = require('path')
require('moment-duration-format')
const template = require('./template.js')
const failedLinks = [
  {key:'Error_4XX', value: [], active: true},
  {key:'Error_5XX', value: []},
  {key:'FPO', value: []},
  {key:'Other', value: []}
]
const calculateResult = function (result, tags=[]) {
  const features = result.features
  return features
    .filter(feature => feature.elements)
    .map(feature => {
      feature.duration = 0
      feature.status = 'passed'
      feature.tagStr = feature.tags.reduce((pre, cur) => {
        return pre + ' ' + cur.name
      }, '') || ''
      if (tags.length > 1) {
        feature.classNames = feature.tagStr.replace(/@/g, '').trim()
      }
      feature.elements.map(scenario => {
        scenario.duration = 0
        scenario.status = 'passed'
        scenario.featureTagStr = feature.tagStr
        scenario.tagStr = scenario.tags
          .reduce((pre, cur) => {
            return cur.line > 1 ? pre + ' ' + cur.name : pre
          }, '')
        scenario.steps = scenario.steps
          .map(step => {
            if (step.embeddings) {
              handleEmbeddings(step, scenario)
            }
            if (step.hidden) {
              return
            }
            const duration = step.result.duration
            if (duration) {
              step.time = formatDuration(duration)
              scenario.duration += step.result.duration
            } else {
              step.time = '0s'
            }
            step.status = step.result.status
            result.summary.step[step.status] += 1
            if (step.status === 'failed') {
              scenario.status = 'failed'
            }
            return step
          })
        .filter(step => step)
        scenario.time = formatDuration(scenario.duration)
        result.summary.scenario[scenario.status] += 1
        if (scenario.status === 'failed') {
          feature.status = 'failed'
        }
        feature.duration += scenario.duration
        return scenario
      })
      feature.time = formatDuration(feature.duration)
      result.summary.feature[feature.status] += 1
      return feature
    })
}
const handleEmbeddings = function (step, scenario) {
  step.embeddings.map(embedding => {
    if (embedding.mime_type === 'application/json') {
      step.json = JSON.parse(embedding.data)
      if (step.json.failed > 0) {
        const results = step.json.results
        results.filter(result => result.status === 'failed')
          .map(result => {
            result.tag = scenario.featureTagStr
            const code = '' + result.code
            const fromArray = [result.from]
            function findRedirect (result) {
              if (result.from !== results[0].url && result.from !== '') {
                const newFrom = results.filter(r => r.url === result.from)[0]
                fromArray.push(newFrom.from ? newFrom.from : results[0].url)
                findRedirect(newFrom)
              }
            }
            findRedirect(result)
            if (fromArray.length > 1) result.from = fromArray.reverse()
            if (code.startsWith('4')) failedLinks[0].value.push(result)
            else if (code.startsWith('5')) failedLinks[1].value.push(result)
            else if (code.startsWith('FPO')) failedLinks[2].value.push(result)
            else failedLinks[3].value.push(result)
          })
      }
    } else if (embedding.mime_type === 'text/imagename') {
      if (step.hidden) {
        scenario.image = embedding.data
      } else {
        if (!Array.isArray(step.image)) {
          step.image = []
        }
        step.image.push(embedding.data)
      }
    } else if (embedding.mime_type === 'text/plain') {
      step.text = embedding.data
    }
  })
}
const validateOption = async function (options) {
  if (!await fs.exists(options.source)) {
    return Promise.reject('Input file ' + options.source + ' does not exist! Aborting')
  }

  if (options.template && !await fs.exists(options.template)) {
    return Promise.reject('Template file ' + options.template + ' does not exist! Aborting')
  }

  if (options.partials && !await fs.existsSync(options.partials)) {
    return Promise.reject('Template partials folder ' + options.template + ' does not exist! Aborting')
  }

  options.dest = options.dest || './reports'
  options.config = options.config || {}
  return Promise.resolve(options)
}
const generateReport = async function (options) {
  const resultOutput = await fs.readJson(options.source || './test/result.json')
  options.config.time = moment().format('MM/DD/YYYY HH:mm:ss')
  const result = {
    features: resultOutput,
    summary: {
      feature: {passed: 0, failed: 0},
      scenario: {passed: 0, failed: 0},
      step: {passed: 0, failed: 0, skipped: 0}
    },
    config: options.config
  }
  const tag = result.config.tag
  let tags = []
  if (tag && tag.includes('@top10')) {
    tags = tag.split(' or ').map(tag => tag.replace(/[()]/g,''))
      .filter(tag => tag !== '@top10')
  }
  result.features = calculateResult(result, tags)
  result.tags = tags
  const loadtime = result.features.filter(feature => feature.elements)
    .map(feature => feature.elements).reduce((a, b) => (a.concat(b)), [])
    .map(scenario => scenario.steps).reduce((a, b) => (a.concat(b)), [])
    .filter(step => (step.name && step.name.includes('I go to')))
    .map(step => ({
      url:step.name.replace('I go to ', '').replace(' page', ''),
      time:step.result.duration / 1000
    }))
    .sort((a, b) => (b.time - a.time))
  const tplReport = await template.getTemplate()
  const partials = await template.getPartials()
  const renderedReport = Mustache.render(tplReport, result, partials)
  const tplLink = await template.getTemplate('templates/link.mustache')
  const tplLoad = await template.getTemplate('templates/loadtime.mustache')
  const renderedLink = Mustache.render(tplLink, {links: failedLinks})
  const renderedLoad = Mustache.render(tplLoad, {time: loadtime})
  return Promise.all([
    fs.outputFile(path.join(options.dest, 'report.html'), renderedReport),
    fs.outputFile(path.join(options.dest, 'link.html'), renderedLink),
    fs.outputFile(path.join(options.dest, 'time.html'), renderedLoad),
    fs.outputFile(path.join(options.dest, 'summary.js'), 'var summary =' + JSON.stringify(result.summary)),
    fs.outputJson(path.join(options.dest, 'link.json'), failedLinks)
  ])
}

const formatDuration = function (duration) {
  return moment.duration(duration).format('h[h] m[m] s[s]')
}

module.exports = {
  generate: generateReport,
  validate: validateOption
}

