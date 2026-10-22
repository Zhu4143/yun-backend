import { createPortraitFrameProcessor } from './portraitFrameProcessing.js'

const processFrame = createPortraitFrameProcessor()
self.onmessage = ({ data }) => {
  try {
    const result = processFrame(data.frame)
    self.postMessage({ id: data.id, result }, result ? [result.uvs.buffer, result.colors.buffer] : [])
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message })
  }
}
