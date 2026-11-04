// Plain-textarea code editor for the review page.

import { useState } from 'react'

/**
 * Editable code with Run and Cancel buttons. Tab inserts four spaces (Python
 * indentation) instead of moving focus. Run stays disabled until the code
 * differs from `initial`. If `onRun` reports an error, the editor stays open
 * and shows it, so the edit isn't lost.
 *
 * @param {object} props
 * @param {string} props.initial - Starting code.
 * @param {import('react').ReactNode} [props.note] - Explanation shown above the textarea.
 * @param {string} props.runLabel - Label for the run button.
 * @param {(code: string) => Promise<string | null | undefined>} props.onRun - Runs the code; resolves to an error message, or nothing on success.
 * @param {() => void} props.onCancel - Closes the editor without running.
 */
export default function CodeEditor({ initial, note, runLabel, onRun, onCancel }) {
  const [draft, setDraft] = useState(initial)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  /** Inserts four spaces at the cursor on Tab; Shift+Tab keeps its normal focus behavior. */
  function handleKeyDown(e) {
    if (e.key !== 'Tab' || e.shiftKey) return
    e.preventDefault()
    const el = e.currentTarget
    el.setRangeText('    ', el.selectionStart, el.selectionEnd, 'end')
    setDraft(el.value)
  }

  /** Runs the draft and shows the error, if any. */
  async function run() {
    setRunning(true)
    setError(null)
    const err = await onRun(draft)
    setRunning(false)
    if (err) setError(err)
  }

  return (
    <div className="code-editor">
      {note && <p className="hint">{note}</p>}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={Math.max(6, draft.split('\n').length + 1)}
        spellCheck={false}
        aria-label="Code"
      />
      <div className="row">
        <button type="button" onClick={run} disabled={running || draft === initial}>
          {running ? 'Running tests...' : runLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={running}>
          Cancel
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
    </div>
  )
}
