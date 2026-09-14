function normalizeCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

export function describePlaylistTrackPage({ body = {}, songCount, offset, limit } = {}) {
  const loaded = normalizeCount(songCount) ?? 0;
  const pageOffset = normalizeCount(offset) ?? 0;
  const pageLimit = Math.max(1, normalizeCount(limit) ?? 1);
  const explicitTotal = normalizeCount(body.total) ?? normalizeCount(body.playlist?.trackCount);
  const explicitMore = typeof body.more === 'boolean' ? body.more : null;
  const hasMore = explicitMore ?? (
    loaded >= pageLimit
    && (explicitTotal === null || pageOffset + loaded < explicitTotal)
  );

  return {
    hasMore,
    total: explicitTotal ?? (hasMore ? null : pageOffset + loaded),
  };
}
