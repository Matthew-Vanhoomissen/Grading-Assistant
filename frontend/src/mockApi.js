// In-browser stand-in for the Flask API, used when VITE_USE_MOCK=true. It
// exports the same methods as the real client in api.js, with responses shaped
// like the API contract in CLAUDE.md section 12 (which mirrors backend/app.py),
// including its validation errors, 0/1 booleans, and cascading deletes.
//
// Each upload moves through queued -> processing -> a final state chosen with
// the "Mock scenario" dropdown. Data lives in memory and resets on reload.

const QUEUED_MS = 2500
const PROCESSING_MS = 5000
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']

/** Final states a mock upload can end in, keyed by name, with the labels shown in the dropdown. */
export const SCENARIOS = {
  ready_plain: 'ready, no corrected code',
  ready_corrected: 'ready, syntax error + corrected code',
  error: 'error',
}

// Placeholder photos in public/mock/.
const IMAGES = {
  ready_plain: '/mock/sample-1.svg',
  ready_corrected: '/mock/sample-2.svg',
  error: '/mock/sample-1.svg',
}

// Each scenario's final submission fields, as the worker would leave them.
const FINAL = {
  ready_plain: {
    status: 'ready',
    transcription: 'def add(a, b):\n    return a + b\n\nprint(add(2, 3))\n',
    corrected_code: null,
    flags: {
      uncertain_lines: [
        { line: 2, chosen: '    return a + b', alternative: '    return a + 6', reason: 'b and 6 look alike' },
      ],
      static_flags: [],
    },
    error_message: null,
  },
  ready_corrected: {
    status: 'ready',
    transcription:
      'def average(nums)\n    total = 0\n    for n in nums:\n        total += n\n    return total / len(nums)\n\nprint(average([1, 2, 3]))\n',
    corrected_code:
      'def average(nums):\n    total = 0\n    for n in nums:\n        total += n\n    return total / len(nums)\n\nprint(average([1, 2, 3]))\n',
    flags: {
      uncertain_lines: [
        { line: 1, chosen: 'def average(nums)', alternative: 'def average(nums):', reason: 'faint mark after )' },
        { line: 4, chosen: '        total += n', alternative: '        total + n', reason: 'unclear = sign' },
      ],
      static_flags: [{ line: 1, reason: "syntax error: expected ':'" }],
      // As if the backend ran with SYNTAX_FIX=1: the model's fix is the corrected version.
      syntax_fix: { changes: [{ line: 1, description: 'added missing colon' }] },
    },
    error_message: null,
  },
  error: {
    status: 'error',
    transcription: null,
    corrected_code: null,
    flags: null,
    error_message: 'RateLimitError: model API returned 429 (rate limited)',
  },
}

// Fields while queued or processing: nothing has been produced yet.
const PENDING = {
  transcription: null,
  corrected_code: null,
  flags: null,
  error_message: null,
}

// The mock can't run Python, so it fakes the sandbox and the ast check:
// - a block header (def, if, for, ...) without a trailing colon is a SyntaxError
// - the scenario's corrected "average" program prints 2.0
// - any other code prints 5 whatever the input, so it passes some tests and fails others
const BLOCK_HEADER = /^\s*(def|class|if|elif|else|for|while|try|except|finally|with)\b/

/**
 * Finds the first block header missing its colon.
 *
 * @param {string} code
 * @returns {{line: number, text: string} | null} The 1-indexed line and its text, or null if none.
 */
function mockSyntaxError(code) {
  const lines = code.split('\n')
  const i = lines.findIndex((l) => BLOCK_HEADER.test(l) && !l.replace(/#.*$/, '').trimEnd().endsWith(':'))
  return i === -1 ? null : { line: i + 1, text: lines[i] }
}

/** Fake of the backend's static_flags: one "syntax error" entry, or none. */
function mockStaticFlags(code) {
  const err = mockSyntaxError(code)
  return err ? [{ line: err.line, reason: "syntax error: expected ':'" }] : []
}

/** Fake sandbox run; returns { actual_output, error } like one row of test_results. */
function mockRun(code) {
  const err = mockSyntaxError(code)
  if (err) {
    return {
      actual_output: '',
      error: `  File "/code/main.py", line ${err.line}\n    ${err.text.trim()}\n    ^\nSyntaxError: expected ':'`,
    }
  }
  return { actual_output: code === FINAL.ready_corrected.corrected_code ? '2.0\n' : '5\n', error: null }
}

/**
 * Same comparison as backend/sandbox.py outputs_match. Unless `exact`, trailing
 * whitespace on each line and trailing blank lines are ignored.
 *
 * @param {string} actual
 * @param {string} expected
 * @param {boolean} exact - The question's exact_match setting.
 * @returns {boolean}
 */
function outputsMatch(actual, expected, exact) {
  if (exact) return actual === expected
  const norm = (s) =>
    s
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.trimEnd())
      .join('\n')
      .replace(/\n+$/, '')
  return norm(actual) === norm(expected)
}

// In-memory tables, mirroring backend/db.py. Booleans are stored as 0/1 like SQLite.
const assignments = new Map()
const questions = new Map()
const testCases = new Map()
// Submissions store only what the mock needs; buildSubmission derives the rest on read.
// `edited` and `corrected` hold the professor's code edits (corrected: undefined = untouched, null = discarded).
const submissions = new Map() // id -> { createdAt, scenario, questionId, label, finalScore, notes, edited, corrected }
let nextAssignmentId = 1
let nextQuestionId = 1
let nextTestId = 1
let nextSubmissionId = 7
let scenario = 'ready_plain'

/** An assignment's questions in position order. */
const questionsOf = (assignmentId) =>
  [...questions.values()]
    .filter((q) => q.assignment_id === assignmentId)
    .sort((a, b) => a.position - b.position || a.id - b.id)
/** A question's test cases. */
const testsOf = (questionId) => [...testCases.values()].filter((t) => t.question_id === questionId)

/** Assignment row plus the computed totals the backend adds (ASSIGNMENT_SELECT in db.py). */
function assignmentRow(a) {
  const qs = questionsOf(a.id)
  return { ...a, question_count: qs.length, total_points: qs.reduce((sum, q) => sum + q.max_points, 0) }
}

/** Question row with its test_cases, as the question routes return it. */
const questionWithTests = (q) => ({ ...q, test_cases: testsOf(q.id) })

/** Adds an assignment row. */
function insertAssignment({ title, language = 'python' }) {
  const row = { id: nextAssignmentId++, title, language }
  assignments.set(row.id, row)
  return row
}

/** Adds a question row; without a position it goes last, like the backend. */
function insertQuestion(assignmentId, { max_points, title = '', prompt = '', exact_match = false, position = null }) {
  const pos = position ?? questionsOf(assignmentId).reduce((m, q) => Math.max(m, q.position), 0) + 1
  const row = {
    id: nextQuestionId++,
    assignment_id: assignmentId,
    position: pos,
    title,
    prompt,
    max_points: Number(max_points),
    exact_match: exact_match ? 1 : 0,
  }
  questions.set(row.id, row)
  return row
}

/** Adds a test case row. */
function insertTestCase(questionId, { input = '', expected_output }) {
  const row = { id: nextTestId++, question_id: questionId, input, expected_output }
  testCases.set(row.id, row)
  return row
}

// Seed two assignments. Homework 1 has three questions (one untitled, to
// exercise the "Question N" fallback). Submissions with a final score count as
// graded, so the gradebook has full scores and each kind of n/a.
const seeded = insertAssignment({ title: 'Homework 1 (mock)' })
const q1 = insertQuestion(seeded.id, {
  title: 'Add two numbers',
  prompt: 'Read two ints on one line, print their sum.',
  max_points: 10,
})
insertTestCase(q1.id, { input: '2 3\n', expected_output: '5\n' })
insertTestCase(q1.id, { input: '-1 1\n', expected_output: '0\n' })
const q2 = insertQuestion(seeded.id, {
  title: 'Average of a list',
  prompt: 'Print the average of [1, 2, 3].',
  max_points: 5,
})
insertTestCase(q2.id, { input: '', expected_output: '2.0\n' })
const q3 = insertQuestion(seeded.id, { title: '', prompt: '', max_points: 2 })
const seeded2 = insertAssignment({ title: 'Homework 2 (mock)' })
const h2q1 = insertQuestion(seeded2.id, { title: 'Print five', prompt: 'Print 5.', max_points: 4 })
insertTestCase(h2q1.id, { input: '', expected_output: '5\n' })
for (const [label, name, questionId, finalScore = null] of [
  ['sample_01', 'ready_plain', q1.id],
  ['sample_03', 'error', q1.id],
  ['sample_02', 'ready_corrected', q2.id],
  ['S001', 'ready_plain', q1.id, 10], // fully graded on both assignments
  ['S001', 'ready_corrected', q2.id, 4],
  ['S001', 'ready_plain', q3.id, 1.5],
  ['S001', 'ready_plain', h2q1.id, 4],
  ['S002', 'ready_plain', q1.id, 5], // Q2 not graded, Q3 not submitted
  ['S002', 'ready_corrected', q2.id],
  ['s003 ', 'ready_plain', h2q1.id, 3], // label differs in case/space from S003 below
  ['S003', 'ready_plain', q1.id, 7], // two photos for Q2
  ['S003', 'ready_corrected', q2.id],
  ['S003', 'ready_corrected', q2.id],
  ['S003', 'ready_plain', q3.id, 2],
]) {
  submissions.set(nextSubmissionId++, { createdAt: 0, scenario: name, questionId, label, finalScore })
}

/** Sets the final state for the next upload (a SCENARIOS key). Mock only; App calls it before uploading. */
export function setScenario(name) {
  scenario = name
}

/** Simulated network latency. */
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

/** Builds an Error shaped like the ones api.js throws for non-2xx responses. */
function fail(method, url, status, error) {
  const err = new Error(`${method} ${url} failed: HTTP ${status} - ${error} (mock)`)
  err.body = { error }
  return err
}

/** Looks up a row by id, or throws a 404 like the backend. */
function or404(table, method, url, id) {
  const row = table.get(Number(id))
  if (!row) throw fail(method, url, 404, 'Not Found')
  return row
}

/** Deletes the submissions matching `pred`, like db._delete_submissions_where. */
function deleteSubmissionsWhere(pred) {
  for (const [id, s] of submissions) if (pred(s)) submissions.delete(id)
}

// Assignments

/** Mirrors GET /api/assignments. */
export async function listAssignments() {
  await delay(100)
  return { status: 200, body: [...assignments.values()].map(assignmentRow) }
}

/** Mirrors GET /api/assignments/:id. */
export async function getAssignment(id) {
  await delay(100)
  const a = or404(assignments, 'GET', `/api/assignments/${id}`, id)
  return { status: 200, body: { ...assignmentRow(a), questions: questionsOf(a.id).map(questionWithTests) } }
}

/** Mirrors POST /api/assignments, including the 400 for a missing title. */
export async function createAssignment(fields) {
  await delay(150)
  if (!fields.title) throw fail('POST', '/api/assignments', 400, 'title is required')
  const a = insertAssignment(fields)
  return { status: 201, body: { ...assignmentRow(a), questions: [] } }
}

/** Mirrors DELETE /api/assignments/:id: removes everything under it, and returns 204 even for an unknown id. */
export async function deleteAssignment(id) {
  await delay(150)
  const assignmentId = Number(id)
  const qids = new Set(questionsOf(assignmentId).map((q) => q.id))
  deleteSubmissionsWhere((s) => qids.has(s.questionId))
  for (const [tid, t] of testCases) if (qids.has(t.question_id)) testCases.delete(tid)
  for (const qid of qids) questions.delete(qid)
  assignments.delete(assignmentId)
  return { status: 204, body: null }
}

// Questions

/** Mirrors POST /api/assignments/:id/questions, including its 400s. */
export async function createQuestion(assignmentId, fields) {
  await delay(150)
  const url = `/api/assignments/${assignmentId}/questions`
  or404(assignments, 'POST', url, assignmentId)
  if (fields.max_points == null || fields.max_points === '' || Number.isNaN(Number(fields.max_points))) {
    throw fail('POST', url, 400, 'max_points must be a number')
  }
  if (fields.position != null && !Number.isInteger(fields.position))
    throw fail('POST', url, 400, 'position must be an integer')
  return { status: 201, body: questionWithTests(insertQuestion(Number(assignmentId), fields)) }
}

/**
 * Mirrors PATCH /api/questions/:id: only title, prompt, max_points, and exact_match
 * are read, and other keys are ignored. Mock test results are computed on read,
 * so submissions re-score on their own, matching the backend's rescore.
 */
export async function updateQuestion(id, fields) {
  await delay(150)
  const url = `/api/questions/${id}`
  const q = or404(questions, 'PATCH', url, id)
  const changes = {}
  for (const name of ['title', 'prompt']) {
    if (name in fields) {
      if (typeof fields[name] !== 'string') throw fail('PATCH', url, 400, `${name} must be a string`)
      changes[name] = fields[name]
    }
  }
  if ('max_points' in fields) {
    const n = Number(fields.max_points)
    if (fields.max_points == null || fields.max_points === '' || Number.isNaN(n)) {
      throw fail('PATCH', url, 400, 'max_points must be a number')
    }
    changes.max_points = n
  }
  if ('exact_match' in fields) changes.exact_match = fields.exact_match ? 1 : 0
  if (Object.keys(changes).length === 0) {
    throw fail('PATCH', url, 400, 'nothing to update (title, prompt, max_points, exact_match)')
  }
  Object.assign(q, changes)
  return { status: 200, body: questionWithTests(q) }
}

/**
 * Mirrors DELETE /api/questions/:id: removes its tests and submissions, and moves
 * later questions up one position so numbering stays 1..n.
 */
export async function deleteQuestion(id) {
  await delay(150)
  const q = questions.get(Number(id))
  if (q) {
    deleteSubmissionsWhere((s) => s.questionId === q.id)
    for (const [tid, t] of testCases) if (t.question_id === q.id) testCases.delete(tid)
    questions.delete(q.id)
    for (const other of questionsOf(q.assignment_id)) if (other.position > q.position) other.position -= 1
  }
  return { status: 204, body: null }
}

// Test cases

/** Mirrors POST /api/questions/:id/tests; returns only the new id. */
export async function addTestCase(questionId, fields) {
  await delay(150)
  const url = `/api/questions/${questionId}/tests`
  or404(questions, 'POST', url, questionId)
  if (!('expected_output' in fields)) throw fail('POST', url, 400, 'expected_output is required')
  return { status: 201, body: { id: insertTestCase(Number(questionId), fields).id } }
}

/** Mirrors DELETE /api/tests/:id. */
export async function deleteTestCase(id) {
  await delay(100)
  testCases.delete(Number(id))
  return { status: 204, body: null }
}

// Submissions

/**
 * Mirrors POST /api/questions/:id/submissions for one file. The photo itself is
 * ignored, but its extension is checked like the backend does. The new
 * submission ends in the current scenario.
 */
export async function createSubmission(questionId, file, label) {
  await delay(300)
  const url = `/api/questions/${questionId}/submissions`
  or404(questions, 'POST', url, questionId)
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext)) throw fail('POST', url, 400, `${file.name}: use jpg, png, or webp`)
  const id = nextSubmissionId++
  const fileStem = file.name.slice(0, file.name.lastIndexOf('.'))
  submissions.set(id, { createdAt: Date.now(), scenario, questionId: Number(questionId), label: label || fileStem })
  return { status: 201, body: { submission_ids: [id] } }
}

/**
 * Fakes the test runs against the question's current test cases, scored like
 * backend/scoring.py. Results are computed on read, so they follow later test
 * edits. Only the original version sets the score; corrected is for comparison.
 *
 * @param {number} submissionId
 * @param {object | null} question
 * @param {string | null} code - The transcription; null means no results.
 * @param {string | null} correctedCode - The corrected version, if any.
 * @returns {{test_results: object[], verdict: string | null, suggested_score: number | null, score_reasoning: string | null}}
 */
function runMockTests(submissionId, question, code, correctedCode) {
  const none = { test_results: [], verdict: null, suggested_score: null, score_reasoning: null }
  if (code == null || !question) return none
  const runVersion = (version, source, offset) =>
    testsOf(question.id).map((t, i) => {
      const { actual_output, error } = mockRun(source)
      const passed = error == null && outputsMatch(actual_output, t.expected_output, Boolean(question.exact_match))
      return {
        id: submissionId * 100 + offset + i,
        submission_id: submissionId,
        test_case_id: t.id,
        version,
        passed: passed ? 1 : 0,
        actual_output,
        error,
        input: t.input,
        expected_output: t.expected_output,
      }
    })
  const original = runVersion('original', code, 0)
  const corrected = correctedCode != null ? runVersion('corrected', correctedCode, 50) : []
  const total = original.length
  const passed = original.filter((r) => r.passed).length
  if (total === 0) return none
  const score = Math.round(((question.max_points * passed) / total) * 100) / 100
  return {
    test_results: [...original, ...corrected],
    verdict: passed === total ? 'pass' : null,
    suggested_score: score,
    score_reasoning: `Passed ${passed} of ${total} tests: ${question.max_points} x ${passed}/${total} = ${score}.`,
  }
}

/**
 * Derives the full submission object, as GET /api/submissions/:id returns it,
 * from the stored record, the time since upload, and any professor edits.
 */
function buildSubmission(id, sub) {
  const elapsed = Date.now() - sub.createdAt
  let state
  if (elapsed < QUEUED_MS) state = { status: 'queued', ...PENDING }
  else if (elapsed < QUEUED_MS + PROCESSING_MS) state = { status: 'processing', ...PENDING }
  else state = FINAL[sub.scenario]
  const done = !['queued', 'processing'].includes(state.status)
  // Once processing is done, a final score makes it graded (the backend sets the status when grading).
  const graded = sub.finalScore != null && done

  let { status, transcription, corrected_code, error_message } = state
  let flags = state.flags && { ...state.flags }
  // The professor fixed a misread (rerun), as in pipeline.rerun_submission.
  if (done && sub.edited != null) {
    flags = {
      uncertain_lines: [],
      ...flags,
      model_transcription: transcription,
      static_flags: mockStaticFlags(sub.edited),
    }
    transcription = sub.edited
    if (status === 'error') {
      status = 'ready'
      error_message = null
    }
  }
  // The professor set or discarded the corrected version. syntax_fix described the model's version, so it goes.
  if (done && sub.corrected !== undefined) {
    corrected_code = sub.corrected
    if (flags) delete flags.syntax_fix
  }

  const question = questions.get(sub.questionId) ?? null
  const assignment = question ? assignmentRow(assignments.get(question.assignment_id)) : null
  const results = runMockTests(id, question, transcription, corrected_code)
  return {
    id,
    question_id: sub.questionId,
    student_label: sub.label,
    status: graded ? 'graded' : status,
    transcription,
    corrected_code,
    flags,
    error_message,
    verdict: results.verdict,
    suggested_score: results.suggested_score,
    final_score: graded ? sub.finalScore : null,
    notes: sub.notes ?? null,
    question,
    assignment,
    test_results: results.test_results,
    score_reasoning: results.score_reasoning,
  }
}

/** Mirrors GET /api/questions/:id/submissions (summary rows). */
export async function listSubmissions(questionId) {
  await delay(150)
  or404(questions, 'GET', `/api/questions/${questionId}/submissions`, questionId)
  const rows = [...submissions.entries()]
    .filter(([, sub]) => sub.questionId === Number(questionId))
    .map(([id, sub]) => {
      const s = buildSubmission(id, sub)
      return {
        id: s.id,
        question_id: s.question_id,
        student_label: s.student_label,
        status: s.status,
        verdict: s.verdict,
        suggested_score: s.suggested_score,
        final_score: s.final_score,
        error_message: s.error_message,
      }
    })
  return { status: 200, body: rows }
}

/** Mirrors GET /api/submissions/:id. */
export async function getSubmission(id) {
  await delay(150)
  const sub = or404(submissions, 'GET', `/api/submissions/${id}`, id)
  return { status: 200, body: buildSubmission(Number(id), sub) }
}

/** Throws a 409 while the submission is queued or processing, like the backend's _busy. */
function rejectIfBusy(method, url, id, sub) {
  const { status } = buildSubmission(Number(id), sub)
  if (status === 'queued' || status === 'processing')
    throw fail(method, url, 409, 'submission is still queued/processing')
}

/** Reads `code` from a request body, or throws the backend's 400. */
function codeFrom(fields, url) {
  if (typeof fields?.code !== 'string') throw fail('POST', url, 400, 'code is required')
  return fields.code
}

/** Mirrors POST /api/submissions/:id/rerun: the code replaces the transcription and the original is re-scored. */
export async function rerunSubmission(id, fields) {
  await delay(400)
  const url = `/api/submissions/${id}/rerun`
  const sub = or404(submissions, 'POST', url, id)
  rejectIfBusy('POST', url, id, sub)
  sub.edited = codeFrom(fields, url)
  return { status: 200, body: buildSubmission(Number(id), sub) }
}

/** Mirrors POST /api/submissions/:id/corrected: comparison only, so scores and the transcription don't change. */
export async function setCorrected(id, fields) {
  await delay(400)
  const url = `/api/submissions/${id}/corrected`
  const sub = or404(submissions, 'POST', url, id)
  rejectIfBusy('POST', url, id, sub)
  sub.corrected = codeFrom(fields, url)
  return { status: 200, body: buildSubmission(Number(id), sub) }
}

/** Mirrors DELETE /api/submissions/:id/corrected. */
export async function discardCorrected(id) {
  await delay(150)
  const url = `/api/submissions/${id}/corrected`
  const sub = submissions.get(Number(id))
  if (sub) {
    rejectIfBusy('DELETE', url, id, sub)
    sub.corrected = null
  }
  return { status: 204, body: null }
}

/**
 * Mirrors POST /api/submissions/:id/grade: final_score must be a number, notes is
 * overwritten (missing means null), and the status becomes "graded".
 */
export async function gradeSubmission(id, fields) {
  await delay(150)
  const url = `/api/submissions/${id}/grade`
  const sub = or404(submissions, 'POST', url, id)
  rejectIfBusy('POST', url, id, sub)
  const score = Number(fields.final_score)
  if (fields.final_score == null || fields.final_score === '' || Number.isNaN(score)) {
    throw fail('POST', url, 400, 'final_score must be a number')
  }
  sub.finalScore = score
  sub.notes = fields.notes ?? null
  return { status: 200, body: buildSubmission(Number(id), sub) }
}

/** Mirrors DELETE /api/submissions/:id. */
export async function deleteSubmission(id) {
  await delay(150)
  submissions.delete(Number(id))
  return { status: 204, body: null }
}

/** The placeholder photo for a submission's scenario. */
export function imageUrl(id) {
  const sub = submissions.get(Number(id))
  return IMAGES[sub?.scenario ?? 'ready_plain']
}

// Gradebook, mirroring backend/gradebook.py. A cell sums final scores, and is
// n/a (score null, with a reason) unless every question has exactly one graded
// submission. Students are matched by label, ignoring case and surrounding spaces.

/** Rounds to two decimals, like gradebook._number. */
const roundPoints = (n) => Math.round(n * 100) / 100
/** Sort key that orders "S2" before "S10". */
const naturalKey = (text) =>
  text
    .toLowerCase()
    .split(/(\d+)/)
    .map((p, i) => (i % 2 ? Number(p) : p))
/** Comparator for natural (number-aware) sorting of student labels. */
function naturalCompare(a, b) {
  const ka = naturalKey(a)
  const kb = naturalKey(b)
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
    if (ka[i] < kb[i]) return -1
    if (ka[i] > kb[i]) return 1
  }
  return ka.length - kb.length
}

/**
 * One student's cell for one assignment.
 *
 * @param {object[]} qs - The assignment's questions.
 * @param {Map<number, object[]>} subsByQuestion - That student's submissions, by question id.
 * @returns {{score: number | null, reason: string | null}}
 */
function gradebookCell(qs, subsByQuestion) {
  if (!qs.some((q) => subsByQuestion.get(q.id)?.length)) return { score: null, reason: 'No submissions' }
  let total = 0
  const problems = []
  for (const q of qs) {
    const subs = subsByQuestion.get(q.id) ?? []
    const name = `Q${q.position}`
    if (subs.length === 0) problems.push(`${name} not submitted`)
    else if (subs.length > 1) problems.push(`${subs.length} photos for ${name}`)
    else if (subs[0].status !== 'graded' || subs[0].final_score == null) problems.push(`${name} not graded`)
    else total += subs[0].final_score
  }
  return problems.length ? { score: null, reason: problems.join('; ') } : { score: roundPoints(total), reason: null }
}

/** The grid as { columns, rows }, like gradebook.build. `assignmentIds` filters columns; null or empty means all. */
function buildGradebook(assignmentIds) {
  const shown = [...assignments.values()]
    .map(assignmentRow)
    .filter((a) => a.question_count && (!assignmentIds?.length || assignmentIds.includes(a.id)))
  // student key -> assignment id -> question id -> [submission]
  const byStudent = new Map()
  const labels = new Map()
  for (const [id, sub] of submissions) {
    const key = sub.label.trim().toLowerCase()
    const question = questions.get(sub.questionId)
    if (!key || !question) continue
    if (!labels.has(key)) labels.set(key, sub.label.trim())
    if (!byStudent.has(key)) byStudent.set(key, new Map())
    const perAssignment = byStudent.get(key)
    if (!perAssignment.has(question.assignment_id)) perAssignment.set(question.assignment_id, new Map())
    const perQuestion = perAssignment.get(question.assignment_id)
    if (!perQuestion.has(question.id)) perQuestion.set(question.id, [])
    perQuestion.get(question.id).push(buildSubmission(id, sub))
  }
  const titles = shown.map((a) => a.title)
  const columns = shown.map((a) => ({
    assignment_id: a.id,
    header: titles.filter((t) => t === a.title).length === 1 ? a.title : `${a.title} (#${a.id})`,
    max_points: roundPoints(a.total_points),
  }))
  const rows = [...byStudent.keys()]
    .filter((k) => shown.some((a) => byStudent.get(k).has(a.id)))
    .sort((a, b) => naturalCompare(labels.get(a), labels.get(b)))
    .map((k) => ({
      student: labels.get(k),
      cells: shown.map((a) => gradebookCell(questionsOf(a.id), byStudent.get(k).get(a.id) ?? new Map())),
    }))
  return { columns, rows }
}

/** Mirrors GET /api/gradebook. */
export async function getGradebook(assignmentIds) {
  await delay(150)
  return { status: 200, body: buildGradebook(assignmentIds) }
}

/**
 * The gradebook CSV in the same layout as backend/gradebook.py to_csv, as a
 * data: URL since there is no server to download from. n/a cells are empty,
 * and cells that look like spreadsheet formulas get a leading quote.
 */
export function gradebookCsvUrl(assignmentIds) {
  const grid = buildGradebook(assignmentIds)
  const safe = (text) => (/^[=+\-@\t\r]/.test(String(text)) ? `'${text}` : String(text))
  const field = (v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const lines = [
    ['Student', ...grid.columns.map((c) => safe(c.header))],
    ['Max points', ...grid.columns.map((c) => c.max_points)],
    ...grid.rows.map((r) => [safe(r.student), ...r.cells.map((c) => (c.score == null ? '' : c.score))]),
  ]
  const csv = lines.map((row) => row.map(field).join(',')).join('\n') + '\n'
  // The BOM makes Excel read the file as UTF-8, like the backend's CSV.
  return `data:text/csv;charset=utf-8,${encodeURIComponent('\ufeff' + csv)}`
}
