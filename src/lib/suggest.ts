/**
 * Past values to offer under a text box while typing: only once something is typed, starts-with matches
 * first, then contains matches, skipping the exact text typed and anything in `exclude` (case-insensitive).
 * Used instead of a native <datalist>, whose picker on Android takes over the screen and dismisses the keyboard.
 */
export function suggest(query: string, pool: string[], exclude: string[] = [], max = 6): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const skip = new Set(exclude.map((e) => e.toLowerCase()))
  const matches = pool.filter((n) => {
    const l = n.toLowerCase()
    return l !== q && !skip.has(l) && l.includes(q)
  })
  const starts = matches.filter((n) => n.toLowerCase().startsWith(q))
  return [...starts, ...matches.filter((n) => !n.toLowerCase().startsWith(q))].slice(0, max)
}
