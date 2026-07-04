import type { ReactNode } from 'react'

type ModalProps = {
  title: string
  onClose?: () => void
  dismissible?: boolean
  children: ReactNode
}

function Modal({ title, onClose, dismissible = true, children }: ModalProps) {
  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (dismissible) onClose?.()
      }}
    >
      <div className="modal-card panel" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          {dismissible && (
            <button className="modal-close" onClick={onClose} aria-label="סגור">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

export default Modal
