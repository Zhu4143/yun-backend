import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { advanceMotion, createRenderClock, nextRenderRatio, renderRatios } from './frameBudget';
import { CASE, HALF, HINGE, discGeometry, lidGeometry, trayGeometry } from './caseGeometry';
import { createSleeveMotion } from './sleeveMotion';
import { createCaseTurnMotion } from './caseTurnMotion';
import { createCdLiquidOre } from './CdLiquidOre';
import { createCdLiquidMetalBackdrop } from './CdLiquidMetalBackdrop';
import { alignedRecordLayout } from '../recordSkinMotion';
import { createPlaybackMotion, playbackLayout, discFlight, DISC_CLEARANCE } from './playbackMotion';
import { COVER_FRAG, COVER_VERT } from './sleeveShaders';
import {
  BACKDROP_FRAG,
  BACKDROP_VERT,
  BRIGHT_FRAG,
  COPY_FRAG,
  DISC_FRAG,
  DISC_VERT,
  FINAL_FRAG,
  ROD_FRAG,
  ROD_VERT,
  ROOM_BAKE_FRAG,
  SCREEN_VERT,
  SHEET_FRAG,
  SHEET_VERT,
  STREAK_FRAG,
} from './shaders';

const FOV = 28;
const IOR = 1.59;
const ABSORB = [0.0042, 0.003, 0.0026];
const DEPTH = 14;
const BACKDROP_Z = -70;
const LIGHT = new THREE.Vector3(-0.3, 0.48, 1).normalize();
const SPIN = THREE.MathUtils.degToRad(18);
const SPIN_EASE = 0.9;
const FIT = 0.6;
const DOCK_CLEAR = 84;
const MSAA = 4;
const ROOM_SIZE = 512;
// Small, fast-fading glints; keep the acrylic's own reflections untouched.
const STARS = 0.4;
const STAR_SPACING = 0.55;
const STAR_FALLOFF = 0.52;
const STAR_THRESHOLD = 2.0;

const DISC_SLIDE = 141;

const GRAB_RATE = 0.008;
const GRAB_YAW = 0.9;
const GRAB_TILT = 0.45;
const GRAB_K = 16;
const GRAB_C = 5.5;
const TAP_SLOP = 6;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clamp01 = (x) => clamp(x, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function curve(frames) {
  const n = frames.length;
  const ts = frames.map((f) => f[0]);
  const vs = frames.map((f) => f[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  const m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const u = (t - ts[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * vs[i] +
      (u3 - 2 * u2 + u) * h * m[i] +
      (-2 * u3 + 3 * u2) * vs[i + 1] +
      (u3 - u2) * h * m[i + 1]
    );
  };
}

const OPEN_ANGLE = 3.05;
const OPEN_T = 2.3;
const OPEN = {
  yaw: curve([
    [0, 0],
    [0.55, 0.3],
    [1.0, 0.85],
    [1.2, 2.0],
    [1.41, 3.4],
    [1.63, 4.9],
    [1.85, 6.05],
    [2.05, 6.36],
    [2.3, 2 * Math.PI],
  ]),
  lid: curve([
    [0, 0],
    [0.97, 0],
    [1.2, 0.45],
    [1.41, 1.35],
    [1.63, 2.3],
    [1.85, 2.92],
    [2.05, 3.12],
    [2.3, OPEN_ANGLE],
  ]),
  spread: curve([
    [0, 0],
    [1.12, 0],
    [1.9, 0.9],
    [2.3, 1],
  ]),
  pitch: curve([
    [0, 0],
    [1.35, 0],
    [2.3, -0.1],
  ]),
};

const CLOSE_T = 1.95;
const CLOSE = {
  lid: curve([
    [0, OPEN_ANGLE],
    [0.22, 1.75],
    [0.48, 1.55],
    [1.05, 1.08],
    [1.42, 0.6],
    [1.6, 0.26],
    [1.7, 0],
    [1.78, 0.07],
    [1.88, 0],
  ]),
  spread: curve([
    [0, 1],
    [0.3, 0.92],
    [1.2, 0.55],
    [1.72, 0],
  ]),
  yaw: curve([
    [0, 0],
    [0.5, 0.2],
    [1.3, 0.12],
    [1.88, 0],
  ]),
  pitch: curve([
    [0, -0.1],
    [1.6, -0.05],
    [1.7, 0.035],
    [1.82, -0.01],
    [1.95, 0],
  ]),
  roll: curve([
    [0, 0],
    [0.8, -0.05],
    [1.95, 0],
  ]),
};

function sway(t, motion) {
  return {
    y: 1.8 * Math.sin(t * 1.1) * motion,
    yaw: -0.2 + (0.1 * Math.sin(t * 0.9) + 0.03 * Math.sin(t * 2.1)) * motion,
    pitch: -0.12 + 0.045 * Math.sin(t * 0.7) * motion,
    roll: 0.03 + 0.018 * Math.sin(t * 0.5) * motion,
    lid: 0,
    spread: 0,
  };
}

function createStage(container, disc, { getPaused, getSpin, getConcealed, getBackground, getRecordPresentation, onOpen, onExtracted, onReady, onFail, onArtworkReady, onArtworkError, onMotion }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = reduced ? 0 : 1;

  const canvas = document.createElement('canvas');
  canvas.className = 'cd-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    '待机唱片盒。播放时唱片移至右侧，完整显示并正对屏幕。暂停后空盒渐显，唱片归位后合盖。待机时可开合盒盖并拖动旋转。',
  );
  container.appendChild(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch {
    canvas.remove();
    onFail?.();
    return null;
  }
  let adaptiveScale = 1;
  renderer.autoClear = false;
  renderer.setClearColor(0xffffff, 0);
  const hdr =
    renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const target = (samples) =>
    new THREE.WebGLRenderTarget(1, 1, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples,
      depthBuffer: samples > 0,
      stencilBuffer: false,
      resolveDepthBuffer: false,
    });
  const rtPage = target(0);
  const rt = [target(MSAA), target(MSAA)];
  const rtBright = target(0);
  const rtStarA = target(0);
  const rtStarB = target(0);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 4000);
  const opaque = new THREE.Scene();
  const glass = new THREE.Scene();
  const hits = new THREE.Scene();

  const disposables = [];
  const track = (d) => {
    disposables.push(d);
    return d;
  };

  const screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const screenQuad = track(new THREE.PlaneGeometry(2, 2));
  const pass = (frag, uniforms) => {
    const material = track(
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: SCREEN_VERT,
        fragmentShader: frag,
        depthTest: false,
        depthWrite: false,
      }),
    );
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(screenQuad, material));
    return { scene, material };
  };
  const copyMat = track(
    new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null } },
      vertexShader: SCREEN_VERT,
      fragmentShader: COPY_FRAG,
      depthTest: false,
      depthWrite: false,
    }),
  );
  const copyQuad = new THREE.Mesh(screenQuad, copyMat);
  copyQuad.frustumCulled = false;
  copyQuad.renderOrder = -10;
  const picked = {
    uTex: { value: rtPage.texture },
    uTexInside: { value: rtPage.texture },
    uRect: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  const bright = pass(BRIGHT_FRAG, {
    ...picked,
    uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: STAR_THRESHOLD },
  });
  const streak = pass(STREAK_FRAG, {
    uTex: { value: null },
    uStep: { value: new THREE.Vector2() },
    uFalloff: { value: STAR_FALLOFF },
  });
  const final = pass(FINAL_FRAG, {
    ...picked,
    uStarA: { value: rtStarA.texture },
    uStarB: { value: rtStarB.texture },
    uStars: { value: STARS },
  });
  const liquidOre = createCdLiquidOre(renderer, screenCam, screenQuad, container);
  const liquidBackdrop = createCdLiquidMetalBackdrop(renderer, screenCam, screenQuad, getBackground);

  const roomRT = new THREE.WebGLCubeRenderTarget(ROOM_SIZE, {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  const bake = pass(ROOM_BAKE_FRAG, { uFace: { value: 0 }, uSize: { value: ROOM_SIZE } });
  const bakeRoom = () => {
    for (let face = 0; face < 6; face++) {
      bake.material.uniforms.uFace.value = face;
      renderer.setRenderTarget(roomRT, face);
      renderer.render(bake.scene, screenCam);
    }
    renderer.setRenderTarget(null);
  };
  bakeRoom();

  const shadowOf = {
    uBackdrop: { value: liquidBackdrop.texture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uLight: { value: LIGHT.clone() },
    uTrayInv: { value: new THREE.Matrix4() },
    uLidInv: { value: new THREE.Matrix4() },
    uDiscInv: { value: new THREE.Matrix4() },
    uCaseVisibility: { value: 1 },
    uScale: { value: 1 },
  };
  const backdrop = new THREE.Mesh(
    track(new THREE.PlaneGeometry(8000, 8000)),
    track(new THREE.ShaderMaterial({ uniforms: shadowOf, vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG })),
  );
  backdrop.position.z = BACKDROP_Z;
  opaque.add(backdrop);
  const depthOnly = track(new THREE.MeshBasicMaterial({ colorWrite: false }));
  glass.add(copyQuad);

  const samples = window.matchMedia('(pointer: coarse)').matches ? 1 : 2;

  const rodMaterial = () =>
    track(
      new THREE.ShaderMaterial({
        uniforms: {
          uBehind: { value: null },
          uVisibility: { value: 1 },
          uRoom: { value: roomRT.texture },
          uRoomSize: { value: ROOM_SIZE },
          uProj: { value: camera.projectionMatrix },
          uDepth: { value: DEPTH },
          uIor: { value: IOR },
          uSamples: { value: samples },
          uAbsorb: { value: new THREE.Vector3(...ABSORB) },
        },
        vertexShader: ROD_VERT,
        fragmentShader: ROD_FRAG,
      }),
    );
  const sheetMaterial = () =>
    track(
      new THREE.ShaderMaterial({
        uniforms: {
          uIor: { value: IOR },
          uVisibility: { value: 1 },
          uAbsorb: { value: new THREE.Vector3(...ABSORB) },
        },
        vertexShader: SHEET_VERT,
        fragmentShader: SHEET_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 4,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      }),
    );

  const fixed = (mesh, scene) => {
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  };

  const hitPlane = track(new THREE.PlaneGeometry(CASE, CASE));
  const hitMat = track(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));

  const discMaterial = art => track(new THREE.ShaderMaterial({
    uniforms: {
      uArt: { value: art },
      uArtIn: { value: disc.artIn },
      uPrintOut: { value: disc.printOut },
      uInkMetalness: { value: disc.inkMetalness ?? 0.9 },
    },
    vertexShader: DISC_VERT,
    fragmentShader: DISC_FRAG,
  }));

  function buildCase(art) {
    const tray = trayGeometry();
    const lid = lidGeometry();
    const discGeo = discGeometry();
    const coverGeo = track(new THREE.PlaneGeometry(CASE - 14, CASE - 14));
    for (const g of [tray.rods, tray.sheets, lid.rods, lid.sheets, discGeo]) track(g);

    const trayRodMat = rodMaterial();
    const lidRodMat = rodMaterial();
    const discMat = discMaterial(art);
    const coverMat = track(new THREE.ShaderMaterial({
      uniforms: { uArt: { value: art }, uVisibility: { value: 1 } },
      vertexShader: COVER_VERT,
      fragmentShader: COVER_FRAG,
      side: THREE.DoubleSide,
      transparent: true,
    }));
    const coverDepthMat = track(new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
    // The original centre spindle belongs to the tray. Give the loose CD its
    // own clear inner annulus so extracting it doesn't leave an oversized hole.
    const hubGeo = track(new THREE.RingGeometry(7.5, 15, 128));
    hubGeo.translate(0, 0, -1.18);
    hubGeo.setAttribute('aThick', new THREE.Float32BufferAttribute(new Float32Array(hubGeo.attributes.position.count).fill(1.2), 1));
    const hubMat = sheetMaterial();
    hubMat.side = THREE.DoubleSide;
    const discHub = new THREE.Group();
    discHub.add(new THREE.Mesh(hubGeo, hubMat));
    const rimMat = track(new THREE.MeshBasicMaterial({ color: 0xb9c0c7, transparent: true, opacity: 0.7 }));
    for (const radius of [7.6, 14.7]) {
      const rimGeo = track(new THREE.TorusGeometry(radius, 0.18, 6, 128));
      rimGeo.translate(0, 0, -1.2);
      discHub.add(new THREE.Mesh(rimGeo, rimMat));
    }

    const item = {
      trayRods: fixed(new THREE.Mesh(tray.rods, trayRodMat), glass),
      traySheets: fixed(new THREE.Mesh(tray.sheets, sheetMaterial()), glass),
      lidRods: fixed(new THREE.Mesh(lid.rods, lidRodMat), glass),
      lidSheets: fixed(new THREE.Mesh(lid.sheets, sheetMaterial()), glass),
      discMesh: fixed(new THREE.Mesh(discGeo, discMat), opaque),
      outgoingDisc: fixed(new THREE.Mesh(discGeo, discMaterial(art)), opaque),
      outgoingHub: fixed(discHub.clone(true), opaque),
      discDepth: fixed(new THREE.Mesh(discGeo, depthOnly), glass),
      discHub: fixed(discHub, opaque),
      cover: fixed(new THREE.Mesh(coverGeo, coverMat), opaque),
      coverDepth: fixed(new THREE.Mesh(coverGeo, coverDepthMat), glass),
      hitTray: fixed(new THREE.Mesh(hitPlane, hitMat), hits),
      hitLid: fixed(new THREE.Mesh(hitPlane, hitMat), hits),
      hitDisc: fixed(new THREE.Mesh(discGeo, hitMat), hits),
      trayRodMat,
      lidRodMat,
      mCase: new THREE.Matrix4(),
      mLid: new THREE.Matrix4(),
      mDisc: new THREE.Matrix4(),
      mOutgoing: new THREE.Matrix4(),
      depthTray: 0,
      depthLid: 0,
    };
    item.traySheets.renderOrder = 1;
    item.lidSheets.renderOrder = 1;
    item.discDepth.renderOrder = -5;
    item.coverDepth.renderOrder = -5;
    return item;
  }

  const pointer = { x: 0, y: 0, over: false };
  const lean = { x: 0, y: 0 };
  const grab = {
    active: false,
    start: null,
    last: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    flick: { x: 0, y: 0 },
    moved: 0,
    dist: 0,
  };
  const st = {
    t: 0,
    phase: 'rest',
    phaseAt: 0,
    closeAfter: false,
    queuedOpen: false,
    spin: 0,
    spinRate: SPIN,
    open: false,
  };
  const sleeve = createSleeveMotion({ reduced });
  const caseTurn = createCaseTurnMotion({ reduced });
  const playback = createPlaybackMotion({ reduced });
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let item = null;
  let disposed = false;
  let artTexture = null;
  let outgoingTexture = null;
  let outgoingSpin = 0;
  let artworkRequest = 0;
  let requestedArtwork = null;
  let requestedTrack = '';
  let pendingArtwork = null;
  let changingArtwork = false;
  let loadingArtwork = false;
  let lastMotion = '';
  let wasConcealed = false;
  let standbySwapRequested = false;
  let raf = 0;
  const renderClock = createRenderClock();
  let view = { w: 1, h: 1, openScale: 1, playPosition: new THREE.Vector3(), playScale: 1, enterX: 1, exitY: 1 };

  const setOpenFlag = (on) => {
    if (st.open === on) return;
    st.open = on;
    onOpen?.(on);
  };

  function startOpen() {
    if (st.phase !== 'rest') return;
    st.phase = reduced ? 'open' : 'opening';
    st.phaseAt = st.t;
    setOpenFlag(true);
  }
  function startClose() {
    if (st.phase === 'opening') {
      st.closeAfter = true;
      return;
    }
    if (st.phase !== 'open') return;
    st.phase = reduced ? 'rest' : 'closing';
    st.phaseAt = st.t;
    setOpenFlag(false);
  }
  function requestDisc(on = !sleeve.extracted) {
    if (!item || !getPaused()) return;
    sleeve.setExtracted(on);
    onExtracted?.(sleeve.extracted);
    st.queuedOpen = false;
    if (sleeve.extracted) startClose();
  }
  function toggleOpen(on = !(st.queuedOpen || st.phase === 'opening' || st.phase === 'open')) {
    if (!item || !getPaused()) return;
    if (on) {
      requestDisc(false);
      st.queuedOpen = true;
    } else {
      st.queuedOpen = false;
      startClose();
    }
  }

  function showPose(t) {
    if (playback.phase !== 'standby') {
      const open = playback.boxOpen;
      return { y: 0, yaw: lerp(-0.2, 0, open), pitch: lerp(-0.12, -0.1, open), roll: 0.03 * (1 - open), lid: OPEN_ANGLE * open, spread: open };
    }
    const p = sway(0, 0);
    const since = t - st.phaseAt;
    if (st.phase === 'opening') {
      const q = Math.min(since, OPEN_T);
      p.yaw = lerp(p.yaw, 0, clamp01(q / 1.0)) + OPEN.yaw(q);
      p.lid = OPEN.lid(q);
      p.spread = OPEN.spread(q);
      p.pitch = lerp(p.pitch, OPEN.pitch(q), clamp01(q / 1.45));
      p.roll *= 1 - clamp01(q / 1.45);
    } else if (st.phase === 'open') {
      p.yaw = 0.06 * Math.sin(t * 0.6) * motion;
      p.pitch = -0.1 + 0.02 * Math.sin(t * 0.8) * motion;
      p.roll = 0;
      p.lid = OPEN_ANGLE + 0.025 * Math.sin(t * 1.3) * motion;
      p.spread = 1;
    } else if (st.phase === 'closing') {
      const q = Math.min(since, CLOSE_T);
      const back = clamp01((q - 0.9) / (CLOSE_T - 0.9));
      const rest = easeInOut(back);
      p.yaw = lerp(CLOSE.yaw(q), p.yaw, rest);
      p.pitch = lerp(CLOSE.pitch(q), p.pitch, rest);
      p.roll = lerp(CLOSE.roll(q), p.roll, rest);
      p.lid = CLOSE.lid(q);
      p.spread = CLOSE.spread(q);
    }
    p.yaw += caseTurn.yaw;
    return p;
  }

  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, 'XYZ');
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _h = new THREE.Matrix4();
  const _hi = new THREE.Matrix4();
  const _discPosition = new THREE.Vector3();
  const _discScale = new THREE.Vector3();
  const _discRotation = new THREE.Quaternion();
  const _front = new THREE.Quaternion();
  let presentationWasActive = false;
  function place(p) {
    const presentation = getRecordPresentation();
    const handoff = presentation?.state;
    const slide = sleeve.position;
    const s = lerp(1, view.openScale, Math.max(p.spread, slide));
    // Blend inspection back to neutral before the hidden swap, then restore
    // it near the end. A previously tilted case does not snap on turn start.
    const turnInspect = caseTurn.active
      ? 1 - easeInOut(clamp01(caseTurn.progress / 0.25)) + easeInOut(clamp01((caseTurn.progress - 0.75) / 0.25)) : 1;
    const inspect = playback.phase === 'standby' ? turnInspect : 0;
    _e.set(p.pitch + (lean.x + grab.x) * inspect, p.yaw + (lean.y + grab.y) * inspect, p.roll);
    _q.setFromEuler(_e);
    _v.set((HALF * p.spread * 0.92 - DISC_SLIDE * slide * 0.5) * s, p.y, 0);
    item.mCase.compose(_v, _q, _s.setScalar(s));
    _h.makeTranslation(HINGE.x, 0, HINGE.z);
    _hi.makeTranslation(-HINGE.x, 0, -HINGE.z);
    _m.makeRotationY(-p.lid);
    item.mLid.copy(item.mCase).multiply(_h).multiply(_m).multiply(_hi);

    item.trayRods.matrix.copy(item.mCase);
    item.traySheets.matrix.copy(item.mCase);
    item.lidRods.matrix.copy(item.mLid);
    item.lidSheets.matrix.copy(item.mLid);
    item.mDisc.copy(item.mCase)
      .multiply(_m.makeTranslation(DISC_SLIDE * slide, -3 * slide, 10 * slide))
      .multiply(_m.makeRotationY(0.07 * slide));
    item.mDisc.decompose(_discPosition, _discRotation, _discScale);
    const flight = discFlight(playback.amount);
    _discPosition.lerp(view.playPosition, flight.travel);
    _discPosition.z += flight.lift;
    _discPosition.x += view.enterX * (1 - playback.incoming) * playback.amount;
    _discRotation.slerp(_front, flight.travel);
    _discScale.lerp(_s.setScalar(view.playScale), flight.travel);
    if (handoff?.active && !handoff.reduced) {
      const display = alignedRecordLayout(view.w, view.h, presentation.zoom);
      const dist = camera.position.z;
      const worldHeight = 2 * dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const scale = display.diameter / view.h * worldHeight * (dist - DISC_CLEARANCE) / dist / 120;
      _v.set(display.x / view.w * 2 - 1, 1 - display.y / view.h * 2, 0).unproject(camera).sub(camera.position);
      _v.multiplyScalar((DISC_CLEARANCE - dist) / _v.z).add(camera.position);
      _v.z = DISC_CLEARANCE + 1.2 * scale;
      _discPosition.lerp(_v, handoff.cdAlign);
      _discScale.lerp(_s.setScalar(scale), handoff.cdAlign);
      _discRotation.slerp(_front, handoff.cdAlign);
    }
    item.mDisc.compose(_discPosition, _discRotation, _discScale);
    item.discMesh.matrix.copy(item.mDisc).multiply(_m.makeRotationZ(-st.spin));
    item.discDepth.matrix.copy(item.discMesh.matrix);
    item.discHub.matrix.copy(item.discMesh.matrix);
    item.discHub.matrixWorld.copy(item.discHub.matrix);
    item.discHub.visible = slide > 0.01 || playback.amount > 0.001 || (handoff?.active && handoff.cdAlign > 0.001);
    item.outgoingDisc.matrix.copy(item.mOutgoing);
    _v.setFromMatrixPosition(item.mOutgoing);
    _v.y += view.exitY * playback.outgoing;
    item.outgoingDisc.matrix.setPosition(_v).multiply(_m.makeRotationZ(-outgoingSpin));
    item.outgoingDisc.matrixWorld.copy(item.outgoingDisc.matrix);
    item.outgoingHub.matrix.copy(item.outgoingDisc.matrix);
    item.outgoingHub.matrixWorld.copy(item.outgoingHub.matrix);
    item.outgoingDisc.visible = item.outgoingHub.visible = playback.swapping && playback.outgoing < 1;
    item.cover.matrix.copy(item.mLid).multiply(_m.makeTranslation(-3, 0, 2.6));
    item.coverDepth.matrix.copy(item.cover.matrix);
    item.hitTray.matrix.copy(item.mCase);
    item.hitLid.matrix.copy(item.mLid).multiply(_m.makeTranslation(0, 0, 4));
    item.hitDisc.matrix.copy(item.discMesh.matrix);
    for (const o of [
      item.trayRods,
      item.traySheets,
      item.lidRods,
      item.lidSheets,
      item.discMesh,
      item.discDepth,
      item.cover,
      item.coverDepth,
      item.hitTray,
      item.hitLid,
      item.hitDisc,
    ]) {
      o.matrixWorld.copy(o.matrix);
      o.visible = true;
    }
    const visibility = playback.caseOpacity * (handoff?.active && !handoff.reduced ? handoff.caseVisibility : 1);
    presentation?.publishCdPose(-st.spin, visibility > 0.001);
    for (const mesh of [item.trayRods, item.lidRods, item.traySheets, item.lidSheets, item.cover]) {
      mesh.material.uniforms.uVisibility.value = visibility;
    }
    item.cover.visible = item.coverDepth.visible = visibility > 0.001;
    _v.set(0, 0, -2).applyMatrix4(item.mCase).applyMatrix4(camera.matrixWorldInverse);
    item.depthTray = _v.z;
    _v.set(0, 0, 4).applyMatrix4(item.mLid).applyMatrix4(camera.matrixWorldInverse);
    item.depthLid = _v.z;

    shadowOf.uTrayInv.value.copy(item.mCase).invert();
    shadowOf.uLidInv.value.copy(item.mLid).invert();
    shadowOf.uDiscInv.value.copy(item.mDisc).invert();
    shadowOf.uScale.value = s;
    shadowOf.uCaseVisibility.value = visibility;
  }

  const caseAt = (x, y) => {
    if (!item || !getPaused() || playback.phase !== 'standby' || caseTurn.active) return false;
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects([item.hitTray, item.hitLid, item.hitDisc], false).length > 0;
  };

  const publishMotion = () => {
    const status = loadingArtwork ? 'loading' : caseTurn.active ? 'turning' : changingArtwork ? (playback.swapping ? 'swapping' : 'preparing') : 'idle';
    const signature = `${status}:${st.phase}:${sleeve.phase}:${playback.phase}`;
    if (signature === lastMotion) return;
    lastMotion = signature;
    onMotion?.({ status, phase: st.phase, sleeve: sleeve.phase, playback: playback.phase });
  };

  const commitArtwork = (candidate, facing = null) => {
    const previous = artTexture;
    artTexture = candidate.tex;
    item.discMesh.material.uniforms.uArt.value = candidate.tex;
    item.cover.material.uniforms.uArt.value = candidate.tex;
    liquidBackdrop.setArtwork(candidate.tex.image, candidate.track || candidate.url);
    if (previous !== outgoingTexture) previous?.dispose();
    if (!outgoingTexture) item.outgoingDisc.material.uniforms.uArt.value = candidate.tex;
    pendingArtwork = null;
    onArtworkReady?.(candidate.url, candidate.track, facing);
  };

  function advance(dt) {
    st.t += dt;
    const { t } = st;
    const handoff = getRecordPresentation()?.state;
    if (handoff?.active && !presentationWasActive && handoff.from !== 'cd-case' && (!handoff.reduced || !getPaused())) playback.presentDisc();
    presentationWasActive = Boolean(handoff?.active);

    const concealed = getConcealed();
    if (concealed && !wasConcealed) {
      playback.park();
      caseTurn.cancel(); standbySwapRequested = false;
      st.phase = 'rest'; st.queuedOpen = st.closeAfter = false;
      grab.x = grab.y = grab.vx = grab.vy = lean.x = lean.y = 0;
      setOpenFlag(false);
    }
    wasConcealed = concealed;

    // Next/Previous retain the original audio policy. If requested from a
    // paused case, finish its hidden print change before opening/extraction.
    const playing = handoff?.active ? playback.playing : !getPaused() && !concealed && !standbySwapRequested && !caseTurn.active;
    if (playing !== playback.playing) {
      playback.setPlaying(playing, showPose(t).spread);
      canvas.setAttribute('aria-label', playing ? '播放中的完整唱片，位于右侧并正对屏幕。' : '暂停：空盒渐显，唱片归位后盒盖合上。');
      sleeve.setExtracted(false);
      onExtracted?.(false);
      st.queuedOpen = false;
    }
    if (!handoff?.active) playback.step(dt);
    if (playback.phase !== 'standby') {
      st.phase = 'rest';
      st.closeAfter = false;
      setOpenFlag(playback.boxOpen > 0.5);
    }
    if (outgoingTexture && !playback.swapping) {
      outgoingTexture.dispose();
      outgoingTexture = null;
      item.outgoingDisc.material.uniforms.uArt.value = artTexture;
    }

    const want = getSpin() && !getPaused() && !reduced ? SPIN : 0;
    st.spinRate += (want - st.spinRate) * (1 - Math.exp(-dt * SPIN_EASE * 3));
    st.spin += st.spinRate * dt;
    if (handoff?.active) st.spin = -handoff.angle;
    outgoingSpin += st.spinRate * dt;

    const hover = pointer.over && !grab.active && playback.phase === 'standby' && !caseTurn.active;
    const ax = hover ? pointer.y * 0.22 : 0;
    const ay = hover ? -pointer.x * 0.35 : 0;
    const k = 1 - Math.exp(-dt * 4);
    lean.x += (ax - lean.x) * k;
    lean.y += (ay - lean.y) * k;
    if (!grab.active) {
      grab.vx += (-GRAB_K * grab.x - GRAB_C * grab.vx) * dt;
      grab.vy += (-GRAB_K * grab.y - GRAB_C * grab.vy) * dt;
      grab.x += grab.vx * dt;
      grab.y += grab.vy * dt;
    }

    const since = t - st.phaseAt;
    if (st.phase === 'opening' && since >= OPEN_T) {
      st.phase = 'open';
      st.phaseAt = t;
    } else if (st.phase === 'closing' && since >= CLOSE_T) {
      st.phase = 'rest';
      st.phaseAt = t;
    }

    if (st.phase === 'open' && st.closeAfter) {
      st.closeAfter = false;
      startClose();
    }
    sleeve.step(dt, st.phase === 'rest');
    if (st.queuedOpen && sleeve.home && playback.phase === 'standby' && st.phase === 'rest' && !changingArtwork) {
      st.queuedOpen = false;
      startOpen();
    }

    // Keep one outgoing texture alive for the exchange. Newer selections wait
    // as a single pending candidate instead of restarting a moving disc.
    if (pendingArtwork && !playback.swapping) {
      if (concealed) {
        commitArtwork(pendingArtwork);
        standbySwapRequested = false;
      } else if (standbySwapRequested && playback.phase === 'standby') {
        if (sleeve.home && st.phase === 'rest' && !grab.active) caseTurn.begin();
        else startClose();
      } else if (playing && playback.phase === 'playing') {
        if (playback.startSwap()) {
          outgoingTexture = artTexture;
          outgoingSpin = st.spin;
          item.mOutgoing.copy(item.mDisc);
          item.outgoingDisc.material.uniforms.uArt.value = outgoingTexture;
        }
        commitArtwork(pendingArtwork);
      }
    }

    caseTurn.step(dt);
    place(showPose(t));
    if (pendingArtwork && caseTurn.canCommit) {
      _v.setFromMatrixPosition(item.mCase);
      _s.copy(camera.position).sub(_v).normalize();
      _v.set(0, 0, 1).transformDirection(item.mCase);
      const facing = _v.dot(_s);
      if (caseTurn.canReplace(facing)) {
        commitArtwork(pendingArtwork, facing);
        caseTurn.commit();
      }
    } else if (caseTurn.canCommit && !loadingArtwork && !pendingArtwork) {
      // A newer cover can fail while the case waits at its back. Finish the
      // turn with the retained old print instead of parking there forever.
      caseTurn.commit();
    }
    if (!caseTurn.active && !pendingArtwork && !loadingArtwork) standbySwapRequested = false;
    changingArtwork = Boolean(pendingArtwork || loadingArtwork || playback.swapping || caseTurn.active);
    if (!pendingArtwork && !loadingArtwork && !caseTurn.active) {
      sleeve.finishSwap();
    }
    publishMotion();
  }

  const _c = new THREE.Vector3();
  function caseRect(w, h) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const m of [item.mCase, item.mLid, item.mDisc]) {
      for (let i = 0; i < 8; i++) {
        _c.set(i & 1 ? HALF + 3 : -HALF - 3, i & 2 ? HALF + 3 : -HALF - 3, i & 4 ? 7 : -7);
        _c.applyMatrix4(m).project(camera);
        x0 = Math.min(x0, _c.x);
        x1 = Math.max(x1, _c.x);
        y0 = Math.min(y0, _c.y);
        y1 = Math.max(y1, _c.y);
      }
    }
    const pad = 0.04 * Math.max(x1 - x0, y1 - y0) + 0.02;
    const px = (v) => Math.round(((v + 1) / 2) * w);
    const py = (v) => Math.round(((v + 1) / 2) * h);
    const r = {
      x: clamp(px(x0 - pad), 0, w),
      y: clamp(py(y0 - pad), 0, h),
      x1: clamp(px(x1 + pad), 0, w),
      y1: clamp(py(y1 + pad), 0, h),
    };
    return r.x1 > r.x && r.y1 > r.y ? r : null;
  }

  const groups = [];
  function draw(dt) {
    liquidBackdrop.update(dt);
    const hasLiquidOre = liquidOre.prepare(dt);
    renderer.setRenderTarget(rtPage);
    renderer.clear();
    renderer.render(opaque, camera);

    groups.length = 0;
    if (shadowOf.uCaseVisibility.value > 0.001) {
      groups.push({ depth: item.depthTray, rods: item.trayRods, sheets: item.traySheets, mat: item.trayRodMat });
      groups.push({ depth: item.depthLid, rods: item.lidRods, sheets: item.lidSheets, mat: item.lidRodMat });
    }
    groups.sort((a, b) => a.depth - b.depth);
    const glassMeshes = [item.trayRods, item.traySheets, item.lidRods, item.lidSheets];
    const w = rt[0].width;
    const h = rt[0].height;
    const rect = groups.length ? caseRect(w, h) : null;
    let from = rtPage;
    if (rect) {
      for (const r of rt) {
        // The final composite may be sampled again by Liquid Ore. Populate a
        // small halo so linear filtering at its ROI does not read stale black
        // texels outside the last scissored copy.
        const x = Math.max(0, rect.x - 2), y = Math.max(0, rect.y - 2);
        r.scissor.set(x, y, Math.min(w, rect.x1 + 2) - x, Math.min(h, rect.y1 + 2) - y);
        r.scissorTest = true;
      }
      groups.forEach((g, i) => {
        const into = rt[i % 2];
        renderer.setRenderTarget(into);
        renderer.clear();
        copyMat.uniforms.uTex.value = from.texture;
        for (const m of glassMeshes) m.visible = m === g.rods || m === g.sheets;
        g.mat.uniforms.uBehind.value = from.texture;
        renderer.render(glass, camera);
        from = into;
      });
      for (const r of rt) r.scissorTest = false;
    }
    for (const m of glassMeshes) m.visible = true;
    picked.uTexInside.value = from.texture;
    if (rect) picked.uRect.value.set(rect.x / w, rect.y / h, rect.x1 / w, rect.y1 / h);
    else picked.uRect.value.set(0, 0, 0, 0);

    // Only the acrylic rods encode spark seeds above alpha 2. The disc and
    // its hub cannot produce them. Avoid three empty post-process passes
    // after the box has faded; keep the original small glints when it returns.
    final.material.uniforms.uStars.value = rect ? STARS : 0;
    if (rect) {
      bright.material.uniforms.uTexel.value.set(1 / rtBright.width, 1 / rtBright.height);
      renderer.setRenderTarget(rtBright);
      renderer.render(bright.scene, screenCam);
      streak.material.uniforms.uTex.value = rtBright.texture;
      streak.material.uniforms.uStep.value.set(STAR_SPACING / rtBright.width, 0);
      renderer.setRenderTarget(rtStarA);
      renderer.render(streak.scene, screenCam);
      streak.material.uniforms.uStep.value.set(0, STAR_SPACING / rtBright.height);
      renderer.setRenderTarget(rtStarB);
      renderer.render(streak.scene, screenCam);
    }

    renderer.setRenderTarget(hasLiquidOre ? liquidOre.input : null);
    renderer.render(final.scene, screenCam);
    if (hasLiquidOre) liquidOre.present();
  }

  function layout() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const ratios = renderRatios(w, h, window.devicePixelRatio || 1, adaptiveScale);
    renderer.setPixelRatio(ratios.surface);
    renderer.setSize(w, h, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    rtPage.setSize(size.x, size.y);
    shadowOf.uResolution.value.copy(size);
    liquidBackdrop.resize(w, h);
    liquidOre.resize(size.x, size.y);
    const opticalWidth = Math.max(1, Math.floor(w * ratios.optics));
    const opticalHeight = Math.max(1, Math.floor(h * ratios.optics));
    for (const r of rt) r.setSize(opticalWidth, opticalHeight);
    const hw = Math.max(1, Math.round(opticalWidth / 2));
    const hh = Math.max(1, Math.round(opticalHeight / 2));
    rtBright.setSize(hw, hh);
    rtStarA.setSize(hw, hh);
    rtStarB.setSize(hw, hh);
    camera.aspect = w / h;
    const top = w <= 640 ? 40 : 28;
    const bottom = w <= 640 ? 195 : 160;
    const usableHeight = Math.max(1, h - top - bottom);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const fitH = CASE / FIT / 2 / tanHalf * h / usableHeight;
    const fitW = (CASE * 1.3) / 2 / (tanHalf * camera.aspect);
    const dist = Math.max(fitH, fitW);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(w, h, 0, (h - usableHeight) / 2 - top + DOCK_CLEAR / 2, w, h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const across = 2 * dist * tanHalf * camera.aspect;
    const display = playbackLayout(w, h);
    const worldHeight = 2 * dist * tanHalf;
    const playPosition = new THREE.Vector3(display.x / w * 2 - 1, 1 - display.y / h * 2, 0).unproject(camera);
    playPosition.sub(camera.position);
    playPosition.multiplyScalar((DISC_CLEARANCE - dist) / playPosition.z).add(camera.position);
    const playScale = display.diameter / h * worldHeight * (dist - DISC_CLEARANCE) / dist / 120;
    // The printed face is at local z=-1.2. Put that surface, rather than the
    // mesh origin behind it, on the intended screen-position ray.
    playPosition.z = DISC_CLEARANCE + 1.2 * playScale;
    view = {
      w, h, openScale: Math.min(1.04, across / (CASE * 2.25)), playPosition, playScale,
      enterX: (w - display.x + display.diameter / 2 + 24) / w * across,
      exitY: (display.y + display.diameter / 2 + 24) / h * worldHeight,
    };
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(container);
  canvas.addEventListener('webglcontextrestored', bakeRoom);

  const toNdc = (e) => {
    const r = container.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
  };
  const onMove = (e) => {
    [pointer.x, pointer.y] = toNdc(e);
    pointer.over = true;
    if (grab.active) {
      const dx = e.clientX - grab.last.x;
      const dy = e.clientY - grab.last.y;
      grab.last = { x: e.clientX, y: e.clientY };
      grab.dist = Math.max(grab.dist, Math.hypot(e.clientX - grab.start.x, e.clientY - grab.start.y));
      grab.y = clamp(grab.y + dx * GRAB_RATE, -GRAB_YAW, GRAB_YAW);
      grab.x = clamp(grab.x + dy * GRAB_RATE, -GRAB_TILT, GRAB_TILT);
      grab.flick = { x: dy * GRAB_RATE * 60, y: dx * GRAB_RATE * 60 };
      grab.moved = performance.now();
    } else {
      container.style.cursor = caseAt(pointer.x, pointer.y) ? 'pointer' : '';
    }
  };
  const onLeave = () => {
    pointer.over = false;
  };
  const onDown = (e) => {
    if (!item || e.button !== 0) return;
    const [x, y] = toNdc(e);
    if (!caseAt(x, y)) return;
    grab.active = true;
    grab.start = { x: e.clientX, y: e.clientY };
    grab.last = { x: e.clientX, y: e.clientY };
    grab.dist = 0;
    grab.flick = { x: 0, y: 0 };
    container.setPointerCapture(e.pointerId);
    container.style.cursor = 'grabbing';
  };
  const onUp = (e) => {
    if (!grab.active) return;
    grab.active = false;
    const still = performance.now() - grab.moved > 90;
    grab.vx = still ? 0 : grab.flick.x;
    grab.vy = still ? 0 : grab.flick.y;
    if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    container.style.cursor = '';
    if (e.type === 'pointerup' && grab.dist < TAP_SLOP && playback.phase === 'standby') toggleOpen();
  };
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerleave', onLeave);
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);

  const gaps = [];
  const probe = (gap) => {
    if (document.hidden || gap > 0.5) return;
    gaps.push(gap);
    if (gaps.length < 24) return;
    const ratio = renderer.getPixelRatio();
    const next = nextRenderRatio(ratio, gaps);
    gaps.length = 0;
    if (next >= ratio - 0.01) return;
    adaptiveScale *= next / ratio;
    layout();
  };
  const tick = (now) => {
    raf = 0;
    if (document.hidden || disposed) return;
    const gap = renderClock.sample(now);
    if (gap === null) { raf = requestAnimationFrame(tick); return; }
    if (!item) return;
    advanceMotion(gap, advance);
    if (!getConcealed()) {
      draw(gap);
      getRecordPresentation()?.markReady('cd-case');
      probe(gap);
    }
    raf = requestAnimationFrame(tick);
  };
  const onVisibility = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    renderClock.reset();
    gaps.length = 0;
    if (!document.hidden && item && !disposed) raf = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', onVisibility);

  const setArtwork = (url, track = '') => {
    if (url === requestedArtwork && track === requestedTrack) return;
    requestedArtwork = url;
    requestedTrack = track;
    const request = ++artworkRequest;
    if (item && !getConcealed() && (!playback.playing || caseTurn.active)) standbySwapRequested = true;
    pendingArtwork?.tex.dispose();
    pendingArtwork = null;
    loadingArtwork = true;
    changingArtwork = Boolean(item);
    publishMotion();
    new THREE.TextureLoader().loadAsync(url).then((tex) => {
      if (disposed || request !== artworkRequest) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      loadingArtwork = false;
      if (!item) {
        artTexture = tex;
        liquidBackdrop.setArtwork(tex.image, track || url);
        item = buildCase(tex);
        layout();
        onReady?.();
        onArtworkReady?.(url, track, null);
        raf = requestAnimationFrame(tick);
      } else {
        pendingArtwork = { tex, url, track };
        changingArtwork = true;
        sleeve.beginSwap();
      }
      publishMotion();
    }).catch(() => {
      if (disposed || request !== artworkRequest) return;
      requestedArtwork = null;
      loadingArtwork = false;
      changingArtwork = playback.swapping;
      publishMotion();
      onArtworkError?.();
      if (!item) onFail?.();
    });
  };
  setArtwork(disc.art);

  layout();

  return {
    setOpen: (on) => toggleOpen(on),
    setExtracted: (on) => requestDisc(on),
    setArtwork,
    getBounds() {
      if (!item) return { x: view.w * 0.37, y: view.h * 0.2, width: view.h * 0.48, height: view.h * 0.48 };
      const rect = caseRect(view.w, view.h);
      return rect ? { x: rect.x, y: view.h - rect.y1, width: rect.x1 - rect.x, height: rect.y1 - rect.y } : null;
    },
    dispose() {
      disposed = true;
      artworkRequest++;
      pendingArtwork?.tex.dispose();
      pendingArtwork = null;
      outgoingTexture?.dispose();
      outgoingTexture = null;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      ro.disconnect();
      canvas.removeEventListener('webglcontextrestored', bakeRoom);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      liquidOre.dispose();
      liquidBackdrop.dispose();
      for (const d of disposables) d.dispose();
      artTexture?.dispose();
      for (const r of [rtPage, ...rt, rtBright, rtStarA, rtStarB, roomRT]) r.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

const CaseStage = forwardRef(function CaseStage({ disc, artworkUrl, trackKey = '', paused = false, spin = true, concealed = false, background, recordPresentation, onOpen, onExtracted, onReady, onFail, onArtworkReady, onArtworkError, onArtworkChanging }, ref) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const spinRef = useRef(spin);
  spinRef.current = spin;
  const concealedRef = useRef(concealed);
  concealedRef.current = concealed;
  const backgroundRef = useRef(background);
  backgroundRef.current = background;
  const presentationRef = useRef(recordPresentation);
  presentationRef.current = recordPresentation;
  const callbacks = useRef({});
  const [appliedArtwork, setAppliedArtwork] = useState({ url: '', track: '', facing: null });
  const [motionState, setMotionState] = useState({ status: 'idle', phase: 'rest', sleeve: 'shelved' });
  callbacks.current = { onOpen, onExtracted, onReady, onFail, onArtworkReady, onArtworkError, onArtworkChanging };

  useEffect(() => {
    const stage = createStage(containerRef.current, disc, {
      getPaused: () => pausedRef.current,
      getSpin: () => spinRef.current,
      getConcealed: () => concealedRef.current,
      getBackground: () => backgroundRef.current || {},
      getRecordPresentation: () => presentationRef.current,
      onOpen: (on) => callbacks.current.onOpen?.(on),
      onExtracted: (on) => callbacks.current.onExtracted?.(on),
      onReady: () => callbacks.current.onReady?.(),
      onFail: () => callbacks.current.onFail?.(),
      onArtworkReady: (url, track, facing) => {
        setAppliedArtwork({ url, track, facing });
        callbacks.current.onArtworkReady?.(track);
      },
      onArtworkError: () => callbacks.current.onArtworkError?.(),
      onMotion: (motion) => {
        setMotionState(motion);
        callbacks.current.onArtworkChanging?.(motion.status !== 'idle');
      },
    });
    stageRef.current = stage;
    return () => {
      stage?.dispose();
      stageRef.current = null;
    };
  }, [disc]);

  useEffect(() => { stageRef.current?.setArtwork(artworkUrl || disc.art, trackKey); }, [disc, artworkUrl, trackKey]);

  useImperativeHandle(ref, () => ({
    setOpen: (on) => stageRef.current?.setOpen(on),
    setExtracted: (on) => stageRef.current?.setExtracted(on),
    setArtwork: (url, track) => stageRef.current?.setArtwork(url, track),
    getBounds: () => stageRef.current?.getBounds(),
  }), []);

  return (
    <div
      className="cd-stage"
      data-background="liquid-ore"
      data-artwork-url={appliedArtwork.url}
      data-artwork-track={appliedArtwork.track}
      data-swap-facing={appliedArtwork.facing ?? ''}
      data-change-status={motionState.status}
      data-motion-phase={motionState.phase}
      data-sleeve-phase={motionState.sleeve}
      data-playback-phase={motionState.playback || 'standby'}
      ref={containerRef}
    />
  );
});

export default CaseStage;
