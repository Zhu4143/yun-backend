import * as THREE from 'three'

// The app theme uses modern CSS hsl() syntax, while Three.Color expects commas.
export function lyricPaletteColor(value) {
  const legacyHsl = String(value).replace(
    /^hsl\(\s*([\d.]+)\s+([\d.]+%)\s+([\d.]+%)\s*\)$/i,
    'hsl($1, $2, $3)',
  )
  return new THREE.Color(legacyHsl)
}
