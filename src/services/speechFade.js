export function fadePcm16WavTail(buffer, fadeMs = 900) {
  const source = new DataView(buffer)
  if (source.byteLength < 44 || source.getUint32(0, false) !== 0x52494646) return buffer
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let dataOffset = 0
  let dataSize = 0
  while (offset + 8 <= source.byteLength) {
    const id = source.getUint32(offset, false)
    const size = source.getUint32(offset + 4, true)
    if (id === 0x666d7420 && size >= 16) {
      if (source.getUint16(offset + 8, true) !== 1 || source.getUint16(offset + 22, true) !== 16) return buffer
      channels = source.getUint16(offset + 10, true)
      sampleRate = source.getUint32(offset + 12, true)
    }
    if (id === 0x64617461) {
      dataOffset = offset + 8
      dataSize = Math.min(size, source.byteLength - dataOffset)
    }
    offset += 8 + size + (size % 2)
  }
  if (!sampleRate || !channels || !dataSize) return buffer
  const output = buffer.slice(0)
  const view = new DataView(output)
  const frameCount = Math.floor(dataSize / (channels * 2))
  const fadeFrames = Math.min(frameCount, Math.max(1, Math.floor(sampleRate * fadeMs / 1000)))
  for (let frame = frameCount - fadeFrames; frame < frameCount; frame += 1) {
    const gain = (frameCount - frame - 1) / fadeFrames
    for (let channel = 0; channel < channels; channel += 1) {
      const byte = dataOffset + (frame * channels + channel) * 2
      view.setInt16(byte, Math.round(view.getInt16(byte, true) * gain), true)
    }
  }
  return output
}
