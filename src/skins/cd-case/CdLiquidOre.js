import * as THREE from 'three';
import {
  LIQUID_ORE_MAX_CARDS, LIQUID_ORE_BLUR_FRAGMENT_SHADER,
  LIQUID_ORE_GLASS_FRAGMENT_SHADER, liquidOreGlassState, stepLiquidOreHover,
} from '../../components/liquidOreSource';
import { opticalCard, overlapFraction } from './opticalSurfaceGeometry';
import { SCREEN_VERT } from './shaders';

const BODIES = [
  '.status-card', '.top-controls-card', '.player-card', '.voice-popover',
  '.memory-settings-panel', '.ai-mode-expanded', '.chat-panel', '.memory-strip',
  '.ai-popover', '.moss-command-panel', '.yun-login-panel', '.voice-pickup-glass',
  '.liquid-morph-layer', 'button:not(.settings-panel-backdrop)',
].join(',');
const EXCLUDED = '.cd-case-background, .cd-library, .library-edge-trigger, [data-layout-editor-ui]';
const OPEN_ONLY = '.top-controls-card, .voice-popover, .memory-settings-panel, .ai-mode-expanded, .chat-panel, .ai-popover, .moss-command-panel';

// Direct source-shader adapter. It shares CaseStage's renderer, output size,
// clock and scene texture, and never mounts the particle Canvas/voice pass.
export function createCdLiquidOre(renderer, camera, geometry, container) {
  const app = container.closest('.app');
  if (!app) return { resize() {}, prepare() { return false; }, present() {}, dispose() {} };
  const canvas = renderer.domElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const materials = [];
  const target = () => new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
  const input = target(), horizontalTarget = target(), verticalTarget = target();
  const makePass = (fragmentShader, uniforms, defines = {}) => {
    const material = new THREE.ShaderMaterial({ vertexShader: SCREEN_VERT, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false });
    materials.push(material);
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { material, scene };
  };
  const blur = (texture, direction) => makePass(LIQUID_ORE_BLUR_FRAGMENT_SHADER, {
    uTex: { value: texture }, uDir: { value: direction },
    uTexel: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 4 },
  });
  const horizontal = blur(input.texture, new THREE.Vector2(1, 0));
  const vertical = blur(horizontalTarget.texture, new THREE.Vector2(0, 1));
  const uniforms = {
    uScene: { value: input.texture }, uBlurred: { value: verticalTarget.texture },
    uResolution: { value: new THREE.Vector2(1, 1) }, uCardCount: { value: 0 },
    uCards: { value: Array.from({ length: LIQUID_ORE_MAX_CARDS }, () => new THREE.Vector4()) },
    uCardRadius: { value: new Float32Array(LIQUID_ORE_MAX_CARDS) },
    uPointer: { value: new THREE.Vector2(-100000, -100000) },
    uHover: { value: new Float32Array(LIQUID_ORE_MAX_CARDS) },
    uMorphEnergy: { value: new Float32Array(LIQUID_ORE_MAX_CARDS) },
    uMorphDir: { value: Array.from({ length: LIQUID_ORE_MAX_CARDS }, () => new THREE.Vector2(0, 1)) },
    uBodyColor: { value: new THREE.Color(0.065, 0.085, 0.12) }, uBodyOpacity: { value: 0.72 },
  };
  const settings = {
    uRefractionHeight: 'refractionHeight', uRefractionAmount: 'refractionAmount',
    uChromatic: 'chromatic', uSaturation: 'saturation', uTint: 'tint',
    uSpecular: 'specular', uShadow: 'shadow', uEdgeWidth: 'edgeWidth',
    uHoverGlow: 'hoverGlow', uHoverScale: 'hoverScale', uHoverRefract: 'hoverRefract',
  };
  for (const [uniform, key] of Object.entries(settings)) uniforms[uniform] = { value: liquidOreGlassState[key] };
  const glass = makePass(LIQUID_ORE_GLASS_FRAGMENT_SHADER, uniforms, { LIQUID_ORE_BODY_TINT: 1 });
  let dirty = true, frame = 0;
  let visible = [];
  let canvasRect, buffer = { width: 1, height: 1 };
  const pointer = { x: -100000, y: -100000 };
  const hover = new WeakMap();
  const onMove = event => { pointer.x = event.clientX; pointer.y = event.clientY; };
  const onLeave = () => { pointer.x = pointer.y = -100000; };
  app.addEventListener('pointermove', onMove, { passive: true });
  app.addEventListener('pointerleave', onLeave);
  const observer = new MutationObserver(() => { dirty = true; });
  observer.observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  const scan = () => {
    visible = [...app.querySelectorAll(BODIES)]
      .filter(node => !node.closest(EXCLUDED) && !node.parentElement?.closest(BODIES))
      .flatMap(node => {
        // The particle pass normally owns top-controls visibility. Its closed
        // DOM shell can still have opacity 1, so honour the React open state.
        if (node.matches(OPEN_ONLY) && !node.classList.contains('is-open')) return [];
        const style = getComputedStyle(node);
        if (Number(style.opacity) <= 0.08 || style.visibility === 'hidden' || style.display === 'none') return [];
        const clips = [];
        for (let parent = node.parentElement; parent && parent !== app; parent = parent.parentElement) {
          const parentStyle = getComputedStyle(parent);
          if (Number(parentStyle.opacity) <= 0.08 || parentStyle.visibility === 'hidden') return [];
          if (/(hidden|clip|scroll|auto)/.test(`${parentStyle.overflowX} ${parentStyle.overflowY}`)) clips.push(parent.getBoundingClientRect());
        }
        return [{ node, radius: parseFloat(style.borderRadius) || 18, clips }];
      });
    dirty = false;
  };
  return {
    input,
    resize(width, height) {
      buffer = { width, height };
      canvasRect = canvas.getBoundingClientRect();
      input.setSize(width, height);
      const w = Math.max(1, Math.floor(width / 2)), h = Math.max(1, Math.floor(height / 2));
      horizontalTarget.setSize(w, h); verticalTarget.setSize(w, h);
      horizontal.material.uniforms.uTexel.value.set(1 / w, 1 / h);
      vertical.material.uniforms.uTexel.value.set(1 / w, 1 / h);
      uniforms.uResolution.value.set(width, height);
      dirty = true;
    },
    prepare(dt) {
      if (dirty || ++frame % 6 === 0) scan();
      const records = visible.map(record => ({ ...record, rect: record.node.getBoundingClientRect() }));
      const morphs = records.filter(record => record.node.matches('.liquid-morph-layer'));
      let count = 0;
      uniforms.uHover.value.fill(0); uniforms.uMorphEnergy.value.fill(0);
      for (const { node, rect, radius, clips } of records) {
        const morph = node.matches('.liquid-morph-layer');
        if (!morph && morphs.some(shell => overlapFraction(shell.rect, rect) > 0.6)) continue;
        const card = opticalCard(rect, canvasRect, buffer, morph ? parseFloat(node.style.borderRadius) || radius : radius, clips);
        if (!card || count >= LIQUID_ORE_MAX_CARDS) continue;
        uniforms.uCards.value[count].set(card.x, card.y, card.halfWidth, card.halfHeight);
        uniforms.uCardRadius.value[count] = card.radius;
        const hovered = node.matches(':hover') ? 1 : 0;
        const spring = reduced ? { progress: hovered, velocity: 0 }
          : stepLiquidOreHover(hover.get(node) || { progress: 0, velocity: 0 }, dt, hovered);
        hover.set(node, spring);
        uniforms.uHover.value[count] = Math.max(0, Math.min(1.12, spring.progress));
        uniforms.uMorphEnergy.value[count] = Math.max(0, Math.min(1, Number(node.dataset.morphEnergy) || 0));
        const dx = Number(node.dataset.morphDirX), dy = Number(node.dataset.morphDirY);
        uniforms.uMorphDir.value[count].set(Number.isFinite(dx) ? dx : 0, Number.isFinite(dy) ? -dy : 1);
        count++;
      }
      uniforms.uCardCount.value = count;
      const sx = buffer.width / Math.max(1, canvasRect.width), sy = buffer.height / Math.max(1, canvasRect.height);
      uniforms.uPointer.value.set((pointer.x - canvasRect.left) * sx, (canvasRect.bottom - pointer.y) * sy);
      const ratio = (sx + sy) / 2;
      for (const [uniform, key] of Object.entries(settings)) {
        uniforms[uniform].value = liquidOreGlassState[key] * (['refractionHeight', 'refractionAmount', 'edgeWidth'].includes(key) ? ratio : 1);
      }
      horizontal.material.uniforms.uRadius.value = vertical.material.uniforms.uRadius.value = liquidOreGlassState.frost;
      if (container.dataset.opticalCards !== String(count)) container.dataset.opticalCards = String(count);
      return count > 0;
    },
    present() {
      const frost = liquidOreGlassState.frost > 0;
      if (frost) {
        renderer.setRenderTarget(horizontalTarget); renderer.render(horizontal.scene, camera);
        renderer.setRenderTarget(verticalTarget); renderer.render(vertical.scene, camera);
      }
      uniforms.uBlurred.value = frost ? verticalTarget.texture : input.texture;
      renderer.setRenderTarget(null); renderer.render(glass.scene, camera);
      if (app.dataset.cdOptics !== 'liquid-ore') app.dataset.cdOptics = 'liquid-ore';
    },
    dispose() {
      observer.disconnect();
      app.removeEventListener('pointermove', onMove); app.removeEventListener('pointerleave', onLeave);
      delete app.dataset.cdOptics; delete container.dataset.opticalCards;
      for (const material of materials) material.dispose();
      for (const rt of [input, horizontalTarget, verticalTarget]) rt.dispose();
    },
  };
}
