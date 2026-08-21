export class PlayerCore {
  constructor({ store, controls }) {
    this.store = store
    this.controls = controls
  }

  getState = () => this.store.getState()

  subscribe = (listener) => this.store.subscribe(listener)

  play = (...args) => this.controls.play(...args)

  pause = (...args) => this.controls.pause(...args)

  togglePlay = (...args) => this.controls.togglePlay(...args)

  next = (...args) => this.controls.next(...args)

  previous = (...args) => this.controls.previous(...args)

  seek = (...args) => this.controls.seek(...args)

  playTrack = (...args) => this.controls.playTrack(...args)

  playTrackFromQueue = (...args) => this.controls.playTrackFromQueue(...args)

  setPlaybackQueue = (...args) => this.controls.setPlaybackQueue(...args)

  clearPlaybackQueue = (...args) => this.controls.clearPlaybackQueue(...args)

  setQueuedNextTrack = (...args) => this.controls.setQueuedNextTrack(...args)

  enqueueUpNext = (...args) => this.controls.enqueueUpNext(...args)

  removeUpNext = (...args) => this.controls.removeUpNext(...args)

  clearUpNext = (...args) => this.controls.clearUpNext(...args)

  setAutoUpNext = (...args) => this.controls.setAutoUpNext(...args)

  removeAutoUpNext = (...args) => this.controls.removeAutoUpNext(...args)

  clearAutoUpNext = (...args) => this.controls.clearAutoUpNext(...args)

  // Read-only transition boundary for the existing `music.get_state` action.
  // useLocalPlayer remains the owner; remove this passthrough when AudioEngine
  // diagnostics receive their final contract during the ownership migration.
  getPlaybackDiagnostics = (...args) => this.controls.getPlaybackDiagnostics(...args)

  setVolume = (...args) => this.controls.setVolume(...args)

  setPlaybackMode = (...args) => this.controls.setPlaybackMode(...args)
}
