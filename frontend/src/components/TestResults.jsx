// Test results tables on the review page.

import { fmtPoints } from '../format.js'

const VERSION_TITLES = {
  original: 'Transcribed code (sets the suggested score)',
  corrected: 'Corrected code (comparison only)',
}

/**
 * Per-test results for a submission: input, expected and actual output, the
 * points each test is worth, and pass/fail, with the total at the bottom. There
 * is one table per code version, original first.
 *
 * The backend doesn't send per-test scores. It scores a submission as
 * max_points * passed / total (backend/scoring.py), so each test is worth
 * max_points / total. The original's total row uses the backend's
 * suggested_score so the table always agrees with it, even where rounding the
 * per-test shares wouldn't. The corrected version's total is computed here.
 *
 * @param {object} props
 * @param {object} props.submission - The full submission from GET /api/submissions/:id.
 */
export default function TestResults({ submission }) {
  const { status, test_results: results = [], question, suggested_score, score_reasoning } = submission
  const pending = status === 'queued' || status === 'processing'

  let body
  if (pending) body = <p className="placeholder">Tests run after transcription finishes.</p>
  else if (status === 'error') body = <p className="placeholder">No test results: processing failed.</p>
  else if (results.length === 0)
    body = (
      <p className="placeholder">No test results: the question had no test cases when this submission was processed.</p>
    )
  else {
    const versions = ['original', 'corrected'].filter((v) => results.some((r) => r.version === v))
    body = versions.map((v) => (
      <ResultsTable
        key={v}
        title={versions.length > 1 ? VERSION_TITLES[v] : null}
        rows={results.filter((r) => r.version === v)}
        maxPoints={question?.max_points}
        total={v === 'original' ? suggested_score : null}
      />
    ))
  }

  return (
    <div className="panel results-panel">
      <h2>Test results</h2>
      {body}
      {!pending && score_reasoning && <p className="hint">{score_reasoning}</p>}
    </div>
  )
}

/**
 * One version's results table.
 *
 * @param {object} props
 * @param {string | null} props.title - Version heading; null when there is only one version.
 * @param {object[]} props.rows - That version's test_results.
 * @param {number | undefined} props.maxPoints - The question's max points.
 * @param {number | null} props.total - Total to show; null computes it from the rows.
 */
function ResultsTable({ title, rows, maxPoints, total }) {
  const share = maxPoints != null ? maxPoints / rows.length : null
  const passed = rows.filter((r) => r.passed).length
  const sum = total ?? (share != null ? share * passed : null)

  return (
    <>
      {title && <h3>{title}</h3>}
      <table className="tests results">
        <thead>
          <tr>
            <th>#</th>
            <th>Input</th>
            <th>Expected output</th>
            <th>Actual output</th>
            <th className="num">Score</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.passed ? undefined : 'failed'}>
              <td>{i + 1}</td>
              <td>
                <Output text={r.input} />
              </td>
              <td>
                <Output text={r.expected_output} />
              </td>
              <td>
                <Output text={r.actual_output} />
                {r.error && <pre className="run-error">{r.error}</pre>}
              </td>
              <td className="num">
                {share != null ? `${r.passed ? fmtPoints(share) : 0} / ${fmtPoints(share)}` : '-'}
              </td>
              <td>
                <span className={r.passed ? 'result result-pass' : 'result result-fail'}>
                  {r.passed ? 'Pass' : 'Fail'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="total-label">
              Total
            </td>
            <td className="num">
              <strong>{sum != null ? fmtPoints(sum) : '-'}</strong>
              {maxPoints != null && ` / ${fmtPoints(maxPoints)}`}
            </td>
            <td>
              {passed}/{rows.length} passed
            </td>
          </tr>
        </tfoot>
      </table>
    </>
  )
}

/** Preformatted program text, or "(empty)" so blank output is visible. */
function Output({ text }) {
  if (text == null || text === '') return <span className="hint">(empty)</span>
  return <pre>{text}</pre>
}
