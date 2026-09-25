function disposeTexture(texture) {
  if (texture && typeof texture.dispose === 'function') texture.dispose()
}

export function createLatestCoverTextureLifecycle({
  loadTexture,
  prepareTexture = () => {},
  onCommit = () => {},
  onError = () => {},
}) {
  if (typeof loadTexture !== 'function') throw new TypeError('loadTexture must be a function')

  let generation = 0
  let currentTexture = null
  const retainedTextures = new Set()

  const reportLatestError = (token, source, error) => {
    if (token !== generation) return false
    onError(error, { token, source })
    return true
  }

  return {
    request(source) {
      const token = ++generation

      const handleLoad = (texture) => {
        if (token !== generation) {
          disposeTexture(texture)
          return false
        }

        try {
          prepareTexture(texture)
        } catch (error) {
          disposeTexture(texture)
          reportLatestError(token, source, error)
          return false
        }

        const previousTexture = currentTexture
        retainedTextures.add(texture)
        currentTexture = texture
        onCommit(texture, { token, source, previousTexture })
        return true
      }

      const handleError = (error) => reportLatestError(token, source, error)

      try {
        loadTexture(source, handleLoad, handleError)
      } catch (error) {
        handleError(error)
      }

      return token
    },

    cancel(token) {
      if (token !== generation) return false
      generation += 1
      return true
    },

    getCurrentTexture() {
      return currentTexture
    },

    retainOnly(textures = []) {
      const retainedByMaterial = new Set(textures.filter(Boolean))
      if (currentTexture) retainedByMaterial.add(currentTexture)

      for (const texture of retainedTextures) {
        if (retainedByMaterial.has(texture)) continue
        retainedTextures.delete(texture)
        disposeTexture(texture)
      }
    },

    dispose() {
      generation += 1
      currentTexture = null
      for (const texture of retainedTextures) disposeTexture(texture)
      retainedTextures.clear()
    },
  }
}
