function normalizeCount(value) {
  if (value === null || value === undefined || value === '') return null
  const count = Number(value)
  return Number.isInteger(count) && count >= 0 ? count : null
}

function itemId(item) {
  const id = item?.id
  return typeof id === 'string' || typeof id === 'number' ? String(id).trim() : ''
}

export function validateCollectionIntegrity(items, { expectedCount = null, validateItem } = {}) {
  if (!Array.isArray(items)) throw new Error('Invalid playlist collection')

  const seen = new Set()
  items.forEach((item, index) => {
    const id = itemId(item)
    if (!id || (validateItem && !validateItem(item))) {
      throw new Error(`Invalid playlist item at index ${index}`)
    }
    if (seen.has(id)) throw new Error(`Duplicate playlist id: ${id}`)
    seen.add(id)
  })

  const expected = normalizeCount(expectedCount)
  if (expected !== null && items.length !== expected) {
    throw new Error(`Playlist integrity mismatch: expected ${expected}, loaded ${items.length}`)
  }
  return true
}

export async function loadPaginatedCollection({
  fetchPage,
  pageSize = 100,
  initialPage = null,
  onProgress = () => {},
  validateItem,
  signal,
  maxPages = 1000,
} = {}) {
  if (typeof fetchPage !== 'function') throw new Error('fetchPage is required')

  const items = []
  const seen = new Set()
  let expectedCount = null
  let offset = 0
  let pageNumber = 0
  let page = initialPage

  while (pageNumber < maxPages) {
    if (signal?.aborted) throw signal.reason || new Error('Playlist loading aborted')
    const currentPage = page || await fetchPage({ offset, limit: pageSize, signal })
    page = null
    pageNumber += 1

    const pageItems = Array.isArray(currentPage?.items) ? currentPage.items : []
    const pageTotal = normalizeCount(currentPage?.total)
    if (expectedCount === null && pageTotal !== null) expectedCount = pageTotal
    if (pageTotal !== null && expectedCount !== pageTotal) {
      throw new Error(`Playlist total changed during pagination: ${expectedCount} to ${pageTotal}`)
    }

    pageItems.forEach((item, index) => {
      const id = itemId(item)
      if (!id || (validateItem && !validateItem(item))) {
        throw new Error(`Invalid playlist item at offset ${offset + index}`)
      }
      if (seen.has(id)) throw new Error(`Duplicate playlist id: ${id}`)
      seen.add(id)
      items.push(item)
    })

    const loadedCount = items.length
    const hasMore = currentPage?.hasMore ?? currentPage?.more
    const denominator = expectedCount ?? (hasMore ? loadedCount + pageSize : loadedCount)
    const progress = denominator === 0 ? 100 : Math.min(100, loadedCount / denominator * 100)
    onProgress({ loadedCount, expectedCount: denominator, progress })

    const reachedExpectedCount = expectedCount !== null && loadedCount >= expectedCount
    if (hasMore === false || reachedExpectedCount) break
    if (!pageItems.length) throw new Error('Playlist pagination returned an empty page while more items were expected')

    offset = normalizeCount(currentPage?.nextOffset) ?? offset + pageItems.length
  }

  if (pageNumber >= maxPages && expectedCount !== items.length) {
    throw new Error(`Playlist pagination exceeded ${maxPages} pages`)
  }

  validateCollectionIntegrity(items, { expectedCount, validateItem })
  return {
    items,
    loadedCount: items.length,
    expectedCount: expectedCount ?? items.length,
    complete: true,
  }
}

export function loadCompletePlaylistCache({ storage, key, version } = {}) {
  try {
    const cache = JSON.parse(storage?.getItem(key) || 'null')
    if (!cache || cache.complete !== true || cache.version !== version) return null
    if (!Number.isFinite(Number(cache.updatedAt)) || Number(cache.updatedAt) <= 0) return null
    if (normalizeCount(cache.totalItems) !== cache.items?.length) return null
    validateCollectionIntegrity(cache.items, { expectedCount: cache.totalItems })
    return cache
  } catch {
    return null
  }
}

export function saveCompletePlaylistCache({ storage, key, version, items, updatedAt = Date.now() } = {}) {
  validateCollectionIntegrity(items, { expectedCount: items?.length })
  const cache = {
    version,
    complete: true,
    totalItems: items.length,
    updatedAt,
    items,
  }
  storage?.setItem(key, JSON.stringify(cache))
  return cache
}

export function isValidPlaylist(item) {
  return Boolean(itemId(item)) && typeof item.name === 'string' && normalizeCount(item.trackCount) !== null
}

export function isValidTrack(item) {
  return Boolean(itemId(item)) && typeof item.title === 'string' && item.title.trim().length > 0
}
