// Shared call-and-report helper for the setup panels.

/**
 * Runs one API call for a panel and reports the result.
 *
 * The response (or the failed request's body) goes to the Raw JSON panel through
 * `onResponse`, and a failure's message goes to the panel's own error state, so
 * callers only need to check for null.
 *
 * @param {string} label - Request description for Raw JSON, e.g. "POST /api/assignments".
 * @param {() => Promise<{status: number, body: any}>} fn - The API call to run.
 * @param {object} handlers
 * @param {(label: string, body: any) => void} handlers.onResponse - Reports to the Raw JSON panel.
 * @param {(message: string | null) => void} handlers.setError - The panel's error setter; cleared before the call.
 * @returns {Promise<{status: number, body: any} | null>} The response, or null if the call failed.
 */
export async function callApi(label, fn, { onResponse, setError }) {
  setError(null)
  try {
    const res = await fn()
    onResponse(`${label} -> ${res.status}`, res.body)
    return res
  } catch (err) {
    setError(err.message)
    onResponse(`${label} (failed)`, err.body ?? null)
    return null
  }
}
