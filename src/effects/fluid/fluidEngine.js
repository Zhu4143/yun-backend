/*
 * Compact WebGL2 fluid solver adapted from Pavel Dobryakov's WebGL Fluid Simulation.
 * Original: https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 * Copyright (c) 2017 Pavel Dobryakov — MIT License, see ./LICENSE.
 */
import {
  advectionShader,
  clearShader,
  copyShader,
  curlShader,
  displayShader,
  divergenceShader,
  fullscreenVertexShader,
  gradientSubtractShader,
  pressureShader,
  splatShader,
  vorticityShader,
} from './fluidShaders'

const desktopConfig = {
  simResolution: 80,
  dyeResolution: 384,
  densityDissipation: 0.65,
  velocityDissipation: 0.32,
  pressure: 0.8,
  pressureIterations: 9,
  curl: 10,
}

const mobileConfig = {
  ...desktopConfig,
  simResolution: 56,
  dyeResolution: 256,
  pressureIterations: 7,
  curl: 7,
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(message || 'Fluid shader compilation failed')
  }
  return shader
}

function createProgram(gl, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, fullscreenVertexShader)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(message || 'Fluid program link failed')
  }
  return program
}

function resolutionFor(base, width, height) {
  const aspect = width / Math.max(height, 1)
  return aspect > 1
    ? { width: Math.round(base * aspect), height: base }
    : { width: base, height: Math.round(base / Math.max(aspect, 0.1)) }
}

export function createFluidEngine(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  })
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('WebGL2 floating-point render targets are unavailable')
  }

  const isMobile = window.matchMedia('(max-width: 720px), (pointer: coarse)').matches
  const config = { ...(isMobile ? mobileConfig : desktopConfig), ...options }
  const programs = {
    copy: createProgram(gl, copyShader),
    clear: createProgram(gl, clearShader),
    splat: createProgram(gl, splatShader),
    advection: createProgram(gl, advectionShader),
    divergence: createProgram(gl, divergenceShader),
    curl: createProgram(gl, curlShader),
    vorticity: createProgram(gl, vorticityShader),
    pressure: createProgram(gl, pressureShader),
    gradient: createProgram(gl, gradientSubtractShader),
    display: createProgram(gl, displayShader),
  }
  const resources = { textures: new Set(), framebuffers: new Set(), buffers: new Set() }
  const quad = gl.createBuffer()
  resources.buffers.add(quad)
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)

  let velocity
  let dye
  let divergence
  let curl
  let pressure
  let running = true
  let paused = false
  let raf = 0
  let previousTime = performance.now()
  let renderBrightness = 1

  const splatUniforms = {
    texelSize: gl.getUniformLocation(programs.splat, 'texelSize'),
    target: gl.getUniformLocation(programs.splat, 'uTarget'),
    aspectRatio: gl.getUniformLocation(programs.splat, 'aspectRatio'),
    point: gl.getUniformLocation(programs.splat, 'point'),
    radius: gl.getUniformLocation(programs.splat, 'radius'),
    color: gl.getUniformLocation(programs.splat, 'color'),
  }

  const bindProgram = (program) => {
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }
  const uniform = (program, name) => gl.getUniformLocation(program, name)
  const bindTexture = (program, name, texture, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(uniform(program, name), unit)
  }
  const blit = (target) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo || null)
    gl.viewport(0, 0, target?.width || canvas.width, target?.height || canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  const createFbo = (width, height, internalFormat, format) => {
    const texture = gl.createTexture()
    resources.textures.add(texture)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, gl.HALF_FLOAT, null)
    const fbo = gl.createFramebuffer()
    resources.framebuffers.add(fbo)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Fluid framebuffer is incomplete')
    }
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { texture, fbo, width, height, texelSizeX: 1 / width, texelSizeY: 1 / height }
  }
  const createDoubleFbo = (width, height, internalFormat, format) => {
    const pair = { read: createFbo(width, height, internalFormat, format), write: createFbo(width, height, internalFormat, format) }
    pair.swap = () => { const value = pair.read; pair.read = pair.write; pair.write = value }
    return pair
  }
  const disposeTargets = () => {
    resources.textures.forEach((texture) => gl.deleteTexture(texture))
    resources.framebuffers.forEach((fbo) => gl.deleteFramebuffer(fbo))
    resources.textures.clear()
    resources.framebuffers.clear()
  }
  const initFramebuffers = () => {
    disposeTargets()
    const sim = resolutionFor(config.simResolution, canvas.width, canvas.height)
    const dyeSize = resolutionFor(config.dyeResolution, canvas.width, canvas.height)
    velocity = createDoubleFbo(sim.width, sim.height, gl.RG16F, gl.RG)
    dye = createDoubleFbo(dyeSize.width, dyeSize.height, gl.RGBA16F, gl.RGBA)
    divergence = createFbo(sim.width, sim.height, gl.R16F, gl.RED)
    curl = createFbo(sim.width, sim.height, gl.R16F, gl.RED)
    pressure = createDoubleFbo(sim.width, sim.height, gl.R16F, gl.RED)
  }
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1)
    const width = Math.max(2, Math.round(canvas.clientWidth * ratio))
    const height = Math.max(2, Math.round(canvas.clientHeight * ratio))
    if (canvas.width === width && canvas.height === height && velocity && dye) return
    canvas.width = width
    canvas.height = height
    initFramebuffers()
  }

  const applySplat = (target, x, y, dx, dy, radius, color) => {
    const program = programs.splat
    bindProgram(program)
    gl.uniform2f(splatUniforms.texelSize, target.read.texelSizeX, target.read.texelSizeY)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, target.read.texture)
    gl.uniform1i(splatUniforms.target, 0)
    gl.uniform1f(splatUniforms.aspectRatio, canvas.width / Math.max(canvas.height, 1))
    gl.uniform2f(splatUniforms.point, x, y)
    gl.uniform1f(splatUniforms.radius, radius * radius)
    gl.uniform3f(splatUniforms.color, dx, dy, color)
    blit(target.write)
    target.swap()
  }

  const warmUpSplatPipeline = () => {
    // WebGL drivers often finish compiling a program on its first draw. Prime
    // the splat path off-canvas before the visible red ink begins so that the
    // one-time driver work cannot interrupt the entrance animation.
    applySplat(velocity, -4, -4, 0, 0, 0.0001, 0)
    applySplat(dye, -4, -4, 0, 0, 0.0001, 0)
    gl.finish()
  }

  const step = (dt) => {
    gl.disable(gl.BLEND)
    let program = programs.curl
    bindProgram(program)
    gl.uniform2f(uniform(program, 'texelSize'), velocity.read.texelSizeX, velocity.read.texelSizeY)
    bindTexture(program, 'uVelocity', velocity.read.texture, 0)
    blit(curl)

    program = programs.vorticity
    bindProgram(program)
    gl.uniform2f(uniform(program, 'texelSize'), velocity.read.texelSizeX, velocity.read.texelSizeY)
    bindTexture(program, 'uVelocity', velocity.read.texture, 0)
    bindTexture(program, 'uCurl', curl.texture, 1)
    gl.uniform1f(uniform(program, 'curl'), config.curl)
    gl.uniform1f(uniform(program, 'dt'), dt)
    blit(velocity.write)
    velocity.swap()

    program = programs.divergence
    bindProgram(program)
    gl.uniform2f(uniform(program, 'texelSize'), velocity.read.texelSizeX, velocity.read.texelSizeY)
    bindTexture(program, 'uVelocity', velocity.read.texture, 0)
    blit(divergence)

    program = programs.clear
    bindProgram(program)
    gl.uniform2f(uniform(program, 'texelSize'), pressure.read.texelSizeX, pressure.read.texelSizeY)
    bindTexture(program, 'uTexture', pressure.read.texture, 0)
    gl.uniform1f(uniform(program, 'value'), config.pressure)
    blit(pressure.write)
    pressure.swap()

    program = programs.pressure
    bindProgram(program)
    gl.uniform2f(uniform(program, 'texelSize'), pressure.read.texelSizeX, pressure.read.texelSizeY)
    bindTexture(program, 'uDivergence', divergence.texture, 0)
    for (let index = 0; index < config.pressureIterations; index += 1) {
      bindTexture(program, 'uPressure', pressure.read.texture, 1)
      blit(pressure.write)
      pressure.swap()
    }

    program = programs.gradient
    bindProgram(program)
    gl.uniform2f(uniform(program, 'texelSize'), velocity.read.texelSizeX, velocity.read.texelSizeY)
    bindTexture(program, 'uPressure', pressure.read.texture, 0)
    bindTexture(program, 'uVelocity', velocity.read.texture, 1)
    blit(velocity.write)
    velocity.swap()

    program = programs.advection
    bindProgram(program)
    gl.uniform2f(uniform(program, 'texelSize'), velocity.read.texelSizeX, velocity.read.texelSizeY)
    gl.uniform2f(uniform(program, 'velocityTexelSize'), velocity.read.texelSizeX, velocity.read.texelSizeY)
    bindTexture(program, 'uVelocity', velocity.read.texture, 0)
    bindTexture(program, 'uSource', velocity.read.texture, 1)
    gl.uniform1f(uniform(program, 'dt'), dt)
    gl.uniform1f(uniform(program, 'dissipation'), config.velocityDissipation)
    blit(velocity.write)
    velocity.swap()

    gl.uniform2f(uniform(program, 'texelSize'), dye.read.texelSizeX, dye.read.texelSizeY)
    gl.uniform2f(uniform(program, 'velocityTexelSize'), velocity.read.texelSizeX, velocity.read.texelSizeY)
    bindTexture(program, 'uVelocity', velocity.read.texture, 0)
    bindTexture(program, 'uSource', dye.read.texture, 1)
    gl.uniform1f(uniform(program, 'dissipation'), config.densityDissipation)
    blit(dye.write)
    dye.swap()
  }

  const render = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    const program = programs.display
    bindProgram(program)
    gl.uniform2f(uniform(program, 'texelSize'), dye.read.texelSizeX, dye.read.texelSizeY)
    gl.uniform2f(uniform(program, 'dyeTexelSize'), dye.read.texelSizeX, dye.read.texelSizeY)
    gl.uniform1f(uniform(program, 'brightness'), renderBrightness)
    bindTexture(program, 'uTexture', dye.read.texture, 0)
    blit(null)
  }

  const frame = (time) => {
    if (!running) return
    const dt = Math.min(0.022, Math.max(0.001, (time - previousTime) / 1000))
    previousTime = time
    if (!paused) {
      step(dt)
      render()
    }
    raf = requestAnimationFrame(frame)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  warmUpSplatPipeline()
  raf = requestAnimationFrame(frame)

  return {
    splat({ x, y, dx = 0, dy = 0, radius = 0.1, color = [0.025, 0.055, 0.065], intensity = 1 }) {
      applySplat(velocity, x, y, dx, dy, radius, 0)
      const gain = intensity * 0.9
      applySplat(dye, x, y, color[0] * gain, color[1] * gain, radius, color[2] * gain)
    },
    splatVelocityOnly(x, y, dx, dy, radius = 0.16) {
      applySplat(velocity, x, y, dx, dy, radius, 0)
    },
    setBrightness(value) { renderBrightness = Math.max(0, Math.min(1.2, value)) },
    setPaused(value) {
      paused = Boolean(value)
      previousTime = performance.now()
    },
    destroy() {
      if (!running) return
      running = false
      cancelAnimationFrame(raf)
      observer.disconnect()
      disposeTargets()
      Object.values(programs).forEach((program) => gl.deleteProgram(program))
      resources.buffers.forEach((buffer) => gl.deleteBuffer(buffer))
      resources.buffers.clear()
    },
  }
}
