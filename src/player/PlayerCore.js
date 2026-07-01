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

  setPlaybackMode = (...args) => this.controls.setPlaybackMode(...args)
}

