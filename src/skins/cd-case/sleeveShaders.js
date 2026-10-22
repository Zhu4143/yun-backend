export const COVER_VERT = `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vUv = uv;
    vN = normalize(normalMatrix * normal);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    vP = p.xyz;
    gl_Position = projectionMatrix * p;
  }
`;

export const COVER_FRAG = `
  uniform sampler2D uArt;
  uniform float uVisibility;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vec3 V = normalize(-vP);
    vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 L = normalize(vec3(-0.3, 0.48, 1.0));
    vec4 art = texture2D(uArt, vUv);
    vec3 paper = gl_FrontFacing ? mix(vec3(0.94), art.rgb, art.a) : vec3(0.92);
    vec2 edge = min(vUv, 1.0 - vUv);
    float print = smoothstep(0.001, 0.004, min(edge.x, edge.y));
    paper = mix(vec3(0.92), paper, print);
    float light = 0.80 + 0.20 * max(dot(N, L), 0.0);
    float gloss = pow(max(dot(N, normalize(L + V)), 0.0), 85.0) * 0.12;
    gl_FragColor = vec4(paper * light + gloss, uVisibility);
  }
`;
