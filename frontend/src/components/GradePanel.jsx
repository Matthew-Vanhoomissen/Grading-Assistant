// Final score form on the review page.

import { useState } from 'react'
import { fmtPoints } from '../format.js'

/**
 * Final score and notes for one submission, shown under the test results. The
 * score is pre-filled with the saved final score, else the suggested score, and
 * the professor confirms or changes it. Saving sets the status to "graded",
 * which is what the gradebook counts. Render with key={submission.id} so the
 * form resets for each submission.
 *
 * @param {object} props
 * @param {object} props.submission - The full submission from GET /api/submissions/:id.
 * @param {boolean} props.pending - True while queued or processing; grading is disabled then.
 * @param {boolean} props.hasNext - Whether Confirm & Next has an ungraded submission to open.
 * @param {(fields: {final_score: number, notes: string | null}, next: boolean) => Promise<boolean>} props.onSave -
 *   Saves the grade (POST /api/submissions/:id/grade); `next` also opens the next ungraded submission.
 */
export default function GradePanel({ submission, pending, hasNext, onSave }) {
  const { status, suggested_score, final_score, score_reasoning, question } = submission
  const maxPoints = question?.max_points
  const graded = status === 'graded'
  // Inputs stay null until edited, so the pre-fill follows a re-score (e.g. after the question is edited).
  const [scoreInput, setScoreInput] = useState(null)
  const [notesInput, setNotesInput] = useState(null)
  const [saving, setSaving] = useState(false)

  const prefill = final_score ?? suggested_score
  const score = scoreInput ?? (prefill == null ? '' : String(prefill))
  const notes = notesInput ?? submission.notes ?? ''
  const overMax = score !== '' && maxPoints != null && Number(score) > maxPoints
  // What the corrected version would score with the backend's formula, to help decide partial credit.
  const corrected = (submission.test_results ?? []).filter((r) => r.version === 'corrected')
  const correctedPassed = corrected.filter((r) => r.passed).length
  const correctedScore = corrected.length && maxPoints != null ? (maxPoints * correctedPassed) / corrected.length : null

  /** Saves the grade; on success the inputs reset to follow the saved values. */
  async function save(next) {
    setSaving(true)
    // The backend overwrites notes on every grade, so they are always sent.
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
      {corrected.length > 0 && (
        <p className="hint">
          Corrected version: passes {correctedPassed} of {corrected.length} tests
          {correctedScore != null && ` (would be ${fmtPoints(correctedScore)} / ${fmtPoints(maxPoints)})`}. For
          comparison only; it doesn't change the suggested score.
        </p>
      )}
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
            // This is not a submit button, so run the form's validation (e.g. no negative scores) by hand.
            if (e.currentTarget.form.reportValidity()) save(true)
          }}
          title={
            hasNext ? 'Save and open the next ungraded submission' : 'No other ungraded submissions for this question'
          }
        >
          {graded ? 'Update & Next' : 'Confirm & Next'}
        </button>
      </div>
    </form>
  )
}
