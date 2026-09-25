export function createCrossfadeTimeline({ onTime, onDuration }) {
  let targetDeck = null
  let removeListeners = null

  const sync = () => {
    if (!targetDeck) return
    onTime(Number(targetDeck.currentTime) || 0)
    onDuration(Number.isFinite(targetDeck.duration) ? targetDeck.duration : 0)
  }

  const clear = () => {
    removeListeners?.()
    removeListeners = null
    targetDeck = null
  }

  return {
    follow(deck) {
      clear()
      targetDeck = deck
      for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked']) {
        deck.addEventListener(event, sync)
      }
      removeListeners = () => {
        for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked']) {
          deck.removeEventListener(event, sync)
        }
      }
      sync()
    },
    ignores(deck) {
      return targetDeck != null && deck !== targetDeck
    },
    clear,
  }
}
