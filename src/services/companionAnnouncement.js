export function chooseCompanionAnnouncementLength(random = Math.random) {
  const value = random()
  if (value < 0.28) return 'short'
  if (value < 0.78) return 'medium'
  return 'long'
}
