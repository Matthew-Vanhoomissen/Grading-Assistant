import { useState } from 'react'

// Plain textarea for editing code on the review page. Tab inserts four
// spaces (Python indentation) instead of moving focus. `onRun(code)` returns
// an error message, or null on success, which closes the editor.
export default function CodeEditor({ initial, note, runLabel, onRun, onCancel }) {
  const [draft, setDraft] = useState(initial)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  function handleKeyDown(e) {
    if (e.key !== 'Tab' || e.shiftKey) return
    e.preventDefault()
    const el = e.currentTarget
    el.setRangeText('    ', el.selectionStart, el.selectionEnd, 'end')
    setDraft(el.value)
  }

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
