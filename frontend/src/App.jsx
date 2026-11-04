// Root component: the Grading view (assignment setup, upload, and the review
// page for one submission) and the Gradebook view.

import { useEffect, useState } from 'react'
import { api, USE_MOCK } from './api.js'
import { SCENARIOS, setScenario } from './mockApi.js'
import CodeBlock from './components/CodeBlock.jsx'
import CodeEditor from './components/CodeEditor.jsx'
import AssignmentPanel from './components/AssignmentPanel.jsx'
import AssignmentTabs from './components/AssignmentTabs.jsx'
import QuestionPanel from './components/QuestionPanel.jsx'
import SubmissionList from './components/SubmissionList.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'
import TestResults from './components/TestResults.jsx'
import Gradebook from './components/Gradebook.jsx'
import GradePanel from './components/GradePanel.jsx'
import { questionLabel } from './format.js'

// How often the open submission is re-fetched while the worker processes it.
const POLL_MS = 1500
// Statuses after which the worker is finished with a submission; polling stops and editing is allowed.
const DONE = ['ready', 'graded', 'error']

/**
 * Owns the app-wide state: the assignment list, the selected assignment's
 * detail and question, the upload form, the open submission (polled until
 * processing finishes), and the last backend response for the Raw JSON panel.
 */
export default function App() {
  const [assignments, setAssignments] = useState(null) // null while loading
  const [assignmentsError, setAssignmentsError] = useState(null)
  const [creatingAssignment, setCreatingAssignment] = useState(false)
  const [assignmentId, setAssignmentId] = useState(null)
  const [detail, setDetail] = useState(null) // selected assignment with questions and their test cases
  const [detailError, setDetailError] = useState(null)
  const [detailVersion, setDetailVersion] = useState(0) // bump to re-fetch detail
  const [questionId, setQuestionId] = useState(null)
  const [creatingQuestion, setCreatingQuestion] = useState(false)
  const [file, setFile] = useState(null)
  const [label, setLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submissionId, setSubmissionId] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [submissionVersion, setSubmissionVersion] = useState(0) // bump to re-fetch the open submission
  const [raw, setRaw] = useState(null) // { label, body } of the last backend response
  const [requestError, setRequestError] = useState(null)
  const [mockScenario, setMockScenario] = useState('ready_plain') // final state for the next mock upload
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [listRefresh, setListRefresh] = useState(0) // bump to reload the sidebar
  const [submissionRows, setSubmissionRows] = useState(null) // the sidebar's list, for Confirm & Next
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [view, setView] = useState('grading') // 'grading' | 'gradebook'

  /** Closes the review page and clears its error. */
  function clearSubmission() {
    setSubmission(null)
    setSubmissionId(null)
    setRequestError(null)
  }

  /** Opens an assignment. The open submission belongs to the old one, so it is closed. */
  function selectAssignment(id) {
    setCreatingAssignment(false)
    if (id === assignmentId) return
    clearSubmission()
    setCreatingQuestion(false)
    setQuestionId(null)
    setAssignmentId(id)
  }

  /** Selects a question (or null). The open submission belongs to the old one, so it is closed. */
  function selectQuestion(id) {
    setCreatingQuestion(false)
    if (id === questionId) return
    clearSubmission()
    setQuestionId(id)
  }

  const reloadDetail = () => setDetailVersion((v) => v + 1)

  // Load the tab list once. Start on the newest assignment, or on the create form if there are none.
  useEffect(() => {
    let cancelled = false
    api
      .listAssignments()
      .then((res) => {
        if (cancelled) return
        setRaw({ label: `GET /api/assignments -> ${res.status}`, body: res.body })
        setAssignments(res.body)
        if (res.body.length === 0) setCreatingAssignment(true)
        else setAssignmentId(res.body[res.body.length - 1].id)
      })
      .catch((err) => {
        if (cancelled) return
        setAssignmentsError(err.message)
        setRaw({ label: 'GET /api/assignments (failed)', body: err.body ?? null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleAssignmentCreated(row) {
    setAssignments((prev) => [...(prev ?? []), row])
    selectAssignment(row.id)
  }

  function handleAssignmentDeleted(id) {
    const remaining = assignments.filter((a) => a.id !== id)
    setAssignments(remaining)
    selectAssignment(remaining.length ? remaining[remaining.length - 1].id : null)
    if (remaining.length === 0) setCreatingAssignment(true)
  }

  // Clear the detail only when switching assignments, not on reloads, so edits don't flicker.
  useEffect(() => {
    setDetail(null)
    setDetailError(null)
  }, [assignmentId])

  // Load the selected assignment's questions and test cases, and reload them when detailVersion changes.
  useEffect(() => {
    if (assignmentId == null) return
    let cancelled = false
    api
      .getAssignment(assignmentId)
      .then((res) => {
        if (cancelled) return
        setRaw({ label: `GET /api/assignments/${assignmentId} -> ${res.status}`, body: res.body })
        setDetail(res.body)
        setDetailError(null)
        // Keep the tab tooltips' question count and total points in step with question edits.
        const { id, question_count, total_points } = res.body
        setAssignments((prev) => prev?.map((a) => (a.id === id ? { ...a, question_count, total_points } : a)))
      })
      .catch((err) => {
        if (cancelled) return
        setDetailError(err.message)
        setRaw({ label: `GET /api/assignments/${assignmentId} (failed)`, body: err.body ?? null })
      })
    return () => {
      cancelled = true
    }
  }, [assignmentId, detailVersion])

  // Fall back to the first question whenever the selected one isn't in this assignment.
  useEffect(() => {
    if (!detail) return
    if (!detail.questions.some((q) => q.id === questionId)) selectQuestion(detail.questions[0]?.id ?? null)
  }, [detail])

  function handleQuestionCreated(q) {
    selectQuestion(q.id)
    reloadDetail()
  }

  /** Selects the next question after a delete, or the previous one if the deleted question was last. */
  function handleQuestionDeleted(id) {
    const qs = detail.questions
    const i = qs.findIndex((q) => q.id === id)
    const neighbor = qs[i + 1] ?? qs[i - 1] ?? null
    selectQuestion(neighbor?.id ?? null)
    reloadDetail()
  }

  /**
   * Refreshes everything a question edit can change. Editing points or match mode re-scores the
   * question's submissions, so the sidebar scores and the open review reload along with the detail.
   */
  function handleQuestionEdited() {
    reloadDetail()
    setListRefresh((n) => n + 1)
    setSubmissionVersion((v) => v + 1)
  }

  const question = detail?.questions.find((q) => q.id === questionId) ?? null
  // Uploads go to the selected question, and are disabled while a create form is open.
  const uploadTarget = !creatingAssignment && !creatingQuestion ? question : null

  function selectSubmission(id) {
    if (id === submissionId) return
    clearSubmission()
    setSubmissionId(id)
  }

  /** Uploads the chosen photo to the selected question and opens the new submission. */
  async function handleUpload(e) {
    e.preventDefault()
    if (!file || uploadTarget == null) return
    setUploading(true)
    clearSubmission()
    const url = `/api/questions/${uploadTarget.id}/submissions`
    try {
      if (USE_MOCK) setScenario(mockScenario)
      const res = await api.createSubmission(uploadTarget.id, file, label.trim())
      setRaw({ label: `POST ${url} -> ${res.status}`, body: res.body })
      setLabel('')
      setSubmissionId(res.body.submission_ids[0])
      setListRefresh((n) => n + 1)
    } catch (err) {
      setRequestError(err.message)
      setRaw({ label: `POST ${url} (failed)`, body: err.body ?? null })
    } finally {
      setUploading(false)
    }
  }

  async function deleteSubmission() {
    const id = submission.id
    const url = `/api/submissions/${id}`
    setDeleting(true)
    try {
      const res = await api.deleteSubmission(id)
      setRaw({ label: `DELETE ${url} -> ${res.status}`, body: res.body })
      clearSubmission()
      setListRefresh((n) => n + 1)
    } catch (err) {
      setRequestError(err.message)
      setRaw({ label: `DELETE ${url} (failed)`, body: err.body ?? null })
    } finally {
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  /**
   * Finds the target for Confirm & Next: the next submission in sidebar order after the open one,
   * wrapping around, that is done processing but not graded yet.
   *
   * @returns {number | null} Its id, or null if there is none.
   */
  function nextUngradedId() {
    if (!submissionRows || submission == null) return null
    const i = submissionRows.findIndex((s) => s.id === submission.id)
    const ordered = [...submissionRows.slice(i + 1), ...submissionRows.slice(0, Math.max(i, 0))]
    return ordered.find((s) => s.id !== submission.id && s.status !== 'graded' && DONE.includes(s.status))?.id ?? null
  }

  /**
   * Saves the open submission's grade, then opens the next ungraded one if `next` is set.
   *
   * @param {{final_score: number, notes: string | null}} fields - The grade to save.
   * @param {boolean} next - True for Confirm & Next.
   * @returns {Promise<boolean>} Whether the save succeeded.
   */
  async function gradeSubmission(fields, next) {
    const id = submission.id
    const url = `/api/submissions/${id}/grade`
    const nextId = next ? nextUngradedId() : null
    try {
      const res = await api.gradeSubmission(id, fields)
      setRaw({ label: `POST ${url} -> ${res.status}`, body: res.body })
      setListRefresh((n) => n + 1)
      if (nextId != null) selectSubmission(nextId)
      else setSubmission(res.body)
      return true
    } catch (err) {
      setRequestError(err.message)
      setRaw({ label: `POST ${url} (failed)`, body: err.body ?? null })
      return false
    }
  }

  /**
   * Runs a code edit from the review page (rerun or corrected); both routes return the full submission.
   *
   * @param {string} path - Route suffix, for the Raw JSON label.
   * @param {() => Promise<{status: number, body: object}>} call - The API call.
   * @returns {Promise<string | null>} An error message for the editor to show, or null on success.
   */
  async function runEditedCode(path, call) {
    const url = `/api/submissions/${submission.id}/${path}`
    try {
      const res = await call()
      setRaw({ label: `POST ${url} -> ${res.status}`, body: res.body })
      setSubmission(res.body)
      setListRefresh((n) => n + 1) // a rerun changes the sidebar's suggested score
      return null
    } catch (err) {
      setRaw({ label: `POST ${url} (failed)`, body: err.body ?? null })
      return err.message
    }
  }

  const rerunCode = (code) => runEditedCode('rerun', () => api.rerunSubmission(submission.id, { code }))
  const setCorrectedCode = (code) => runEditedCode('corrected', () => api.setCorrected(submission.id, { code }))

  /** Deletes the corrected version; the 204 has no body, so the submission is re-fetched. */
  async function discardCorrectedCode() {
    const url = `/api/submissions/${submission.id}/corrected`
    try {
      const res = await api.discardCorrected(submission.id)
      setRaw({ label: `DELETE ${url} -> ${res.status}`, body: res.body })
      setSubmissionVersion((v) => v + 1)
    } catch (err) {
      setRequestError(err.message)
      setRaw({ label: `DELETE ${url} (failed)`, body: err.body ?? null })
    }
  }

  // Fetch the open submission, polling until the worker is done with it. submissionVersion forces a re-fetch.
  useEffect(() => {
    if (submissionId == null) return
    let cancelled = false
    let timer

    async function poll() {
      try {
        const res = await api.getSubmission(submissionId)
        if (cancelled) return
        setRaw({ label: `GET /api/submissions/${submissionId} -> ${res.status}`, body: res.body })
        setSubmission(res.body)
        if (!DONE.includes(res.body.status)) timer = setTimeout(poll, POLL_MS)
      } catch (err) {
        if (cancelled) return
        setRequestError(err.message)
        setRaw({ label: `GET /api/submissions/${submissionId} (failed)`, body: err.body ?? null })
      }
    }

    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [submissionId, submissionVersion])

  // Last backend response, for telling frontend bugs from backend bugs. Shown in both views.
  const rawPanel = raw && (
    <details className="raw">
      <summary>Raw JSON ({raw.label})</summary>
      <pre>{JSON.stringify(raw.body, null, 2)}</pre>
    </details>
  )

  return (
    <div className="page">
      <header>
        <h1>Grading Assistant</h1>
        {USE_MOCK && <span className="mock-badge">MOCK MODE - no backend calls</span>}
        <nav className="view-switch">
          <button type="button" className={view === 'grading' ? 'active' : ''} onClick={() => setView('grading')}>
            Grading
          </button>
          <button type="button" className={view === 'gradebook' ? 'active' : ''} onClick={() => setView('gradebook')}>
            Gradebook
          </button>
        </nav>
      </header>

      {view === 'gradebook' && (
        <>
          <Gradebook onResponse={(label, body) => setRaw({ label, body })} />
          
        </>
      )}

      {view === 'grading' && (
        <>
          <AssignmentTabs
            assignments={assignments}
            selectedId={assignmentId}
            creating={creatingAssignment}
            error={assignmentsError}
            onSelect={selectAssignment}
            onNew={() => setCreatingAssignment(true)}
          />

          <div className={sidebarOpen ? 'layout' : 'layout sidebar-closed'}>
            <div className="main">
              <div className="setup">
                <AssignmentPanel
                  detail={detail}
                  assignmentId={assignmentId}
                  creating={creatingAssignment}
                  onCancelCreate={assignments?.length > 0 ? () => setCreatingAssignment(false) : null}
                  onCreated={handleAssignmentCreated}
                  onDeleted={handleAssignmentDeleted}
                  questionId={questionId}
                  creatingQuestion={creatingQuestion}
                  onSelectQuestion={selectQuestion}
                  onAddQuestion={() => setCreatingQuestion(true)}
                  loadError={detailError}
                  onResponse={(label, body) => setRaw({ label, body })}
                />
                <QuestionPanel
                  detail={creatingAssignment ? null : detail}
                  questionId={questionId}
                  creating={creatingQuestion}
                  creatingAssignment={creatingAssignment}
                  onCancelCreate={() => setCreatingQuestion(false)}
                  onCreated={handleQuestionCreated}
                  onDeleted={handleQuestionDeleted}
                  onChanged={reloadDetail}
                  onEdited={handleQuestionEdited}
                  onResponse={(label, body) => setRaw({ label, body })}
                />
              </div>

              <form className="upload" onSubmit={handleUpload}>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  onChange={(e) => setFile(e.target.files[0] ?? null)}
                />
                {USE_MOCK && (
                  <label>
                    Mock scenario:{' '}
                    <select value={mockScenario} onChange={(e) => setMockScenario(e.target.value)}>
                      {Object.entries(SCENARIOS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <input
                  className="label-input"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={
                    file ? `Name (default: ${file.name.replace(/\.[^.]+$/, '')})` : 'Submission name (optional)'
                  }
                  aria-label="Submission name"
                  title="Defaults to the file name. Use an anonymized label, not a student's real name."
                />
                <button type="submit" disabled={!file || uploading || uploadTarget == null}>
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
                <span className="hint">
                  {uploadTarget
                    ? `Uploads to ${detail.title} > ${questionLabel(uploadTarget)}`
                    : 'Select a question before uploading.'}
                </span>
              </form>

              {requestError && <div className="banner error">Request failed: {requestError}</div>}

              {!submission && !requestError && (
                <p className="empty">
                  {submissionId != null
                    ? `Loading submission #${submissionId}...`
                    : 'Choose a photo of a handwritten program (jpg, png, or webp) and upload it, or pick a submission on the right.'}
                </p>
              )}

              {submission && (
                <SubmissionView
                  key={submission.id}
                  submission={submission}
                  onDelete={() => setConfirmingDelete(true)}
                  hasNext={nextUngradedId() != null}
                  onGrade={gradeSubmission}
                  onRerun={rerunCode}
                  onSetCorrected={setCorrectedCode}
                  onDiscardCorrected={discardCorrectedCode}
                />
              )}

              <ConfirmDialog
                open={confirmingDelete && submission != null}
                title="Delete submission?"
                busy={deleting}
                message={
                  submission && (
                    <>
                      <p>
                        This permanently deletes submission <strong>#{submission.id}</strong>
                        {submission.student_label && <> ({submission.student_label})</>}, including its uploaded photo,
                        transcription, test results, and scores.
                      </p>
                      {!DONE.includes(submission.status) && (
                        <p>It is still {submission.status}. Deleting it now discards any work in progress.</p>
                      )}
                      <p>This cannot be undone.</p>
                    </>
                  )
                }
                confirmLabel="Delete submission"
                onConfirm={deleteSubmission}
                onCancel={() => setConfirmingDelete(false)}
              />

              
            </div>

            <SubmissionList
              questionId={questionId}
              questionName={question ? questionLabel(question) : null}
              selectedId={submissionId}
              onSelect={selectSubmission}
              refreshKey={listRefresh}
              open={sidebarOpen}
              onToggle={() => setSidebarOpen((o) => !o)}
              onRows={setSubmissionRows}
            />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The review page for one submission: status, photo, transcription and
 * corrected code (each editable), test results, and the final score form.
 * Render with key={submission.id} so edit state resets per submission.
 *
 * @param {object} props
 * @param {object} props.submission - The full submission from GET /api/submissions/:id.
 * @param {() => void} props.onDelete - Opens the delete-submission confirmation.
 * @param {boolean} props.hasNext - Whether Confirm & Next has a target.
 * @param {Function} props.onGrade - Saves the grade; see GradePanel's onSave.
 * @param {(code: string) => Promise<string | null>} props.onRerun - Fixes a misread; resolves to an error message or null.
 * @param {(code: string) => Promise<string | null>} props.onSetCorrected - Runs a corrected version; same contract.
 * @param {() => Promise<void>} props.onDiscardCorrected - Deletes the corrected version.
 */
function SubmissionView({ submission, onDelete, hasNext, onGrade, onRerun, onSetCorrected, onDiscardCorrected }) {
  const { id, student_label, status, transcription, flags, corrected_code, error_message, question } = submission
  const pending = !DONE.includes(status)
  const [editing, setEditing] = useState(null) // null | 'transcription' | 'corrected'
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  // After the first misread fix the backend saves the model's reading, and uncertain_lines refer to that.
  const edited = flags != null && 'model_transcription' in flags
  const uncertainLines = (flags?.uncertain_lines ?? []).map((u) => u.line)
  const syntaxErrors = (flags?.static_flags ?? []).filter((f) => f.reason.startsWith('syntax error'))

  return (
    <section>
      <div className="status-row">
        Submission #{id}
        {student_label && ` (${student_label})`}: <span className={`status status-${status}`}>{status}</span>
        {question && <span className="hint">{questionLabel(question)}</span>}
        {pending && <span className="hint"> checking every {POLL_MS / 1000}s...</span>}
        <button type="button" className="danger" onClick={onDelete}>
          Delete submission
        </button>
      </div>
      {status === 'error' && (
        <div className="banner error">{error_message || 'Unknown error (no message from backend)'}</div>
      )}

      <div className="review">
        <div className="panel image-panel">
          <h2>Original photo</h2>
          <SubmissionImage src={api.imageUrl(id)} />
        </div>

        <div className="code-panels">
          <div className="panel">
            <div className="panel-header">
              <h2>Transcription</h2>
              {!pending && editing !== 'transcription' && (
                <button type="button" onClick={() => setEditing('transcription')}>
                  {transcription == null ? 'Type code' : 'Edit'}
                </button>
              )}
            </div>
            {syntaxErrors.map((f, i) => (
              <div key={i} className="banner warn">
                Line {f.line}: {f.reason}
              </div>
            ))}
            {editing === 'transcription' ? (
              <CodeEditor
                initial={transcription ?? ''}
                note={
                  <>
                    <strong>Fix a misread</strong> to match the photo. This replaces the transcription and re-scores it,
                    since a model mistake shouldn't cost points.{' '}
                    {status === 'graded' && 'The final score you gave is kept; update it below if needed. '}
                    To see what fixing the student's own mistake would do, use the corrected version instead.
                  </>
                }
                runLabel="Re-run tests"
                onRun={async (code) => (await onRerun(code)) ?? setEditing(null)}
                onCancel={() => setEditing(null)}
              />
            ) : transcription != null ? (
              <>
                <CodeBlock code={transcription} highlight={edited ? [] : uncertainLines} />
                {!edited && uncertainLines.length > 0 && (
                  <p className="hint">Highlighted lines were marked uncertain by the model.</p>
                )}
                {edited && (
                  <details className="model-reading">
                    <summary>Edited by the professor. Show what the model read</summary>
                    {flags.model_transcription != null ? (
                      <CodeBlock code={flags.model_transcription} highlight={uncertainLines} />
                    ) : (
                      <p className="placeholder">The model returned no transcription.</p>
                    )}
                    {uncertainLines.length > 0 && (
                      <p className="hint">Highlighted lines were marked uncertain by the model.</p>
                    )}
                  </details>
                )}
              </>
            ) : (
              <p className="placeholder">
                {pending
                  ? 'Waiting for transcription...'
                  : 'No transcription returned. Type the code from the photo to test it.'}
              </p>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Corrected code</h2>
              {!pending && transcription != null && editing !== 'corrected' && (
                <div className="row">
                  <button type="button" onClick={() => setEditing('corrected')}>
                    {corrected_code == null ? 'Create' : 'Edit'}
                  </button>
                  {corrected_code != null && (
                    <button type="button" className="danger" onClick={() => setConfirmingDiscard(true)}>
                      Discard
                    </button>
                  )}
                </div>
              )}
            </div>
            {editing === 'corrected' ? (
              <CodeEditor
                initial={corrected_code ?? transcription}
                note={
                  <>
                    Fix the <strong>student's</strong> mistake to see how the code does without it. For comparison only:
                    the transcription and suggested score don't change.
                  </>
                }
                runLabel="Run corrected"
                onRun={async (code) => (await onSetCorrected(code)) ?? setEditing(null)}
                onCancel={() => setEditing(null)}
              />
            ) : corrected_code != null ? (
              <>
                <p className="hint">
                  {flags?.syntax_fix
                    ? 'Model syntax fix (comparison only):'
                    : 'Edited by the professor (comparison only).'}
                </p>
                {flags?.syntax_fix?.changes?.length > 0 && (
                  <ul className="fix-changes">
                    {flags.syntax_fix.changes.map((c, i) => (
                      <li key={i}>
                        Line {c.line}: {c.description}
                      </li>
                    ))}
                  </ul>
                )}
                <CodeBlock code={corrected_code} />
              </>
            ) : (
              <p className="placeholder">{pending ? 'Waiting...' : 'No corrected version generated.'}</p>
            )}
          </div>
        </div>

        <ConfirmDialog
          open={confirmingDiscard}
          title="Discard corrected version?"
          busy={discarding}
          message={
            <p>This removes the corrected code and its test results. The transcription and scores are not affected.</p>
          }
          confirmLabel="Discard"
          busyLabel="Discarding..."
          onConfirm={async () => {
            setDiscarding(true)
            await onDiscardCorrected()
            setDiscarding(false)
            setConfirmingDiscard(false)
          }}
          onCancel={() => setConfirmingDiscard(false)}
        />
      </div>

      <TestResults submission={submission} />
      <GradePanel key={id} submission={submission} pending={pending} hasNext={hasNext} onSave={onGrade} />
    </section>
  )
}

/**
 * The submission's photo, linked to the full-size file. If the image fails to
 * load, it says so instead of showing a broken image.
 *
 * @param {object} props
 * @param {string} props.src - Image URL.
 */
function SubmissionImage({ src }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (failed) return <p className="placeholder">Image failed to load from {src}</p>
  return (
    <a href={src} target="_blank" rel="noreferrer">
      <img src={src} alt="Handwritten submission" onError={() => setFailed(true)} />
    </a>
  )
}
