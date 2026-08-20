export const waterVertexShader = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

export const waterFragmentShader = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform float uTime;
uniform vec2 uResolution;
uniform float uDetail;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = rotation * p * 2.03 + 17.1;
    amplitude *= 0.5;
    if (float(i) >= uDetail) break;
  }
  return value;
}

float getHeight(vec2 uv, float time) {
  float warpA = fbm(uv * 1.6 + vec2(time * 0.045, -time * 0.032));
  float warpB = fbm(uv * 2.0 + vec2(-time * 0.036, time * 0.026));
  vec2 p = uv + (vec2(warpA, warpB) - 0.5) * 0.14;

  float largeWave =
    sin(p.x * 3.2 + p.y * 1.1 + time * 0.16) * 0.45 +
    sin(p.y * 2.5 - p.x * 0.7 - time * 0.13) * 0.35;
  float midWave =
    sin((p.x * 1.1 + p.y * 0.7) * 10.0 + time * 0.36) * 0.22 +
    sin((p.x * -0.6 + p.y * 1.2) * 8.0 - time * 0.29) * 0.18;
  float fineWarp = noise(p * 5.5 + vec2(time * 0.10, -time * 0.07));
  float fineWave =
    sin((p.x * 1.35 + p.y * 0.92 + fineWarp * 0.38) * 24.0 + time * 0.46) * 0.07 +
    sin((p.x * -0.72 + p.y * 1.18 - fineWarp * 0.27) * 19.0 - time * 0.39) * 0.05;
  return largeWave * 0.50 + midWave * 0.34 + fineWave * 0.16;
}

void main() {
  vec2 uv = vUv;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);
  float e = mix(0.0042, 0.0027, step(3.0, uDetail));
  float h = getHeight(uv, uTime);
  float hx = getHeight(uv + vec2(e, 0.0), uTime);
  float hy = getHeight(uv + vec2(0.0, e), uTime);
  vec3 normal = normalize(vec3((h - hx) * 128.0, (h - hy) * 128.0, 1.0));

  vec3 lightDir = normalize(vec3(-0.35, 0.45, 0.82));
  float diffuse = max(dot(normal, lightDir), 0.0);
  float surfaceLight = clamp((diffuse - 0.62) * 2.55, 0.0, 1.0);
  float highlight = pow(diffuse, 7.0);
  float centerDistance = distance(vUv, vec2(0.5));
  float centerCalm = smoothstep(0.0, 0.32, centerDistance);
  highlight *= mix(0.56, 1.0, centerCalm);

  vec2 refractionOffset = normal.xy * 0.004;
  float deepVariation = fbm((uv + refractionOffset) * 1.25 + vec2(uTime * 0.022, -uTime * 0.016));
  vec3 baseColor = vec3(0.008, 0.016, 0.020);
  vec3 waterTint = vec3(0.025, 0.085, 0.105);
  vec3 highlightTint = vec3(0.10, 0.22, 0.25);
  vec3 color = baseColor + waterTint * (0.04 + surfaceLight * 0.52);
  color += highlightTint * highlight * 0.16;
  color += waterTint * (deepVariation - 0.5) * 0.018;
  float edgeShade = smoothstep(0.78, 0.26, distance(vUv, vec2(0.5)));
  color *= mix(0.78, 1.0, edgeShade);
  fragColor = vec4(max(color, 0.0), 1.0);
}`
