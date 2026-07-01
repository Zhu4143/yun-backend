let activeAnimation = null
let savedVolume = null
let restoringVolume = null

const MIN_DUCKING_VOLUME = 0.12

function clampVolume(volume) {
  return Math.max(0, Math.min(1, Number(volume) || 0))
}

function animateVolume(audio, targetVolume, duration = 450) {
  if (!audio) return Promise.resolve()

  if (activeAnimation) {
    window.cancelAnimationFrame(activeAnimation)
    activeAnimation = null
  }

  const startVolume = clampVolume(audio.volume)
  const safeTarget = clampVolume(targetVolume)
  const startedAt = performance.now()

  return new Promise((resolve) => {
    const step = (now) => {
      const progress = duration <= 0 ? 1 : Math.min(1, (now - startedAt) / duration)
      audio.volume = startVolume + (safeTarget - startVolume) * progress

      if (progress < 1) {
        activeAnimation = window.requestAnimationFrame(step)
      } else {
        audio.volume = safeTarget
        activeAnimation = null
        resolve()
      }
    }

    activeAnimation = window.requestAnimationFrame(step)
  })
}

export function startDucking(audio, { targetVolume = 0.25, duration = 500 } = {}) {
  if (!audio || audio.paused) {
    return false
  }

  if (savedVolume == null) {
    const currentVolume = clampVolume(audio.volume)
    savedVolume = restoringVolume != null
      ? restoringVolume
      : currentVolume > 0 ? currentVolume : 1
  }

  restoringVolume = null
  const safeTarget = Math.max(MIN_DUCKING_VOLUME, clampVolume(targetVolume))

  return animateVolume(audio, Math.min(savedVolume, safeTarget), duration)
}

export function stopDucking(audio, { duration = 800 } = {}) {
  if (!audio || savedVolume == null) {
    savedVolume = null
    return Promise.resolve()
  }

  const restoreVolume = savedVolume
  savedVolume = null
  restoringVolume = restoreVolume

  return animateVolume(audio, restoreVolume, duration).then(() => {
    audio.volume = restoreVolume
    if (restoringVolume === restoreVolume) {
      restoringVolume = null
    }
  })
}

export function cancelDucking(audio) {
  if (activeAnimation) {
    window.cancelAnimationFrame(activeAnimation)
    activeAnimation = null
  }

  const restoreVolume = savedVolume ?? restoringVolume
  if (audio && restoreVolume != null) {
    audio.volume = restoreVolume
  }

  savedVolume = null
  restoringVolume = null
}
