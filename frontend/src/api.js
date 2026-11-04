// API client for the Flask backend, plus the switch to the in-browser mock.
// Every method resolves to { status, body } so the UI can show exactly what
// came back in the Raw JSON panel. Paths and shapes follow the API contract in
// CLAUDE.md section 12.

import * as mock from './mockApi.js'

/** True when VITE_USE_MOCK is "true" (see .env.development); every call then goes to mockApi.js. */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

/**
 * Sends one request and parses the response.
 *
 * Plain objects are sent as JSON; FormData is sent as-is so the browser sets
 * the multipart boundary. Non-2xx responses throw an Error whose message
 * includes the backend's reason, with the parsed response attached as `body`.
 *
 * @param {string} method - HTTP method.
 * @param {string} url - Same-origin path; the Vite dev proxy forwards /api to Flask.
 * @param {object | FormData} [body] - Request body, if any.
 * @returns {Promise<{status: number, body: any}>} The status and the parsed body (JSON, text, or null).
 */
async function request(method, url, body) {
  const isJson = body !== undefined && !(body instanceof FormData)
  const res = await fetch(url, {
    method,
    headers: isJson ? { 'Content-Type': 'application/json' } : undefined,
    body: isJson ? JSON.stringify(body) : body,
  })
  const text = await res.text()
  let parsed
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  if (!res.ok) {
    // 400s carry { error }. 404s are Flask's HTML page, which is too long to put in a message.
    let detail = ''
    if (parsed && typeof parsed === 'object' && parsed.error) detail = parsed.error
    else if (typeof parsed === 'string' && parsed.length < 200) detail = parsed
    const err = new Error(`${method} ${url} failed: HTTP ${res.status}${detail ? ` - ${detail}` : ''}`)
    err.body = parsed
    throw err
  }
  return { status: res.status, body: parsed }
}

const real = {
  // Assignments

  /** GET /api/assignments: every assignment with its question count and total points. */
  listAssignments() {
    return request('GET', '/api/assignments')
  },
  /** GET /api/assignments/:id: one assignment with its ordered questions and their test cases. */
  getAssignment(id) {
    return request('GET', `/api/assignments/${id}`)
  },
  /** POST /api/assignments with { title }. Returns the new assignment's detail. */
  createAssignment(fields) {
    return request('POST', '/api/assignments', fields)
  },
  /** DELETE /api/assignments/:id. Also deletes its questions, tests, submissions, and photos. */
  deleteAssignment(id) {
    return request('DELETE', `/api/assignments/${id}`)
  },

  // Questions

  /** POST /api/assignments/:id/questions with { max_points, title?, prompt?, exact_match? }. Returns the question. */
  createQuestion(assignmentId, fields) {
    return request('POST', `/api/assignments/${assignmentId}/questions`, fields)
  },
  /**
   * PATCH /api/questions/:id with any of { title, prompt, max_points, exact_match }.
   * Changing points or match mode re-scores the question's submissions. Returns the question with test_cases.
   */
  updateQuestion(id, fields) {
    return request('PATCH', `/api/questions/${id}`, fields)
  },
  /** DELETE /api/questions/:id. Also deletes its tests and submissions; later questions are renumbered. */
  deleteQuestion(id) {
    return request('DELETE', `/api/questions/${id}`)
  },

  // Test cases

  /** POST /api/questions/:id/tests with { input?, expected_output }. Returns only the new id. */
  addTestCase(questionId, fields) {
    return request('POST', `/api/questions/${questionId}/tests`, fields)
  },
  /** DELETE /api/tests/:id. */
  deleteTestCase(id) {
    return request('DELETE', `/api/tests/${id}`)
  },

  // Submissions

  /**
   * POST /api/questions/:id/submissions with one photo as multipart "files".
   * `label` is optional; the backend falls back to the file name. Returns { submission_ids }.
   */
  createSubmission(questionId, file, label) {
    const form = new FormData()
    form.append('files', file)
    if (label) form.append('labels', label)
    return request('POST', `/api/questions/${questionId}/submissions`, form)
  },
  /** GET /api/questions/:id/submissions: summary rows for the sidebar. */
  listSubmissions(questionId) {
    return request('GET', `/api/questions/${questionId}/submissions`)
  },
  /** GET /api/submissions/:id: the full submission, including test results and flags. */
  getSubmission(id) {
    return request('GET', `/api/submissions/${id}`)
  },
  /** POST /api/submissions/:id/grade with { final_score, notes }. Sets status "graded"; returns the full submission. */
  gradeSubmission(id, fields) {
    return request('POST', `/api/submissions/${id}/grade`, fields)
  },
  /**
   * POST /api/submissions/:id/rerun with { code }: fixes a misread. The code replaces the
   * transcription and the original is re-scored. Returns the full submission.
   */
  rerunSubmission(id, fields) {
    return request('POST', `/api/submissions/${id}/rerun`, fields)
  },
  /**
   * POST /api/submissions/:id/corrected with { code }: stores and tests a corrected version,
   * for comparison only. Scores and the transcription are unchanged. Returns the full submission.
   */
  setCorrected(id, fields) {
    return request('POST', `/api/submissions/${id}/corrected`, fields)
  },
  /** DELETE /api/submissions/:id/corrected: removes the corrected version and its test results. */
  discardCorrected(id) {
    return request('DELETE', `/api/submissions/${id}/corrected`)
  },
  /** DELETE /api/submissions/:id. Also deletes its results and uploaded photo. */
  deleteSubmission(id) {
    return request('DELETE', `/api/submissions/${id}`)
  },
  /** URL of a submission's photo; the backend doesn't return it, so it's built from the id. */
  imageUrl(id) {
    return `/api/submissions/${id}/image`
  },

  // Gradebook

  /** GET /api/gradebook: students by assignments. `assignmentIds` filters the columns; null means all. */
  getGradebook(assignmentIds) {
    return request('GET', `/api/gradebook${gradebookQuery(assignmentIds)}`)
  },
  /** URL of the gradebook CSV download, with the same filter as getGradebook. */
  gradebookCsvUrl(assignmentIds) {
    return `/api/gradebook.csv${gradebookQuery(assignmentIds)}`
  },
}

/**
 * Builds the ?assignment_ids= query shared by the gradebook JSON and CSV.
 *
 * @param {number[] | null} assignmentIds - Ids to show, or null/empty for every assignment.
 * @returns {string} The query string, or '' for no filter.
 */
function gradebookQuery(assignmentIds) {
  return assignmentIds?.length ? `?assignment_ids=${assignmentIds.join(',')}` : ''
}

/** The client the app uses: the mock in mock mode, otherwise the real backend. */
export const api = USE_MOCK ? mock : real
