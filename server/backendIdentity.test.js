import assert from 'node:assert/strict'
import test from 'node:test'

import { createBackendIdentity, isCompatibleBackendHealth, YUN_BACKEND_API_VERSION } from './backendIdentity.js'

test('backend health identity reports app, API, and source build versions', () => {
  assert.deepEqual(createBackendIdentity({ appVersion: '1.2.3', buildHash: 'abc123-dirty' }), {
    service: 'yun-backend',
    apiVersion: 1,
    appVersion: '1.2.3',
    buildHash: 'abc123-dirty',
  })
})

test('only the matching Yun API version is compatible with the desktop renderer', () => {
  assert.equal(isCompatibleBackendHealth({ ok: true, service: 'yun-backend', apiVersion: YUN_BACKEND_API_VERSION }), true)
  assert.equal(isCompatibleBackendHealth({ ok: true, service: 'yun-backend' }), false)
  assert.equal(isCompatibleBackendHealth({ ok: true, service: 'yun-backend', apiVersion: YUN_BACKEND_API_VERSION + 1 }), false)
  assert.equal(isCompatibleBackendHealth({ ok: true, service: 'other', apiVersion: YUN_BACKEND_API_VERSION }), false)
})
