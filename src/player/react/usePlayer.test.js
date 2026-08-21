import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlayerCore } from '../PlayerCore.js'
import { createPlayerStore } from '../playerStore.js'
import { INITIAL_PLAYER_STATE } from '../playerTypes.js'
import { PlayerContext } from './PlayerContext.js'
import { usePlayer } from './usePlayer.js'

test('usePlayer reads the PlayerCore snapshot supplied by PlayerContext', () => {
  const store = createPlayerStore({
    ...INITIAL_PLAYER_STATE,
    currentTrack: { id: 'context-track', title: 'Context Track' },
  })
  const core = new PlayerCore({ store, controls: {} })

  function CurrentTrack() {
    const { currentTrack } = usePlayer()
    return createElement('span', null, currentTrack.title)
  }

  const html = renderToStaticMarkup(
    createElement(PlayerContext.Provider, { value: core }, createElement(CurrentTrack)),
  )

  assert.equal(html, '<span>Context Track</span>')
})
