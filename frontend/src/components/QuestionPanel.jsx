// Right setup panel: the selected question's settings and test cases.

import { useState } from 'react'
import { api } from '../api.js'
import { callApi } from '../callApi.js'
import { fmtPoints, questionLabel } from '../format.js'
import ConfirmDialog from './ConfirmDialog.jsx'

/**
 * Shows the selected question's points, match mode, prompt, and test cases,
 * with Edit (a dropdown form) and Delete. Test cases can be added and deleted
 * here. While `creating`, or when the assignment has no questions yet, it
 * shows the add-question form instead.
 *
 * @param {object} props
 * @param {object | null} props.detail - GET /api/assignments/:id; its questions include test_cases.
 * @param {number | null} props.questionId - The selected question.
 * @param {boolean} props.creating - Show the add-question form.
 * @param {boolean} props.creatingAssignment - True while the assignment itself is being created.
 * @param {() => void} props.onCancelCreate - Closes the add-question form.
 * @param {(question: object) => void} props.onCreated - Receives the new question.
 * @param {(id: number) => void} props.onDeleted - Called after the question is deleted.
 * @param {() => void} props.onChanged - Re-fetches `detail` after test cases change.
 * @param {() => void} props.onEdited - Called after a successful edit. Changing points or match mode re-scores
 *   the question's submissions, so the caller refreshes more than `detail`.
 * @param {(label: string, body: any) => void} props.onResponse - Reports to the Raw JSON panel.
 */
export default function QuestionPanel({
  detail,
  questionId,
  creating,
  creatingAssignment,
  onCancelCreate,
  onCreated,
  onDeleted,
  onChanged,
  onEdited,
  onResponse,
}) {
  const [error, setError] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null) // { id, label, tests, submissions }
  const [deleting, setDeleting] = useState(false)
  const [editingId, setEditingId] = useState(null) // question whose edit form is open
  const call = (label, fn) => callApi(label, fn, { onResponse, setError })

  const question = detail?.questions.find((q) => q.id === questionId) ?? null
  // An assignment with no questions goes straight to the add-question form.
  const showForm = detail != null && (creating || detail.questions.length === 0)
  // Editing is tied to a question id, so selecting another question closes the edit form.
  const editing = question != null && !showForm && editingId === question.id

  async function handleCreate(fields) {
    const res = await call(`POST /api/assignments/${detail.id}/questions`, () => api.createQuestion(detail.id, fields))
    if (!res) return false
    onCreated(res.body)
    return true
  }

  async function handleEdit(fields) {
    const res = await call(`PATCH /api/questions/${question.id}`, () => api.updateQuestion(question.id, fields))
    if (!res) return false
    setEditingId(null)
    await onEdited()
    return true
  }

  async function handleAddTest(fields) {
    const res = await call(`POST /api/questions/${question.id}/tests`, () => api.addTestCase(question.id, fields))
    if (!res) return false
    await onChanged() // the response is only the new id
    return true
  }

  async function handleDeleteTest(id) {
    const res = await call(`DELETE /api/tests/${id}`, () => api.deleteTestCase(id))
    if (res) await onChanged()
  }

  /** Counts the question's submissions so the confirmation says exactly what will be deleted. */
  async function askDelete() {
    let submissions = null
    try {
      submissions = (await api.listSubmissions(question.id)).body.length
    } catch {
      // The count is informational, so a failed lookup still allows the delete.
    }
    setPendingDelete({
      id: question.id,
      label: questionLabel(question),
      tests: question.test_cases.length,
      submissions,
    })
  }

  async function confirmDelete() {
    const { id } = pendingDelete
    setDeleting(true)
    const res = await call(`DELETE /api/questions/${id}`, () => api.deleteQuestion(id))
    setDeleting(false)
    setPendingDelete(null)
    if (res) onDeleted(id)
  }

  let body
  if (creatingAssignment) body = <p className="placeholder">Create the assignment first, then add its questions.</p>
  else if (detail == null) body = <p className="placeholder">Select an assignment first.</p>
  else if (showForm)
    body = (
      <>
        {detail.questions.length === 0 && (
          <p className="hint">This assignment has no questions yet. Add the first one.</p>
        )}
        <QuestionForm
          titlePlaceholder={`Question ${detail.questions.length + 1}`}
          submitLabel={`Add question ${detail.questions.length + 1}`}
          savingLabel="Adding..."
          onSubmit={handleCreate}
          onCancel={detail.questions.length > 0 ? onCancelCreate : null}
        />
      </>
    )
  else if (question == null) body = <p className="placeholder">Loading question...</p>
  else
    body = (
      <>
        {editing && (
          <div className="edit-question">
            <h3>Edit question</h3>
            <QuestionForm
              key={question.id}
              initial={question}
              titlePlaceholder={`Question ${question.position}`}
              submitLabel="Save changes"
              savingLabel="Saving..."
              note="Changing max points or output match re-scores this question's submissions from their saved outputs. Final scores already given are kept."
              onSubmit={handleEdit}
              onCancel={() => setEditingId(null)}
            />
          </div>
        )}
        <div className="assignment-info">
          <div>
            Max points: <strong>{fmtPoints(question.max_points)}</strong> | Output match:{' '}
            <strong>{question.exact_match ? 'exact' : 'ignore trailing whitespace'}</strong>
          </div>
          {question.prompt ? <p className="prompt">{question.prompt}</p> : <p className="hint">No prompt.</p>}
        </div>

        <h3>Test cases</h3>
        {question.test_cases.length === 0 ? (
          <p className="placeholder">No test cases yet. Uploads will get no suggested score until you add some.</p>
        ) : (
          <table className="tests">
            <thead>
              <tr>
                <th>#</th>
                <th>Input (stdin)</th>
                <th>Expected output</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {question.test_cases.map((t, i) => (
                <tr key={t.id}>
                  <td>{i + 1}</td>
                  <td>{t.input ? <pre>{t.input}</pre> : <span className="hint">(none)</span>}</td>
                  <td>
                    <pre>{t.expected_output}</pre>
                  </td>
                  <td>
                    <button type="button" onClick={() => handleDeleteTest(t.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AddTestForm key={question.id} onSubmit={handleAddTest} />
      </>
    )

  return (
    <div className="panel question-panel">
      <div className="panel-header">
        <h2>{showForm ? 'New question' : question ? questionLabel(question) : 'Question'}</h2>
        {question && !showForm && !creatingAssignment && (
          <div className="row">
            <button type="button" aria-expanded={editing} onClick={() => setEditingId(editing ? null : question.id)}>
              {editing ? 'Close edit' : 'Edit question'}
            </button>
            <button type="button" className="danger" onClick={askDelete}>
              Delete question
            </button>
          </div>
        )}
      </div>
      {body}

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete question?"
        busy={deleting}
        message={
          pendingDelete && (
            <>
              <p>
                This permanently deletes <strong>{pendingDelete.label}</strong> along with:
              </p>
              <ul>
                <li>
                  {pendingDelete.tests} test case{pendingDelete.tests === 1 ? '' : 's'}
                </li>
                <li>
                  {pendingDelete.submissions ?? 'all'} submission{pendingDelete.submissions === 1 ? '' : 's'}, with
                  their uploaded photos, test results, and scores
                </li>
              </ul>
              <p>Later questions are renumbered. This cannot be undone.</p>
            </>
          )
        }
        confirmLabel="Delete question"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {error && <div className="banner error">{error}</div>}
    </div>
  )
}

/**
 * Question fields form, used both to add a question and, with `initial`, to
 * edit one. An edit sends only the fields that changed, and Save stays disabled
 * until something does.
 *
 * @param {object} props
 * @param {object} [props.initial] - The question being edited; omit to add a new one.
 * @param {string} props.titlePlaceholder - Shown in the empty title field ("Question N").
 * @param {string} props.submitLabel - Submit button label.
 * @param {string} props.savingLabel - Submit button label while saving.
 * @param {string} [props.note] - Hint shown above the buttons.
 * @param {(fields: object) => Promise<boolean>} props.onSubmit - Saves the (changed) fields.
 * @param {(() => void) | null} props.onCancel - Closes the form; null hides Cancel.
 */
function QuestionForm({ initial, titlePlaceholder, submitLabel, savingLabel, note, onSubmit, onCancel }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [maxPoints, setMaxPoints] = useState(initial ? String(initial.max_points) : '10')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [exactMatch, setExactMatch] = useState(Boolean(initial?.exact_match))
  const [saving, setSaving] = useState(false)

  const fields = { title: title.trim(), max_points: Number(maxPoints), prompt, exact_match: exactMatch }
  // exact_match comes back from the backend as 0/1, so compare it as a boolean.
  const changed = initial
    ? Object.fromEntries(
        Object.entries(fields).filter(([k, v]) => (k === 'exact_match' ? v !== Boolean(initial[k]) : v !== initial[k])),
      )
    : fields
  const nothingChanged = initial != null && Object.keys(changed).length === 0

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onSubmit(changed)
    setSaving(false)
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Title (optional)
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={titlePlaceholder} />
      </label>
      <label>
        Max points
        <input
          type="number"
          min="0"
          step="any"
          value={maxPoints}
          onChange={(e) => setMaxPoints(e.target.value)}
          required
        />
      </label>
      <label>
        Prompt
        <textarea rows="3" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <label className="inline">
        <input type="checkbox" checked={exactMatch} onChange={(e) => setExactMatch(e.target.checked)} />
        Exact output match (off: trailing whitespace and blank lines are ignored)
      </label>
      {note && <p className="hint">{note}</p>}
      <div className="row">
        <button type="submit" disabled={saving || maxPoints === '' || nothingChanged}>
          {saving ? savingLabel : submitLabel}
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

/**
 * Add-test-case form (stdin input and expected output). Clears itself after a
 * successful add.
 *
 * @param {object} props
 * @param {(fields: {input: string, expected_output: string}) => Promise<boolean>} props.onSubmit - Adds the test case.
 */
function AddTestForm({ onSubmit }) {
  const [input, setInput] = useState('')
  const [expected, setExpected] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    const ok = await onSubmit({ input, expected_output: expected })
    setSaving(false)
    if (ok) {
      setInput('')
      setExpected('')
    }
  }

  return (
    <form className="add-test" onSubmit={handleSubmit}>
      <label>
        Input (stdin, optional)
        <textarea rows="3" value={input} onChange={(e) => setInput(e.target.value)} />
      </label>
      <label>
        Expected output
        <textarea rows="3" value={expected} onChange={(e) => setExpected(e.target.value)} />
      </label>
      <div>
        <button type="submit" disabled={saving}>
          {saving ? 'Adding...' : 'Add test case'}
        </button>
      </div>
    </form>
  )
}
