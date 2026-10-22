// Keep layout observation separate from WebGL so position-only transitions
// can be verified without constructing a renderer.
export function observeRecordLayout(host, slot, layout, {
  ResizeObserver: Resize = ResizeObserver, MutationObserver: Mutation = MutationObserver,
} = {}) {
  let disposed = false
  const refresh = () => { if (!disposed) layout() }
  const resize = new Resize(refresh)
  const album = slot.parentElement
  for (const node of new Set([host, slot, album, album?.parentElement])) {
    if (node) resize.observe(node)
  }
  // Queue/editor classes can change grid placement without resizing the slot
  // or viewport. Observe only layout attributes on this immersive root.
  const mutation = new Mutation(refresh)
  const root = host.closest('.immersive-player')
  if (root) mutation.observe(root, { attributes: true, attributeFilter: ['class', 'style'] })
  return () => { disposed = true; resize.disconnect(); mutation.disconnect() }
}
