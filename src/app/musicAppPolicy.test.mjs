import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccountReadAuthority, shouldIgnorePlaybackShortcut, shouldPlayVoice } from './musicAppPolicy.js'

test('a late boot account can upgrade first-page data until the user owns account state', async () => {
  const authority = createAccountReadAuthority()
  let resolveBoot
  const boot = new Promise((resolve) => { resolveBoot = resolve })
  let account = { loggedIn: true, playlists: ['first page'] }
  const applying = boot.then((result) => { if (authority.acceptsBoot()) account = result })
  resolveBoot({ loggedIn: true, playlists: ['complete collection'] })
  await applying
  assert.deepEqual(account.playlists, ['complete collection'])
})

test('logout prevents a delayed boot and a previously started refresh from restoring the account', async () => {
  const authority = createAccountReadAuthority()
  const refreshVersion = authority.beginRefresh()
  let account = { loggedIn: true }
  authority.clear()
  account = { loggedIn: false }
  await Promise.resolve()
  if (authority.acceptsBoot()) account = { loggedIn: true, source: 'stale boot' }
  if (authority.isCurrent(refreshVersion)) account = { loggedIn: true, source: 'stale refresh' }
  assert.equal(account.loggedIn, false)
})

test('refresh claims account ownership before its network result, and teardown invalidates it', () => {
  const authority = createAccountReadAuthority()
  const first = authority.beginRefresh()
  assert.equal(authority.acceptsBoot(), false)
  const second = authority.beginRefresh()
  assert.equal(authority.isCurrent(first), false)
  assert.equal(authority.isCurrent(second), true)
  authority.invalidate()
  assert.equal(authority.isCurrent(second), false)
})

test('an already handled or editable key remains owned by its original interaction', () => {
  assert.equal(shouldIgnorePlaybackShortcut({ defaultPrevented: true, target: null }), true)
  assert.equal(shouldIgnorePlaybackShortcut({ defaultPrevented: false, target: { isContentEditable: true } }), true)
  assert.equal(shouldIgnorePlaybackShortcut({ defaultPrevented: false, target: { closest: () => ({ tagName: 'SUMMARY' }) } }), true)
  assert.equal(shouldIgnorePlaybackShortcut({ defaultPrevented: false, target: { closest: () => null } }), false)
})

test('automatic-reading off mutes ordinary replies while an explicit forced announcement remains possible', () => {
  assert.equal(shouldPlayVoice({ enabled: false }), false)
  assert.equal(shouldPlayVoice({ enabled: false }, { force: false }), false)
  assert.equal(shouldPlayVoice({ enabled: false }, { force: true }), true)
  assert.equal(shouldPlayVoice({ enabled: true }), true)
})
