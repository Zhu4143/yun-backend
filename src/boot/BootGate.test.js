import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BootGate } from './BootGate.js'

test('blocking tasks not complete cannot mount the main Yun UI', () => {
  let appMounts = 0
  const markup = renderToStaticMarkup(createElement(BootGate, {
    state: { status: 'booting' },
    renderApp: () => {
      appMounts += 1
      return createElement('main', null, 'Yun App')
    },
    renderBootScreen: () => createElement('section', null, 'Booting'),
  }))

  assert.equal(appMounts, 0)
  assert.match(markup, /Booting/)
  assert.doesNotMatch(markup, /Yun App/)
})

test('ready and degraded states mount the main Yun UI', () => {
  for (const status of ['ready', 'degraded']) {
    let appMounts = 0
    const markup = renderToStaticMarkup(createElement(BootGate, {
      state: { status },
      renderApp: () => {
        appMounts += 1
        return createElement('main', null, 'Yun App')
      },
      renderBootScreen: () => createElement('section', null, 'Booting'),
    }))

    assert.equal(appMounts, 1)
    assert.match(markup, /Yun App/)
  }
})
