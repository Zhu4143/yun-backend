import { useEffect, useId, useRef, useState } from 'react'

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))

const smoothstep = (edge0, edge1, value) => {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const t = clamp((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

const roundedRectSdf = (x, y, width, height, radius) => {
  const halfWidth = width * 0.5
  const halfHeight = height * 0.5
  const px = x - halfWidth
  const py = y - halfHeight
  const qx = Math.abs(px) - (halfWidth - radius)
  const qy = Math.abs(py) - (halfHeight - radius)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - radius
}

const normalize2 = (x, y) => {
  const length = Math.hypot(x, y) || 1
  return { x: x / length, y: y / length }
}

const buildOpticalFieldMap = (width, height, cornerRadius, thicknessBoost = 1) => {
  const pixelWidth = Math.max(1, Math.round(width))
  const pixelHeight = Math.max(1, Math.round(height))
  const radius = Math.min(cornerRadius, pixelWidth * 0.5 - 1, pixelHeight * 0.5 - 1)
  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return ''
  }

  const image = context.createImageData(pixelWidth, pixelHeight)
  const { data } = image
  const centerX = pixelWidth * 0.5
  const centerY = pixelHeight * 0.5
  const maxDisplacement = 12
  const centerRefractionPx = 0.8
  const edgeRefractionPx = 4.8
  const rimWidthPx = Math.max(14, Math.min(28, Math.min(pixelWidth, pixelHeight) * 0.09))
  const chromaticWidthPx = 1.4
  const epsilon = 1
  const sampleDistance = (sampleX, sampleY) =>
    roundedRectSdf(
      clamp(sampleX, 0, pixelWidth - 1),
      clamp(sampleY, 0, pixelHeight - 1),
      pixelWidth,
      pixelHeight,
      radius
    )

  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      const finalGlassDistance = sampleDistance(x, y)
      const index = (y * pixelWidth + x) * 4

      if (finalGlassDistance > 0) {
        data[index] = 128
        data[index + 1] = 128
        data[index + 2] = 0
        data[index + 3] = 0
        continue
      }

      const distanceX =
        sampleDistance(x + epsilon, y) - sampleDistance(x - epsilon, y)
      const distanceY =
        sampleDistance(x, y + epsilon) - sampleDistance(x, y - epsilon)
      const gradientNormal = normalize2(distanceX, distanceY)

      const lensNormal = normalize2(
        (x + 0.5 - centerX) / Math.max(1, centerX),
        (y + 0.5 - centerY) / Math.max(1, centerY)
      )

      const insideDistance = -finalGlassDistance
      const rimFactor = 1 - smoothstep(0.6, rimWidthPx, insideDistance)
      const curvatureBase =
        sampleDistance(x + epsilon, y) +
        sampleDistance(x - epsilon, y) +
        sampleDistance(x, y + epsilon) +
        sampleDistance(x, y - epsilon) -
        finalGlassDistance * 4
      const curvature = clamp(Math.abs(curvatureBase) * 0.85, 0, 1)
      const directionBlend = smoothstep(0, 1, rimFactor * 0.82 + curvature * 0.18)
      const refractionNormal = normalize2(
        lensNormal.x * (1 - directionBlend) + gradientNormal.x * directionBlend,
        lensNormal.y * (1 - directionBlend) + gradientNormal.y * directionBlend
      )

      const refractionPx =
        (centerRefractionPx + (edgeRefractionPx - centerRefractionPx) * rimFactor) *
        (1 + curvature * 0.28)

      const displacementX = clamp(0.5 + (refractionNormal.x * refractionPx) / maxDisplacement, 0, 1)
      const displacementY = clamp(0.5 + (refractionNormal.y * refractionPx) / maxDisplacement, 0, 1)

      const chromaticMask = Math.pow(1 - smoothstep(0.2, chromaticWidthPx, insideDistance), 1.15)
      const rimOuter = rimWidthPx * (0.78 + curvature * 0.26)
      const rimInner = 0.55 + curvature * 0.6
      const rimRise = smoothstep(rimInner, rimInner + 2.4, insideDistance)
      const rimFall = 1 - smoothstep(rimOuter * 0.52, rimOuter, insideDistance)
      const height = clamp(rimRise * rimFall * (0.9 + curvature * 0.28) * thicknessBoost, 0, 1)

      data[index] = Math.round(displacementX * 255)
      data[index + 1] = Math.round(displacementY * 255)
      data[index + 2] = Math.round(chromaticMask * 255)
      data[index + 3] = Math.round(height * 255)
    }
  }

  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

export default function UnifiedLiquidGlass({
  children,
  displacementScale = 12,
  saturation = 132,
  aberrationIntensity = 1.1,
  cornerRadius = 30,
  padding = '24px 32px',
  className = '',
  style = {},
  thicknessBoost = 1,
  highlightBoost = 1,
  transmissionDim = 0.955,
}) {
  const filterId = useId().replace(/:/g, '')
  const rootRef = useRef(null)
  const [glassSize, setGlassSize] = useState({ width: 0, height: 0 })
  const [fieldMapUrl, setFieldMapUrl] = useState('')

  useEffect(() => {
    if (!rootRef.current) return undefined

    const updateSize = () => {
      if (!rootRef.current) return
      const rect = rootRef.current.getBoundingClientRect()
      const nextWidth = Math.max(1, Math.round(rect.width))
      const nextHeight = Math.max(1, Math.round(rect.height))

      setGlassSize((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current
        }
        return { width: nextWidth, height: nextHeight }
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(rootRef.current)
    addEventListener('resize', updateSize)

    return () => {
      observer.disconnect()
      removeEventListener('resize', updateSize)
    }
  }, [])

  useEffect(() => {
    if (!glassSize.width || !glassSize.height) return
    setFieldMapUrl(buildOpticalFieldMap(glassSize.width, glassSize.height, cornerRadius, thicknessBoost))
  }, [cornerRadius, glassSize, thicknessBoost])

  const refractionScale = Math.max(8, displacementScale)
  const chromaticDelta = clamp(aberrationIntensity, 0.4, 1.5)

  return (
    <div
      ref={rootRef}
      className={className}
      style={{
        ...style,
        position: 'relative',
        borderRadius: `${cornerRadius}px`,
        overflow: 'hidden',
      }}
    >
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        style={{ position: 'absolute', pointerEvents: 'none' }}
      >
        <defs>
          <filter
            id={filterId}
            x="-8%"
            y="-8%"
            width="116%"
            height="116%"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              x="0"
              y="0"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              href={fieldMapUrl}
              result="FIELD_MAP"
            />
            <feComponentTransfer in="SourceGraphic" result="TRANSMISSION">
              <feFuncR type="linear" slope={transmissionDim} />
              <feFuncG type="linear" slope={transmissionDim} />
              <feFuncB type="linear" slope={transmissionDim} />
              <feFuncA type="linear" slope="1" />
            </feComponentTransfer>
            <feDisplacementMap
              in="TRANSMISSION"
              in2="FIELD_MAP"
              scale={refractionScale}
              xChannelSelector="R"
              yChannelSelector="G"
              result="BASE_REFRACTION"
            />

            <feDisplacementMap
              in="TRANSMISSION"
              in2="FIELD_MAP"
              scale={refractionScale + chromaticDelta}
              xChannelSelector="R"
              yChannelSelector="G"
              result="RED_SHIFT"
            />
            <feColorMatrix
              in="RED_SHIFT"
              type="matrix"
              values="
                1 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 1 0
              "
              result="RED_CHANNEL"
            />
            <feDisplacementMap
              in="TRANSMISSION"
              in2="FIELD_MAP"
              scale={refractionScale}
              xChannelSelector="R"
              yChannelSelector="G"
              result="GREEN_SHIFT"
            />
            <feColorMatrix
              in="GREEN_SHIFT"
              type="matrix"
              values="
                0 0 0 0 0
                0 1 0 0 0
                0 0 0 0 0
                0 0 0 1 0
              "
              result="GREEN_CHANNEL"
            />
            <feDisplacementMap
              in="TRANSMISSION"
              in2="FIELD_MAP"
              scale={Math.max(6, refractionScale - chromaticDelta)}
              xChannelSelector="R"
              yChannelSelector="G"
              result="BLUE_SHIFT"
            />
            <feColorMatrix
              in="BLUE_SHIFT"
              type="matrix"
              values="
                0 0 0 0 0
                0 0 0 0 0
                0 0 1 0 0
                0 0 0 1 0
              "
              result="BLUE_CHANNEL"
            />
            <feBlend in="RED_CHANNEL" in2="GREEN_CHANNEL" mode="screen" result="RG_COMBINED" />
            <feBlend in="RG_COMBINED" in2="BLUE_CHANNEL" mode="screen" result="RGB_ABERRATION" />

            <feColorMatrix
              in="FIELD_MAP"
              type="matrix"
              values="
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                0 0 1 0 0
              "
              result="EDGE_MASK"
            />
            <feComponentTransfer in="EDGE_MASK" result="EDGE_ALPHA">
              <feFuncA type="gamma" amplitude="1" exponent="0.9" offset="0" />
            </feComponentTransfer>
            <feComposite in="RGB_ABERRATION" in2="EDGE_ALPHA" operator="in" result="EDGE_ABERRATION" />
            <feBlend in="BASE_REFRACTION" in2="EDGE_ABERRATION" mode="screen" result="REFRACTED_GLASS" />

            <feColorMatrix
              in="FIELD_MAP"
              type="matrix"
              values="
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 1 0
              "
              result="HEIGHT_MAP"
            />
            <feSpecularLighting
              in="HEIGHT_MAP"
              surfaceScale={2.45 * thicknessBoost}
              specularConstant={0.58 * highlightBoost}
              specularExponent="22"
              lightingColor="rgb(255,255,255)"
              result="HIGHLIGHT_RAW"
            >
              <feDistantLight azimuth="222" elevation="42" />
            </feSpecularLighting>
            <feComponentTransfer in="HIGHLIGHT_RAW" result="HIGHLIGHT">
              <feFuncA type="linear" slope={0.68 * highlightBoost} />
            </feComponentTransfer>
            <feBlend in="REFRACTED_GLASS" in2="HIGHLIGHT" mode="screen" result="GLASS_WITH_HIGHLIGHT" />

            <feSpecularLighting
              in="HEIGHT_MAP"
              surfaceScale={2.1 * thicknessBoost}
              specularConstant={0.28 * highlightBoost}
              specularExponent="14"
              lightingColor="rgb(255,255,255)"
              result="INNER_SHADOW_LIGHT"
            >
              <feDistantLight azimuth="42" elevation="26" />
            </feSpecularLighting>
            <feColorMatrix
              in="INNER_SHADOW_LIGHT"
              type="matrix"
              values="
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 ${0.16 * thicknessBoost} 0
              "
              result="INNER_SHADOW_ALPHA"
            />
            <feFlood floodColor="rgb(0,0,0)" result="INNER_SHADOW_COLOR" />
            <feComposite
              in="INNER_SHADOW_COLOR"
              in2="INNER_SHADOW_ALPHA"
              operator="in"
              result="INNER_SHADOW"
            />
            <feBlend in="GLASS_WITH_HIGHLIGHT" in2="INNER_SHADOW" mode="multiply" result="FINAL_GLASS" />
            <feComposite in="FINAL_GLASS" in2="SourceGraphic" operator="atop" />
          </filter>
        </defs>
      </svg>

      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          background: 'rgba(255,255,255,0.012)',
          backdropFilter: `brightness(${transmissionDim}) saturate(${saturation}%)`,
          WebkitBackdropFilter: `brightness(${transmissionDim}) saturate(${saturation}%)`,
          filter: fieldMapUrl ? `url(#${filterId})` : undefined,
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          padding,
        }}
      >
        {children}
      </div>
    </div>
  )
}
