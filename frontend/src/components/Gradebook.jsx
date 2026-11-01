import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmtPoints } from '../format.js'

// One row per student, one column per assignment (GET /api/gradebook). A cell
// is the sum of the student's final scores on that assignment; when its score
// is null it shows n/a with the reason as a tooltip.
export default function Gradebook({ onResponse }) {
  const [assignments, setAssignments] = useState(null) // filter choices
  const [selected, setSelected] = useState(null) // Set of assignment ids, or null for all
  const [grid, setGrid] = useState(null)
  const [error, setError] = useState(null)
  const [version, setVersion] = useState(0) // bump to refresh

  // Only assignments with questions get a column, so only those can be filtered.
  useEffect(() => {
    let cancelled = false
    api
      .listAssignments()
      .then((res) => !cancelled && setAssignments(res.body.filter((a) => a.question_count > 0)))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [version])

  const ids = selected ? [...selected].sort((a, b) => a - b) : null
  const idsKey = ids ? ids.join(',') : ''

  useEffect(() => {
    let cancelled = false
    const url = `/api/gradebook${idsKey ? `?assignment_ids=${idsKey}` : ''}`
    api
      .getGradebook(ids)
      .then((res) => {
        if (cancelled) return
        onResponse(`GET ${url} -> ${res.status}`, res.body)
        setGrid(res.body)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        onResponse(`GET ${url} (failed)`, err.body ?? null)
        setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [idsKey, version])

  function toggle(id) {
    const next = new Set(selected ?? assignments.map((a) => a.id))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    // Everything checked is the same as no filter.
    setSelected(next.size === assignments.length ? null : next)
  }

  const isChecked = (id) => selected == null || selected.has(id)
  const checkedCount = selected ? selected.size : assignments?.length ?? 0

  return (
    <div className="panel gradebook">
      <div className="panel-header">
        <h2>Gradebook</h2>
        <div className="row">
          <button type="button" onClick={() => setVersion((v) => v + 1)}>
            Refresh
          </button>
          <a className="button-link" href={api.gradebookCsvUrl(ids)} download="gradebook.csv">
            Download CSV
          </a>
        </div>
      </div>
      <p className="hint">
        Each cell is the sum of a student's final scores on that assignment's questions; suggested scores don't count.
        Students are matched by submission name, so use the same name for a student on every question. Hover n/a to see
        why.
      </p>

      {assignments && assignments.length > 0 && (
        <div className="row gradebook-filter">
          <span>Show:</span>
          {assignments.map((a) => (
            <label key={a.id} className="inline">
              <input
                type="checkbox"
                checked={isChecked(a.id)}
                // Keep at least one; an empty filter would mean "all" to the backend.
                disabled={isChecked(a.id) && checkedCount === 1}
                onChange={() => toggle(a.id)}
              />
              {/* Same rule as the column headers: add the id when titles repeat. */}
              {assignments.filter((b) => b.title === a.title).length > 1 ? `${a.title} (#${a.id})` : a.title}
            </label>
          ))}
          {selected && (
            <button type="button" onClick={() => setSelected(null)}>
              Show all
            </button>
          )}
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      {!grid && !error && <p className="placeholder">Loading gradebook...</p>}
      {grid && grid.columns.length === 0 && <p className="placeholder">No assignments with questions yet.</p>}
      {grid && grid.columns.length > 0 && grid.rows.length === 0 && (
        <p className="placeholder">No submissions yet. Students show up here once a photo is uploaded under their name.</p>
      )}
      {grid && grid.columns.length > 0 && grid.rows.length > 0 && (
        <div className="gradebook-scroll">
          <table className="tests gradebook-table">
            <thead>
              <tr>
                <th>Student</th>
                {grid.columns.map((c) => (
                  <th key={c.assignment_id} className="num">
                    {c.header}
                  </th>
                ))}
              </tr>
              <tr className="max-row">
                <th>Max points</th>
                {grid.columns.map((c) => (
                  <th key={c.assignment_id} className="num">
                    {fmtPoints(c.max_points)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((r) => (
                <tr key={r.student}>
                  <td>{r.student}</td>
                  {r.cells.map((cell, i) => (
                    <td key={grid.columns[i].assignment_id} className="num">
                      {cell.score == null ? (
                        <span className="na" title={cell.reason ?? ''}>
                          n/a
                        </span>
                      ) : (
                        fmtPoints(cell.score)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
