const trackKeyOf = track => String(track?.id || track?.fileUrl || '');

// The existing player may recover a stalled stream after the first play()
// promise aborts. Observe that recovery without submitting another play call.
// A playing flag alone can be stale; require progress on the selected track.
export async function waitForPlaybackRecovery({
  readState,
  trackKey,
  isCurrent = () => true,
  timeoutMs = 6000,
  now = () => performance.now(),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  if (!readState || !trackKey) return false;
  const deadline = now() + timeoutMs;
  let previousPosition = null;
  while (isCurrent() && now() < deadline) {
    const state = readState();
    const position = Number(state?.currentTime);
    if (state?.isPlaying && trackKeyOf(state.currentTrack) === trackKey && Number.isFinite(position)) {
      if (previousPosition !== null && position > previousPosition + 0.05) return true;
      previousPosition = position;
    } else previousPosition = null;
    await wait(200);
  }
  return false;
}
