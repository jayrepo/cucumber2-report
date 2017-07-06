'use strict'
const path = require('path')
const fs = require('fs-extra')

function getTemplate (file = 'templates/template.mustache') {
  return fs.readFile(file, 'utf8')
}

async function getPartials (folder = 'templates/partials') {
  const partials = {}
  const files = await fs.readdir(folder)
  const filePromises = files.map(async file => {
    partials[file.split('.')[0]] = await fs.readFile(path.join(folder, file), 'utf8')
  })
  await Promise.all(filePromises)
  return partials
}

exports.getTemplate = getTemplate
exports.getPartials = getPartials
