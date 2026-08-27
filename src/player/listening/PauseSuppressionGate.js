// Programmatic pauses are tied to the exact physical media deck. An arm is
// created only when pause() can actually emit an event, then consumed before
// active-deck filtering so a post-swap old-deck event cannot leak forward.
export class PauseSuppressionGate {
  constructor() {
    this.armedDecks = new WeakSet()
  }

  arm(audio) {
    if (!audio || audio.paused) return false
    this.armedDecks.add(audio)
    return true
  }

  consume(audio) {
    if (!audio || !this.armedDecks.has(audio)) return false
    this.armedDecks.delete(audio)
    return true
  }
}
