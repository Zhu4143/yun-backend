import * as THREE from 'three';
import { createLiquidMetalField } from '../../components/liquidMetalField.js';
import { DEFAULT_BACKGROUND_COLORS, readCoverBackgroundColors } from '../../components/coverBackgroundPalette.js';
import { resolveLiquidMetalBackgroundSettings } from '../../components/liquidMetalSettings.js';

// The slow background field has its own pixel/update budget. Artwork and case
// optics keep their existing independent resolutions and 60 Hz motion clock.
export function liquidBackdropSize(width, height) {
  const ratio = Math.min(1, Math.sqrt(640_000 / Math.max(1, width * height)));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}

export function createCdLiquidMetalBackdrop(renderer, camera, geometry, getOptions) {
  const field = createLiquidMetalField();
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(geometry, field.material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let colors = DEFAULT_BACKGROUND_COLORS, track = 'initial', signature = '', elapsed = 0, dirty = true;

  return {
    texture: target.texture,
    setArtwork(image, key) {
      colors = readCoverBackgroundColors(image);
      track = key || 'cover';
      signature = '';
      dirty = true;
    },
    resize(width, height) {
      const size = liquidBackdropSize(width, height);
      target.setSize(size.width, size.height);
      dirty = true;
    },
    update(delta) {
      elapsed += Math.min(delta, 0.1);
      if (!dirty && elapsed < 1 / 30 - 0.0005) return;
      const { brightness = 0.72, quality = 'high', active = false, settings, getFrequencyData } = getOptions();
      const gain = THREE.MathUtils.clamp(brightness, 0.35, 1.35);
      const nextSignature = `${track}:${gain}`;
      if (signature !== nextSignature) {
        const normalize = (color, amount) => color.map(value => THREE.MathUtils.clamp(value * gain * amount / 255, 0, 1));
        field.setColors({
          base: normalize(colors.base, 0.72), primary: normalize(colors.primary, 1.16),
          secondary: normalize(colors.secondary, 1.22), accent: normalize(colors.accent, 1.08),
        }, track);
        signature = nextSignature;
      }
      const resolved = resolveLiquidMetalBackgroundSettings({ settings, quality, active });
      if (reduced) { resolved.baseFlowSpeed = 0; resolved.baseBreathAmount = 0; resolved.audioReactiveAmount = 0; }
      field.step(elapsed, { settings: resolved, active: active && !reduced, getFrequencyData }, target.width, target.height);
      elapsed = 0;
      dirty = false;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    },
    dispose() { field.dispose(); target.dispose(); },
  };
}
