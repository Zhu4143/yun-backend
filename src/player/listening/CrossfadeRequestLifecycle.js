// Crossfade requests share the playback epoch with hard replacements.  Keep
// "cancel the old transaction" separate from "register the new request" so a
// cancellation can never mistake a fresh request for its predecessor.
export function beginFreshCrossfadeRequest({ song, cancelOldCrossfade, playbackRequestGate, requestRef }) {
  cancelOldCrossfade()
  const request = playbackRequestGate.beginCrossfade(song)
  requestRef.current = request
  return request
}

// A stale completion is allowed to clean up itself, but never a newer request.
export function finalizeCrossfadeRequest({ request, playbackRequestGate, requestRef }) {
  playbackRequestGate.clear(request)
  if (requestRef.current === request) requestRef.current = null
}

export function cancelCrossfadeRequest({ transaction, playbackRequestGate, requestRef, isCrossfadingRef }) {
  const request = transaction?.playbackRequest || requestRef.current
  finalizeCrossfadeRequest({ request, playbackRequestGate, requestRef })
  isCrossfadingRef.current = false
  return request
}
