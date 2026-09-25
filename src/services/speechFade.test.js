import test from 'node:test'
import assert from 'node:assert/strict'
import { fadePcm16WavTail } from './speechFade.js'

test('PCM speech fades over its tail while preserving the original buffer', () => {
  const buffer = new ArrayBuffer(44 + 16)
  const view = new DataView(buffer)
  view.setUint32(0, 0x52494646, false)
  view.setUint32(8, 0x57415645, false)
  view.setUint32(12, 0x666d7420, false)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, 0x64617461, false)
  view.setUint32(40, 16, true)
  for (let i = 0; i < 8; i += 1) view.setInt16(44 + i * 2, 1000, true)
  const faded = new DataView(fadePcm16WavTail(buffer, 500))
  assert.equal(faded.getInt16(44, true), 1000)
  assert.ok(faded.getInt16(44 + 5 * 2, true) < 1000)
  assert.equal(faded.getInt16(44 + 7 * 2, true), 0)
  assert.equal(view.getInt16(44 + 7 * 2, true), 1000)
})
