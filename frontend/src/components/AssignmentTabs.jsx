// Tab bar for switching between assignments.

import { useEffect, useRef } from 'react'
import { fmtPoints } from '../format.js'

/**
 * Horizontal tab bar across the top of the Grading view. Tabs scroll sideways
 * when they overflow and the active one is kept in view. "+ New assignment"
 * sits outside the scrolling area so it is always visible.
 *
 * @param {object} props
 * @param {object[] | null} props.assignments - Rows from GET /api/assignments; null while loading.
 * @param {number | null} props.selectedId - The open assignment.
 * @param {boolean} props.creating - True while the create-assignment form is open.
 * @param {string | null} props.error - Shown instead of the tabs when the list failed to load.
 * @param {(id: number) => void} props.onSelect - Called with the clicked tab's assignment id.
 * @param {() => void} props.onNew - Opens the create-assignment form.
 */
export default function AssignmentTabs({ assignments, selectedId, creating, error, onSelect, onNew }) {
  const activeRef = useRef(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId, creating, assignments])

  return (
    <div className="tabs-bar">
      <nav className="tabs" aria-label="Assignments">
        {error ? (
          <div className="banner error">{error}</div>
        ) : assignments == null ? (
          <span className="placeholder tabs-loading">Loading assignments...</span>
        ) : (
          assignments.map((a) => {
            const active = a.id === selectedId && !creating
            return (
              <button
                key={a.id}
                type="button"
                ref={active ? activeRef : null}
                className={active ? 'tab active' : 'tab'}
                aria-current={active ? 'page' : undefined}
                title={`#${a.id} ${a.title} (${a.question_count} question${a.question_count === 1 ? '' : 's'}, ${fmtPoints(a.total_points)} pts)`}
                onClick={() => onSelect(a.id)}
              >
                {a.title}
              </button>
            )
          })
        )}
      </nav>
      <button type="button" className={creating ? 'tab tab-new active' : 'tab tab-new'} onClick={onNew}>
        + New assignment
      </button>
    </div>
  )
}
