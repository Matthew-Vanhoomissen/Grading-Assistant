// Display helpers shared by several components.

/**
 * Display name for a question. Titles are optional (the backend allows ''), so
 * an untitled question falls back to its position.
 *
 * @param {{title: string, position: number} | null} q - The question, if any.
 * @returns {string} "Q2. Title", "Question 2", or '' when there is no question.
 */
export function questionLabel(q) {
  if (!q) return ''
  return q.title ? `Q${q.position}. ${q.title}` : `Question ${q.position}`
}

/**
 * Formats points with at most two decimals and no trailing zeros.
 *
 * @param {number | string} n - Points, e.g. 10.0 or 2.3333.
 * @returns {string} e.g. "10" or "2.33".
 */
export function fmtPoints(n) {
  return String(Math.round(Number(n) * 100) / 100)
}
