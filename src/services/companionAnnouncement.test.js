import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseCompanionAnnouncementLength } from './companionAnnouncement.js'

test('companion transitions vary between short, medium and longer remarks', () => {
  assert.equal(chooseCompanionAnnouncementLength(() => 0.1), 'short')
  assert.equal(chooseCompanionAnnouncementLength(() => 0.5), 'medium')
  assert.equal(chooseCompanionAnnouncementLength(() => 0.9), 'long')
})
