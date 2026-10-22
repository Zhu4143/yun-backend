// Three broad currents share a cheap analytic warp. No particles, extra scene,
// texture blur or per-frame image analysis is needed for the moving colours.
export const LIQUID_COLOR_FLOW_GLSL = `
vec3 flowHue(vec3 color) {
  return color / max(max(color.r, max(color.g, color.b)), 0.001);
}
vec3 liquidColorFlow(vec2 uv, float aspect, float seconds, vec3 base, vec3 primary, vec3 secondary, vec3 accent) {
  float t = seconds * 0.16;
  vec2 p = uv;
  p += 0.085 * vec2(sin(uv.y * 4.4 + t), cos(uv.x * 4.0 - t * 0.8));
  p += 0.035 * vec2(cos(p.y * 7.0 - t * 0.65), sin(p.x * 6.0 + t * 0.7));
  vec2 a = vec2(0.23 + 0.18 * sin(t * 0.65), 0.69 + 0.17 * cos(t * 0.51));
  vec2 b = vec2(0.78 + 0.16 * cos(t * 0.57), 0.59 + 0.22 * sin(t * 0.63));
  vec2 c = vec2(0.48 + 0.28 * sin(t * 0.43 + 2.2), 0.16 + 0.16 * cos(t * 0.71));
  vec2 stretch = vec2(clamp(aspect, 0.75, 1.5), 1.0);
  vec2 da = (p - a) * stretch, db = (p - b) * stretch, dc = (p - c) * stretch;
  float wa = exp(-dot(da, da) * 6.0);
  float wb = exp(-dot(db, db) * 6.5);
  float wc = exp(-dot(dc, dc) * 7.0);
  return (flowHue(primary) * wa + flowHue(secondary) * wb + flowHue(accent) * wc + flowHue(base) * 0.035)
    / (wa + wb + wc + 0.035);
}
`
