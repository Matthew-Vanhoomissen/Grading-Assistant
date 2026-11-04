// Confirmation dialog for destructive actions.

import { useEffect, useRef } from 'react'

/**
 * Modal yes/no prompt built on the native <dialog> element, whose showModal()
 * provides focus trapping and Escape-to-cancel. It is controlled: the dialog is
 * shown while `open` is true, and the caller closes it from onConfirm/onCancel.
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the dialog is shown.
 * @param {string} props.title - Heading.
 * @param {import('react').ReactNode} props.message - Body describing what will be removed.
 * @param {string} [props.confirmLabel] - Label for the destructive button.
 * @param {string} [props.busyLabel] - Label for the destructive button while the action runs.
 * @param {boolean} [props.busy] - Disables both buttons while the action runs.
 * @param {() => void} props.onConfirm - Runs the action.
 * @param {() => void} props.onCancel - Closes without acting; also used for Escape.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  busyLabel = 'Deleting...',
  busy = false,
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="confirm"
      onCancel={(e) => {
        // Escape would close the dialog natively; route it through onCancel so `open` stays in sync.
        e.preventDefault()
        if (!busy) onCancel()
      }}
    >
      <h2>{title}</h2>
      <div className="confirm-message">{message}</div>
      <div className="row confirm-actions">
        <button type="button" onClick={onCancel} disabled={busy} autoFocus>
          Cancel
        </button>
        <button type="button" className="danger" onClick={onConfirm} disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
