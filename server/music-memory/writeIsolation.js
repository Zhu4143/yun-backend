export function explicitMusicPreferenceStatement(text = '') {
  const value = String(text)
  return [
    /我(?:真的|很|最|一直)?(?:不喜欢|喜欢|讨厌)/,
    /记住.{0,12}(?:我)?(?:喜欢|不喜欢|讨厌)/,
    /以后.{0,12}(?:都|总是|一直|经常|每(?:天|晚|次)|睡前).{0,8}(?:听|放|播)/,
    /(?:以后别|别再|不要再).{0,12}(?:推|推荐|放|播)/,
  ].some((pattern) => pattern.test(value))
}

export function isolateInferredMusicUpdates(updates, { musicMemoryAvailable, userText } = {}) {
  if (!musicMemoryAvailable || explicitMusicPreferenceStatement(userText)) return updates
  return (Array.isArray(updates) ? updates : []).filter((update) => String(update?.category || '') !== 'music_taste')
}

// Shared by both companion result branches. This is the production boundary
// that keeps snapshot-derived inference out of the background memory extractor.
export function prepareCompanionMemoryWrites(updates, context = {}) {
  const explicitMusicPreference = explicitMusicPreferenceStatement(context.userText)
  return {
    updates: isolateInferredMusicUpdates(updates, context),
    allowBackgroundUpdate: !context.musicMemoryAvailable || explicitMusicPreference,
    explicitMusicPreference,
  }
}

export async function applyOrdinaryCompanionMemoryWrites(updates, context, applyUpdates) {
  const plan = prepareCompanionMemoryWrites(updates, context)
  return {
    ...plan,
    appliedUpdates: await applyUpdates(plan.updates),
  }
}
