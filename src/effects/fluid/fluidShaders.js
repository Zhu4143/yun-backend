/*
 * Fluid solver shaders adapted from Pavel Dobryakov's WebGL Fluid Simulation.
 * Original project: https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 * Copyright (c) 2017 Pavel Dobryakov — MIT License, see ./LICENSE.
 */

export const fullscreenVertexShader = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
uniform vec2 texelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

const header = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
`

export const copyShader = `${header}
uniform sampler2D uTexture;
void main () { fragColor = texture(uTexture, vUv); }`

export const clearShader = `${header}
uniform sampler2D uTexture;
uniform float value;
void main () { fragColor = value * texture(uTexture, vUv); }`

export const splatShader = `${header}
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main () {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / max(radius, 0.00001)) * color;
  fragColor = vec4(texture(uTarget, vUv).xyz + splat, 1.0);
}`

export const advectionShader = `${header}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 velocityTexelSize;
uniform float dt;
uniform float dissipation;
void main () {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * velocityTexelSize;
  fragColor = vec4(texture(uSource, coord).xyz / (1.0 + dissipation * dt), 1.0);
}`

export const divergenceShader = `${header}
uniform sampler2D uVelocity;
void main () {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  fragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`

export const curlShader = `${header}
uniform sampler2D uVelocity;
void main () {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  fragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`

export const vorticityShader = `${header}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main () {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  fragColor = vec4(texture(uVelocity, vUv).xy + force * dt, 0.0, 1.0);
}`

export const pressureShader = `${header}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  fragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
}`

export const gradientSubtractShader = `${header}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  fragColor = vec4(velocity, 0.0, 1.0);
}`

export const displayShader = `${header}
uniform sampler2D uTexture;
uniform vec2 dyeTexelSize;
uniform float brightness;
void main () {
  vec3 c = texture(uTexture, vUv).rgb;
  float L = length(texture(uTexture, vUv - vec2(dyeTexelSize.x, 0.0)).rgb);
  float R = length(texture(uTexture, vUv + vec2(dyeTexelSize.x, 0.0)).rgb);
  float B = length(texture(uTexture, vUv - vec2(0.0, dyeTexelSize.y)).rgb);
  float T = length(texture(uTexture, vUv + vec2(0.0, dyeTexelSize.y)).rgb);
  vec3 normal = normalize(vec3(R - L, T - B, 0.24));
  float silverEdge = pow(max(0.0, dot(normal, normalize(vec3(-0.35, 0.46, 0.82)))), 2.0);
  c += vec3(0.075, 0.105, 0.115) * silverEdge * min(0.11, length(c) * 0.45);
  c *= brightness * 0.78;
  float alpha = clamp(max(c.r, max(c.g, c.b)) * 2.9, 0.0, 0.62);
  fragColor = vec4(c, alpha);
}`
