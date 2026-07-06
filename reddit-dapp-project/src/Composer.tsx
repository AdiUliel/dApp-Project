// Upgraded text box: textarea + emoji picker, and (in rich mode) bold/italic
// markdown helpers. Used for post bodies, comments and community descriptions —
// never for usernames or community names (those stay ASCII-validated).
import { useRef, useState, type ReactNode } from 'react'

const EMOJIS = [
  '😀', '😂', '🤣', '😊', '😍', '😎', '🤔', '😢', '😭', '😡', '🥳', '🤯',
  '👍', '👎', '👏', '🙏', '💪', '🤝', '👀', '🔥', '💯', '✨', '⭐', '❤️',
  '💔', '🎉', '🎊', '🚀', '⚡', '💡', '✅', '❌', '⚠️', '❓', '❗', '💬',
  '🍕', '☕', '🍺', '⚽', '🎮', '🎵', '📷', '💻', '🧠', '🐱', '🐶', '🌍',
]

// Renders a limited markdown subset: **bold**, *italic*, `code`, plus real
// line breaks (plain <p>{text}</p> was collapsing newlines).
export function renderRichText(text: string): ReactNode {
  if (!text) return text
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }
    return part
  })
}

type ComposerProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rich?: boolean
  className?: string
}

export function Composer({ value, onChange, placeholder, rich = false, className }: ComposerProps) {
  const [showEmojis, setShowEmojis] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Inserts text at the caret (falls back to appending) and restores focus.
  const insertAtCursor = (inserted: string, wrap = false) => {
    const textarea = textareaRef.current
    if (!textarea) {
      onChange(value + inserted)
      return
    }
    const start = textarea.selectionStart ?? value.length
    const end = textarea.selectionEnd ?? value.length
    const next = wrap
      ? value.slice(0, start) + inserted + value.slice(start, end) + inserted + value.slice(end)
      : value.slice(0, start) + inserted + value.slice(end)
    onChange(next)
    const caret = wrap ? end + inserted.length : start + inserted.length
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className={`composer ${className || ''}`}>
      <textarea
        ref={textareaRef}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="composer-toolbar">
        <button
          type="button"
          className={`composer-tool ${showEmojis ? 'active' : ''}`}
          title="Emoji"
          onClick={() => setShowEmojis((previous) => !previous)}
        >
          😊
        </button>
        {rich && (
          <>
            <button type="button" className="composer-tool bold" title="**bold**" onClick={() => insertAtCursor('**', true)}>
              B
            </button>
            <button type="button" className="composer-tool italic" title="*italic*" onClick={() => insertAtCursor('*', true)}>
              I
            </button>
            <button type="button" className="composer-tool mono" title="`code`" onClick={() => insertAtCursor('`', true)}>
              {'<>'}
            </button>
          </>
        )}
      </div>
      {showEmojis && (
        <div className="emoji-grid">
          {EMOJIS.map((emoji) => (
            <button type="button" key={emoji} onClick={() => insertAtCursor(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
