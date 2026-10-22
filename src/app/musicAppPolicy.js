// Boot is a background observation. An explicit account refresh or logout owns
// subsequent state, even if the older boot request finishes afterward.
export function createAccountReadAuthority() {
  let requestVersion = 0
  let explicitlyOwned = false
  return {
    acceptsBoot: () => !explicitlyOwned,
    beginRefresh() {
      explicitlyOwned = true
      requestVersion += 1
      return requestVersion
    },
    isCurrent: (version) => version === requestVersion,
    clear() {
      explicitlyOwned = true
      requestVersion += 1
    },
    invalidate() { requestVersion += 1 },
  }
}

const INTERACTIVE_TARGETS = [
  'a', 'button', 'input', 'textarea', 'select', 'summary', 'audio[controls]', 'video[controls]',
  '[contenteditable]:not([contenteditable="false"])', '[tabindex]:not([tabindex="-1"])',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
  '[role="switch"]', '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]', '[role="option"]', '[role="combobox"]', '[role="listbox"]',
  '[role="slider"]', '[role="spinbutton"]', '[role="treeitem"]', '[role="dialog"]',
].join(', ')

export function shouldIgnorePlaybackShortcut(event) {
  if (event.defaultPrevented) return true
  const target = event.target
  return Boolean(target?.isContentEditable || target?.closest?.(INTERACTIVE_TARGETS))
}

export function shouldPlayVoice(settings, options = {}) {
  return settings?.enabled !== false || options?.force === true
}
