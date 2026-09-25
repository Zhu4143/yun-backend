// Direct Three.js adapter for the source implementation in:
// C:/Users/zhudo/WorkBuddy/2026-09-14-15-08-58/liquid-ore/src
//
// The optical equations and defaults below are copied from glass.frag.js,
// blur.frag.js and morph.js. The only integration changes are:
// - sample the music app's rendered scene instead of liquidField.js;
// - use vUv because Three.js owns the fullscreen geometry;
// - expand the source's four-card arrays for the app's visible UI surfaces;
// - keep morph energy/direction per card so one moving panel does not light
//   every other card in the shared pass.

export const LIQUID_ORE_MAX_CARDS = 48
export const LIQUID_ORE_STORAGE_KEY = 'vfx-params:liquid-ore/glass'

export const LIQUID_ORE_GLASS_DEFAULTS = Object.freeze({
  frost: 4,
  refractionHeight: 58,
  refractionAmount: 74,
  chromatic: 0.12,
  saturation: 1.3,
  tint: 0.35,
  specular: 0.6,
  shadow: 0.42,
  edgeWidth: 24,
  hoverGlow: 0.42,
  hoverScale: 0.045,
  hoverRefract: 0.55,
  bounce: 0.62,
})

export const LIQUID_ORE_CONTROL_GROUPS = Object.freeze([
  {
    id: 'hover',
    label: 'Hover',
    controls: [
      { key: 'hoverGlow', label: '光晕强度', min: 0, max: 1.2, step: 0.02, digits: 2 },
      { key: 'hoverScale', label: '放大比例', min: 0, max: 0.12, step: 0.005, digits: 3 },
      { key: 'hoverRefract', label: '折射加强', min: 0, max: 1.5, step: 0.02, digits: 2 },
    ],
  },
  {
    id: 'frost',
    label: '雾化',
    controls: [
      { key: 'frost', label: '雾化程度', min: 0, max: 20, step: 0.5, digits: 1 },
    ],
  },
  {
    id: 'refraction',
    label: '折射',
    controls: [
      { key: 'refractionHeight', label: 'Refraction height', min: 4, max: 120, step: 1, digits: 0, suffix: ' px' },
      { key: 'refractionAmount', label: 'Refraction amount', min: 0, max: 160, step: 1, digits: 0, suffix: ' px' },
      { key: 'chromatic', label: 'Chromatic aberration', min: 0, max: 0.7, step: 0.01, digits: 2 },
      { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.02, digits: 2 },
    ],
  },
  {
    id: 'surface',
    label: '表面',
    controls: [
      { key: 'tint', label: '玻璃提亮', min: 0, max: 2, step: 0.02, digits: 2 },
      { key: 'specular', label: '边缘高光', min: 0, max: 1.5, step: 0.02, digits: 2 },
      { key: 'edgeWidth', label: '高光带宽度', min: 2, max: 80, step: 1, digits: 0, suffix: ' px' },
      { key: 'shadow', label: '外阴影', min: 0, max: 1.6, step: 0.02, digits: 2 },
    ],
  },
  {
    id: 'motion',
    label: '展开动效',
    controls: [
      { key: 'bounce', label: 'Q 弹回弹', min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
])

export const liquidOreGlassState = { ...LIQUID_ORE_GLASS_DEFAULTS }

const clampSetting = (value, min, max) => Math.max(min, Math.min(max, Number(value)))
const controlByKey = new Map(
  LIQUID_ORE_CONTROL_GROUPS.flatMap((group) => group.controls).map((control) => [control.key, control]),
)

export function applyLiquidOreGlassSettings(settings) {
  for (const [key, value] of Object.entries(settings || {})) {
    const control = controlByKey.get(key)
    if (!control || !Number.isFinite(Number(value))) continue
    liquidOreGlassState[key] = clampSetting(value, control.min, control.max)
  }
  return { ...liquidOreGlassState }
}

export function loadLiquidOreGlassSettings() {
  if (typeof window === 'undefined') return { ...liquidOreGlassState }
  try {
    const stored = JSON.parse(window.localStorage.getItem(LIQUID_ORE_STORAGE_KEY) || 'null')
    if (stored) applyLiquidOreGlassSettings(stored)
  } catch {
    // Source paramStore also treats unavailable/invalid storage as non-fatal.
  }
  return { ...liquidOreGlassState }
}

export function saveLiquidOreGlassSettings() {
  const snapshot = { ...liquidOreGlassState }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LIQUID_ORE_STORAGE_KEY, JSON.stringify(snapshot))
  }
  return snapshot
}

export function resetLiquidOreGlassSettings() {
  return applyLiquidOreGlassSettings(LIQUID_ORE_GLASS_DEFAULTS)
}

export function stepLiquidOreHover(spring, delta, target) {
  const dt = Math.min(Math.max(Number(delta) || 0, 0), 0.05)
  const acceleration = (target - spring.progress) * 190 - spring.velocity * 17
  const velocity = spring.velocity + acceleration * dt
  return {
    progress: spring.progress + velocity * dt,
    velocity,
  }
}

loadLiquidOreGlassSettings()

export const LIQUID_ORE_BLUR_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec2 uTexel;
  uniform vec2 uDir;
  uniform float uRadius;

  const int STEPS = 6;

  void main() {
    vec3 sum = texture2D(uTex, vUv).rgb;
    float wsum = 1.0;

    for (int i = 1; i <= STEPS; i++) {
      float fi = float(i);
      float w = exp(-0.5 * fi * fi / 5.0);
      float off = uRadius * fi / float(STEPS);
      vec2 d = uDir * off * uTexel;
      sum += texture2D(uTex, vUv + d).rgb * w;
      sum += texture2D(uTex, vUv - d).rgb * w;
      wsum += 2.0 * w;
    }

    gl_FragColor = vec4(sum / wsum, 1.0);
  }
`

export const LIQUID_ORE_GLASS_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D uScene;
  uniform sampler2D uBlurred;
  uniform vec2 uResolution;
  uniform int uCardCount;
  uniform vec4 uCards[${LIQUID_ORE_MAX_CARDS}];
  uniform float uCardRadius[${LIQUID_ORE_MAX_CARDS}];

  uniform float uRefractionHeight;
  uniform float uRefractionAmount;
  uniform float uChromatic;
  uniform float uSaturation;
  uniform float uTint;
  uniform float uSpecular;
  uniform float uShadow;
  uniform float uEdgeWidth;

  uniform vec2 uPointer;
  uniform float uHover[${LIQUID_ORE_MAX_CARDS}];
  uniform float uHoverGlow;
  uniform float uHoverScale;
  uniform float uHoverRefract;
  uniform float uMorphEnergy[${LIQUID_ORE_MAX_CARDS}];
  uniform vec2 uMorphDir[${LIQUID_ORE_MAX_CARDS}];

  float sdRoundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  vec2 sdRoundedBoxGrad(vec2 p, vec2 b, float r) {
    vec2 s = vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
    vec2 q = abs(p) - b + r;
    if (max(q.x, q.y) > 0.0) {
      return s * normalize(max(q, vec2(0.0)) + vec2(1e-5));
    }
    return q.x > q.y ? vec2(s.x, 0.0) : vec2(0.0, s.y);
  }

  void main() {
    vec2 fc = gl_FragCoord.xy;
    vec2 uv = fc / uResolution;
    vec3 col = texture2D(uScene, uv).rgb;

    float mask = 0.0;
    vec2 disp = vec2(0.0);
    float spec = 0.0;
    float glow = 0.0;
    float sweep = 0.0;
    float nearest = 1e9;

    for (int i = 0; i < ${LIQUID_ORE_MAX_CARDS}; i++) {
      if (i >= uCardCount) break;
      vec2 half2 = uCards[i].zw;
      if (half2.x <= 0.0 || half2.y <= 0.0) continue;

      float hov = uHover[i];
      vec2 ctr = uCards[i].xy;
      float sc = 1.0 + uHoverScale * hov;
      vec2 p = (fc - ctr) / sc;
      float d = sdRoundedBox(p, half2, uCardRadius[i]) * sc;
      nearest = min(nearest, d);

      float inside = 1.0 - smoothstep(-1.2, 1.2, d);
      if (inside <= 0.001) continue;

      float t = clamp(-d / max(uRefractionHeight, 1.0), 0.0, 1.0);
      float hgt = sqrt(t);
      vec2 grad = sdRoundedBoxGrad(p, half2, uCardRadius[i]);
      disp += grad * (1.0 - hgt) * inside * (1.0 + uHoverRefract * hov);

      float rim = 1.0 - hgt;
      vec2 toPtr = normalize(uPointer - fc + vec2(1e-5));
      float facing = clamp(dot(grad, toPtr), 0.0, 1.0);
      float morphBoost = 1.0 + uMorphEnergy[i] * 2.4;
      spec = max(spec, pow(rim, 2.4) * inside * (1.0 + 1.8 * hov * facing) * morphBoost);

      float dirFacing = clamp(dot(grad, uMorphDir[i]), 0.0, 1.0);
      sweep = max(sweep, pow(rim, 3.0) * dirFacing * inside * uMorphEnergy[i]);

      float gd = length(fc - uPointer) / max(max(half2.x, half2.y) * sc, 1.0);
      glow += exp(-gd * gd * 5.5) * hov;
      mask = max(mask, inside);
    }

    if (mask > 0.001) {
      vec2 off = disp * uRefractionAmount / uResolution;
      vec3 glass;
      glass.r = texture2D(uBlurred, uv + off * (1.0 + uChromatic)).r;
      glass.g = texture2D(uBlurred, uv + off).g;
      glass.b = texture2D(uBlurred, uv + off * (1.0 - uChromatic)).b;

      float lum = dot(glass, vec3(0.2126, 0.7152, 0.0722));
      glass = mix(vec3(lum), glass, uSaturation);
      glass = glass * (1.0 + 0.055 * uTint) + vec3(0.012, 0.014, 0.018) * uTint;
      col = mix(col, glass, mask);
    }

    col += vec3(1.0, 0.94, 0.84) * glow * uHoverGlow * mask;
    col += vec3(1.0, 0.97, 0.92) * sweep * 1.1 * mask;

    if (mask > 0.001) {
      float band = smoothstep(0.0, uEdgeWidth, -nearest);
      col += vec3(1.0, 0.99, 0.96) * spec * uSpecular * (1.0 - band * 0.55);
    }

    float outer = smoothstep(0.0, 38.0, nearest);
    col *= 1.0 - (1.0 - outer) * uShadow * 0.42;
    gl_FragColor = vec4(col, 1.0);
  }
`
