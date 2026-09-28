import assert from 'node:assert/strict'
import test from 'node:test'

import { MicrophoneOwnerStateMachine } from './MicrophoneOwnerStateMachine.js'

test('native microphone ownership retries finitely before requesting browser fallback', () => {
  const owner = new MicrophoneOwnerStateMachine({ maxNativeRetries: 3 })
  owner.nativeReady()
  owner.nativeDisconnected()

  assert.deepEqual(
    [owner.reconnectFailed(), owner.reconnectFailed(), owner.reconnectFailed(), owner.reconnectFailed()],
    ['retry', 'retry', 'retry', 'fallback'],
  )
  assert.equal(owner.getSnapshot().owner, 'handoff')
  assert.equal(owner.getSnapshot().status, 'fallback-pending')
})

test('recovery hands capture from browser to native one owner at a time', () => {
  const owner = new MicrophoneOwnerStateMachine()
  owner.browserFallbackStarted()
  assert.equal(owner.getSnapshot().owner, 'browser')

  assert.equal(owner.beginNativeRecovery(), true)
  assert.equal(owner.getSnapshot().owner, 'handoff')
  owner.nativeRecoveryFailed()
  assert.equal(owner.getSnapshot().owner, 'browser')

  owner.beginNativeRecovery()
  owner.nativeRecovered()
  assert.equal(owner.getSnapshot().owner, 'native')
  assert.equal(owner.getSnapshot().status, 'native-listening')
})

test('disabling wake releases the microphone owner', () => {
  const owner = new MicrophoneOwnerStateMachine()
  owner.browserFallbackStarted()
  owner.disable()

  assert.deepEqual(owner.getSnapshot(), {
    owner: 'none',
    status: 'off',
    retryCount: 0,
    maxNativeRetries: 3,
  })
})
