import { INITIAL_PLAYER_STATE } from './playerTypes.js'

export function createPlayerStore(initialState = INITIAL_PLAYER_STATE) {
  let state = initialState
  const listeners = new Set()

  return {
    getState() {
      return state
    },

    replaceState(nextState) {
      state = nextState
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    emit() {
      listeners.forEach((listener) => listener())
    },

    clear() {
      listeners.clear()
    },
  }
}
