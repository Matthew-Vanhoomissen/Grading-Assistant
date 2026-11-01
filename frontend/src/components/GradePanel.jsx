import { useState } from 'react'
import { fmtPoints } from '../format.js'

// Final score for one submission, under the test results. Pre-filled with the
// saved final score, else the suggested score; the professor confirms or
// changes it. Saving calls POST /api/submissions/:id/grade (via onSave), which
// sets status to "graded" so the score counts in the gradebook.
// Render with key={submission.id} so the form resets per submission.
export default function GradePanel({ submission, pending, hasNext, onSave }) {
  const { status, suggested_score, final_score, score_reasoning, question } = submission
  const maxPoints = question?.max_points
  const graded = status === 'graded'
  // null until edited, so the pre-fill follows a re-score (e.g. after editing the question).
  const [scoreInput, setScoreInput] = useState(null)
  const [notesInput, setNotesInput] = useState(null)
  const [saving, setSaving] = useState(false)

  const prefill = final_score ?? suggested_score
  const score = scoreInput ?? (prefill == null ? '' : String(prefill))
  const notes = notesInput ?? submission.notes ?? ''
  const overMax = score !== '' && maxPoints != null && Number(score) > maxPoints

  async function save(next) {
    setSaving(true)
    // The backend overwrites notes on every grade, so always send them.
    const ok = await onSave({ final_score: Number(score), notes: notes.trim() || null }, next)
    setSaving(false)
    if (ok) {
      setScoreInput(null)
      setNotesInput(null)
    }
  }

  if (pending) {
    return (
      <div className="panel grade-panel">
        <h2>Final score</h2>
        <p className="placeholder">Grading opens once processing finishes.</p>
      </div>
    )
  }

  return (
    <form
      className="panel grade-panel"
      onSubmit={(e) => {
        e.preventDefault()
        save(false)
      }}
    >
      <div className="panel-header">
        <h2>Final score</h2>
        {graded && (
          <span className="hint">
            Graded: <strong>{fmtPoints(final_score)}</strong>
            {maxPoints != null && ` / ${fmtPoints(maxPoints)}`}
          </span>
        )}
      </div>
      <p className="hint">
        {suggested_score != null
          ? `Suggested: ${fmtPoints(suggested_score)}${maxPoints != null ? ` / ${fmtPoints(maxPoints)}` : ''}. ${score_reasoning ?? ''}`
          : 'No suggested score (no test results for this submission). Enter a score from the photo and code.'}
      </p>
      <div className="grade-fields">
        <label>
          Score{maxPoints != null && ` (out of ${fmtPoints(maxPoints)})`}
          <input
            type="number"
            min="0"
            step="any"
            required
            value={score}
            onChange={(e) => setScoreInput(e.target.value)}
          />
        </label>
        <label className="grow">
          Notes (optional)
          <textarea rows="2" value={notes} onChange={(e) => setNotesInput(e.target.value)} />
        </label>
      </div>
      {overMax && <p className="hint warn-text">Above max points. Saved as entered (extra credit?).</p>}
      <div className="row">
        <button type="submit" disabled={saving || score === ''}>
          {saving ? 'Saving...' : graded ? 'Update grade' : 'Confirm'}
        </button>
        <button
          type="button"
          disabled={saving || score === '' || !hasNext}
          onClick={(e) => {
            // Same validation as the submit button (e.g. no negative scores).
            if (e.currentTarget.form.reportValidity()) save(true)
          }}
          title={hasNext ? 'Save and open the next ungraded submission' : 'No other ungraded submissions for this question'}
        >
          {graded ? 'Update & Next' : 'Confirm & Next'}
        </button>
      </div>
    </form>
  )
}
