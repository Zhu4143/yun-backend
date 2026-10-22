import { createForegroundMask, createPortraitAnchors, removePortraitBackgroundSpill, updatePortraitTargets } from './portraitMotion.js'

// The worker owns the spatial history; returned copies can be transferred
// without detaching the next frame's previous particle assignments.
export function createPortraitFrameProcessor(initial = null) {
  let uvs = initial?.uvs?.slice(), colors = initial?.colors?.slice(), anchors = null
  return ({ rgba, width, height, pointCount }) => {
    const mask = createForegroundMask(rgba, width, height, { tolerance: 6 })
    const rgb = removePortraitBackgroundSpill(rgba, mask, width, height)
    if (!uvs || uvs.length !== pointCount * 2) {
      uvs = new Float32Array(pointCount * 2)
      colors = new Float32Array(pointCount * 3)
      anchors = createPortraitAnchors(mask, width, height, pointCount)
    }
    if (!updatePortraitTargets({ mask, rgb, width, height, anchors: anchors || uvs, uvs, colors })) return null
    return { uvs: uvs.slice(), colors: colors.slice() }
  }
}

// One in-flight frame provides backpressure. A clip/turn change invalidates
// its reply rather than allowing a late video frame to overwrite the new pose.
export function createPortraitFrameQueue({ worker, onFrame, onError, onIdle = () => {} }) {
  let pending = null, generation = 0, nextId = 0, disposed = false, failed = false
  const fail = (error) => {
    if (disposed || failed) return
    failed = true
    pending = null
    worker.terminate()
    onError(error)
  }
  worker.onmessage = ({ data }) => {
    if (disposed || failed || !pending || data.id !== pending.id) return
    const completed = pending
    pending = null
    if (data.error) { fail(new Error(data.error)); return }
    if (completed.generation === generation && data.result) onFrame(data.result, completed.context)
    onIdle()
  }
  worker.onerror = fail
  worker.onmessageerror = fail
  return {
    get busy() { return Boolean(pending) },
    submit(frame, context) {
      if (disposed || failed || pending) return false
      pending = { id: ++nextId, generation, context }
      try { worker.postMessage({ id: pending.id, frame }, [frame.rgba.buffer]) }
      catch (error) { fail(error); return false }
      return true
    },
    invalidate() { generation += 1 },
    dispose() {
      disposed = true
      pending = null
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      worker.terminate()
    },
  }
}
