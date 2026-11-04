// Left setup panel: the selected assignment and its question list.

import { useState } from 'react'
import { api } from '../api.js'
import { callApi } from '../callApi.js'
import { fmtPoints, questionLabel } from '../format.js'
import ConfirmDialog from './ConfirmDialog.jsx'

/**
 * Shows the selected assignment's question count, total points, and ordered
 * question list (click one to select it; "+ Add question" opens the form in
 * QuestionPanel), with a delete button. While `creating`, it shows the
 * create-assignment form instead.
 *
 * @param {object} props
 * @param {object | null} props.detail - GET /api/assignments/:id; null while loading.
 * @param {number | null} props.assignmentId - The selected assignment.
 * @param {boolean} props.creating - Show the create-assignment form.
 * @param {(() => void) | null} props.onCancelCreate - Closes the form; null hides Cancel (nothing to go back to).
 * @param {(row: object) => void} props.onCreated - Receives the new assignment.
 * @param {(id: number) => void} props.onDeleted - Called after the assignment is deleted.
 * @param {number | null} props.questionId - The selected question.
 * @param {boolean} props.creatingQuestion - True while the add-question form is open.
 * @param {(id: number) => void} props.onSelectQuestion - Selects a question.
 * @param {() => void} props.onAddQuestion - Opens the add-question form.
 * @param {string | null} props.loadError - Shown when the detail failed to load.
 * @param {(label: string, body: any) => void} props.onResponse - Reports to the Raw JSON panel.
 */
export default function AssignmentPanel({
  detail,
  assignmentId,
  creating,
  onCancelCreate,
  onCreated,
  onDeleted,
  questionId,
  creatingQuestion,
  onSelectQuestion,
  onAddQuestion,
  loadError,
  onResponse,
}) {
  const [error, setError] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null) // { id, title, questions, tests, submissions }
  const [deleting, setDeleting] = useState(false)
  const call = (label, fn) => callApi(label, fn, { onResponse, setError })

  async function handleCreate(fields) {
    const res = await call('POST /api/assignments', () => api.createAssignment(fields))
    if (!res) return false
    onCreated(res.body)
    return true
  }

  /** Counts everything under the assignment so the confirmation says exactly what will be deleted. */
  async function askDelete() {
    let submissions = null
    try {
      const lists = await Promise.all(detail.questions.map((q) => api.listSubmissions(q.id)))
      submissions = lists.reduce((n, res) => n + res.body.length, 0)
    } catch {
      // The count is informational, so a failed lookup still allows the delete.
    }
    const tests = detail.questions.reduce((n, q) => n + q.test_cases.length, 0)
    setPendingDelete({ id: detail.id, title: detail.title, questions: detail.questions.length, tests, submissions })
  }

  async function confirmDelete() {
    const { id } = pendingDelete
    setDeleting(true)
    const res = await call(`DELETE /api/assignments/${id}`, () => api.deleteAssignment(id))
    setDeleting(false)
    setPendingDelete(null)
    if (res) onDeleted(id)
  }

  /** "1 question", "3 questions"; "all ..." when the count is unknown. */
  const plural = (n, word) => `${n ?? 'all'} ${word}${n === 1 ? '' : 's'}`

  return (
    <div className="panel">
      <h2>{creating ? 'New assignment' : 'Assignment'}</h2>
      {creating ? (
        <CreateAssignmentForm onSubmit={handleCreate} onCancel={onCancelCreate} />
      ) : assignmentId == null ? (
        <p className="placeholder">No assignment selected. Pick a tab above or create one.</p>
      ) : loadError ? (
        <div className="banner error">{loadError}</div>
      ) : detail == null ? (
        <p className="placeholder">Loading assignment...</p>
      ) : (
        <>
          <div className="row">
            <strong className="assignment-title">{detail.title}</strong>
            <span className="hint">#{detail.id}</span>
            <button type="button" className="danger push-right" onClick={askDelete}>
              Delete assignment
            </button>
          </div>
          <div className="assignment-info">
            {plural(detail.question_count, 'question')} | Total points:{' '}
            <strong>{fmtPoints(detail.total_points)}</strong>
          </div>

          <ul className="question-list">
            {detail.questions.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  className={q.id === questionId && !creatingQuestion ? 'question-item selected' : 'question-item'}
                  onClick={() => onSelectQuestion(q.id)}
                >
                  <span className="item-label">{questionLabel(q)}</span>
                  <span className="item-meta">
                    {fmtPoints(q.max_points)} pts | {plural(q.test_cases.length, 'test')}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className={creatingQuestion ? 'question-item add selected' : 'question-item add'}
                onClick={onAddQuestion}
              >
                + Add question
              </button>
            </li>
          </ul>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete assignment?"
        busy={deleting}
        message={
          pendingDelete && (
            <>
              <p>
                This permanently deletes <strong>{pendingDelete.title}</strong> along with:
              </p>
              <ul>
                <li>{plural(pendingDelete.questions, 'question')}</li>
                <li>{plural(pendingDelete.tests, 'test case')}</li>
                <li>
                  {plural(pendingDelete.submissions, 'submission')}, with their uploaded photos, test results, and
                  scores
                </li>
              </ul>
              <p>This cannot be undone.</p>
            </>
          )
        }
        confirmLabel="Delete assignment"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {error && <div className="banner error">{error}</div>}
    </div>
  )
}

/**
 * Create-assignment form. Only the title is asked for; points, prompts, and
 * test cases belong to questions.
 *
 * @param {object} props
 * @param {(fields: {title: string}) => Promise<boolean>} props.onSubmit - Creates the assignment.
 * @param {(() => void) | null} props.onCancel - Closes the form; null hides Cancel.
 */
function CreateAssignmentForm({ onSubmit, onCancel }) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onSubmit({ title: title.trim() })
    setSaving(false)
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <p className="hint">Points, prompts, and test cases are set per question after you create it.</p>
      <div className="row">
        <button type="submit" disabled={saving || !title.trim()}>
          {saving ? 'Creating...' : 'Create assignment'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
