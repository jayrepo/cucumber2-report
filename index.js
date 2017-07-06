'use strict'

const report = require('./lib/report')

function generate (options) {
  return report.validate(options)
    .then(report.generate)
    .then(_ => console.log('Report created successfully'))
    .catch(e => console.error('Failed to create report:\n' + e))
}

module.exports = {
  generate: generate
}
