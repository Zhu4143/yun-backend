import { waterFragmentShader, waterVertexShader } from './waterBackgroundShaders'

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(message || 'Water background shader compilation failed')
  }
  return shader
}

export function createWaterBackgroundEngine(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false })
  if (!gl) throw new Error('WebGL2 is unavailable for the water background')

  const vertex = compile(gl, gl.VERTEX_SHADER, waterVertexShader)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, waterFragmentShader)
  const program = gl.createProgram()
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(message || 'Water background program link failed')
  }

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  gl.useProgram(program)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const timeLocation = gl.getUniformLocation(program, 'uTime')
  const resolutionLocation = gl.getUniformLocation(program, 'uResolution')
  const detailLocation = gl.getUniformLocation(program, 'uDetail')
  const mobile = window.matchMedia('(max-width: 720px), (pointer: coarse)').matches
  const renderScale = mobile ? 0.4 : 0.52
  let running = true
  let paused = document.visibilityState === 'hidden'
  let raf = 0
  let elapsedTime = 0
  let previousFrame = performance.now()
  let lastRenderTime = previousFrame

  const resize = () => {
    const width = Math.max(2, Math.round(canvas.clientWidth * renderScale))
    const height = Math.max(2, Math.round(canvas.clientHeight * renderScale))
    if (canvas.width === width && canvas.height === height) return
    canvas.width = width
    canvas.height = height
    gl.viewport(0, 0, width, height)
  }
  const render = (now) => {
    if (!running) return
    if (now - lastRenderTime < 32) {
      raf = requestAnimationFrame(render)
      return
    }
    if (!paused) {
      elapsedTime += Math.min(64, Math.max(0, now - lastRenderTime)) / 1000
      resize()
      gl.useProgram(program)
      gl.uniform1f(timeLocation, elapsedTime)
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height)
      gl.uniform1f(detailLocation, mobile ? 2 : 3)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    lastRenderTime = now
    previousFrame = now
    raf = requestAnimationFrame(render)
  }
  const onVisibilityChange = () => {
    paused = document.visibilityState === 'hidden'
    previousFrame = performance.now()
    lastRenderTime = previousFrame
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  document.addEventListener('visibilitychange', onVisibilityChange)
  resize()
  raf = requestAnimationFrame(render)

  return {
    destroy() {
      if (!running) return
      running = false
      cancelAnimationFrame(raf)
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      gl.deleteBuffer(quad)
      gl.deleteProgram(program)
    },
  }
}
