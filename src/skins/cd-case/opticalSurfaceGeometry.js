export function overlapFraction(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

export function opticalCard(rect, canvas, buffer, radius, clips = []) {
  if (rect.width < 18 || rect.height < 18) return null;
  let left = Math.max(rect.left, canvas.left);
  let right = Math.min(rect.right, canvas.right);
  let top = Math.max(rect.top, canvas.top);
  let bottom = Math.min(rect.bottom, canvas.bottom);
  for (const clip of clips) {
    // An ancestor clip is not a new rounded body. Reject it rather than
    // drawing a lens outside the DOM clipping region.
    if (left < clip.left - 1 || right > clip.right + 1 || top < clip.top - 1 || bottom > clip.bottom + 1) return null;
    left = Math.max(left, clip.left); right = Math.min(right, clip.right);
    top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
  }
  if (right - left < 14 || bottom - top < 14) return null;
  const sx = buffer.width / Math.max(1, canvas.width);
  const sy = buffer.height / Math.max(1, canvas.height);
  return {
    x: (rect.left + rect.width / 2 - canvas.left) * sx,
    y: (canvas.bottom - rect.top - rect.height / 2) * sy,
    halfWidth: rect.width / 2 * sx,
    halfHeight: rect.height / 2 * sy,
    radius: Math.min(radius, rect.width / 2, rect.height / 2) * (sx + sy) / 2,
  };
}
