// The AudioEngine may play a standby deck during a blend, but that does not
// make it the logical listening owner. This tiny coordinator is the explicit
// handoff seam between the existing dual-deck player and ListeningSessionTracker.
export function createCrossfadeListeningOwnership({ tracker } = {}) {
  if (!tracker) throw new Error('listening_tracker_required')
  let activeDeck = null
  let activeTrack = null
  let pending = null

  function activate(deck, track) {
    activeDeck = deck
    activeTrack = track
  }

  function prepare({ fromDeck, toDeck, track, transition }) {
    pending = { fromDeck, toDeck, track, transition }
    return pending
  }

  function position(deck, positionMs) {
    if (deck === activeDeck) tracker.position(positionMs)
  }

  function commit(transaction, { positionMs, durationMs, metadata } = {}) {
    if (!transaction || pending !== transaction) return null
    const committed = tracker.commitTransition(transaction.transition, transaction.track, { positionMs, durationMs, metadata })
    if (!committed) return null
    activeDeck = transaction.toDeck
    activeTrack = transaction.track
    pending = null
    return committed
  }

  function rollback(transaction) {
    if (!transaction || pending !== transaction) return
    tracker.rollbackTransition(transaction.transition)
    pending = null
  }

  return {
    activate,
    prepare,
    position,
    commit,
    rollback,
    getActiveTrack: () => activeTrack,
    hasPending: () => Boolean(pending),
  }
}
