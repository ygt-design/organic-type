import { useRef, useState } from 'react'
import PanelSwash from './PanelSwash.jsx'
import './Panel.css'

const POSITION_KEY = 'temple.panel.position'
const EDGE = 12
// Below this a press on the header counts as a click (collapse), not a drag.
const CLICK_SLOP = 4
const randomSeed = () => Math.floor(Math.random() * 2 ** 31)

// Clipboard API needs a secure context; the textarea fallback covers plain http.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

const readPosition = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY))
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return saved
  } catch {
    // Unavailable or malformed storage just means the default spot.
  }
  return { x: EDGE + 4, y: EDGE + 4 }
}

// Every mode mounts its own panel, so the position lives in storage: switching
// modes keeps the panel where it was dropped. `settings` is the mode's current
// slider/toggle state in its JSON config's shape, copied so it can become the
// new defaults.
function Panel({ modeSelect, actions, settings, onExport, footer, children }) {
  const ref = useRef(null)
  const drag = useRef(null)
  const [position, setPosition] = useState(readPosition)
  const [collapsed, setCollapsed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [swashSeed, setSwashSeed] = useState(randomSeed)
  const [copied, setCopied] = useState(null)

  // A fresh swash on every toggle doubles as feedback that the click landed.
  const toggle = () => {
    setCollapsed((c) => !c)
    setSwashSeed(randomSeed())
  }

  const copySettings = async () => {
    const ok = await copyText(JSON.stringify(settings, null, 2))
    setCopied(ok ? 'copied' : 'copy failed')
    setTimeout(() => setCopied(null), 1600)
  }

  // Keep at least the header on screen, whatever the panel's height.
  const clamp = ({ x, y }) => {
    const rect = ref.current?.getBoundingClientRect()
    const w = rect?.width ?? 0
    return {
      x: Math.min(Math.max(EDGE, x), Math.max(EDGE, window.innerWidth - w - EDGE)),
      y: Math.min(Math.max(EDGE, y), Math.max(EDGE, window.innerHeight - 48)),
    }
  }

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    drag.current = { dx: e.clientX - position.x, dy: e.clientY - position.y, x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    setPosition(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }))
  }
  const onPointerUp = (e) => {
    if (!drag.current) return
    const moved = Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y)
    drag.current = null
    if (moved < CLICK_SLOP) toggle()
    setDragging(false)
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(position))
    } catch {
      // Not persisting is fine; the panel still stays put for this visit.
    }
  }

  return (
    <aside
      ref={ref}
      aria-label="Controls"
      className={`panel${collapsed ? ' panel--collapsed' : ''}${dragging ? ' panel--dragging' : ''}`}
      style={{ left: position.x, top: position.y, maxHeight: `calc(100vh - ${position.y + EDGE}px)` }}
    >
      <header
        className="panel__header"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          toggle()
        }}
        role="button"
        tabIndex={0}
        aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
        aria-expanded={!collapsed}
      >
        <PanelSwash seed={swashSeed} />
      </header>
      {!collapsed && (
        <>
          <div className="panel__body">
            {modeSelect}
            {children}
          </div>
          <div className="panel__actions">
            {actions}
            {settings && (
              <Button wide onClick={copySettings}>
                {copied ?? 'copy settings'}
              </Button>
            )}
            {onExport && (
              <Button primary onClick={onExport}>
                export svg
              </Button>
            )}
          </div>
          {footer && <div className="panel__footer">{footer}</div>}
        </>
      )}
    </aside>
  )
}

export function Section({ title, children }) {
  return (
    <section className="panel__section">
      <h2 className="panel__section-title">{title}</h2>
      {children}
    </section>
  )
}

const formatValue = (range, v, round) => {
  if (round || Math.abs(range[1] - range[0]) >= 10) return Math.round(v).toString()
  return v.toFixed(2)
}

// Sliders store 0–100; the readout shows the value it actually maps to.
export function Slider({ label, range, round, value, onChange }) {
  const mapped = range[0] + (range[1] - range[0]) * (value / 100)
  return (
    <label className="panel__slider">
      <span className="panel__row">
        <span>{label}</span>
        <span className="panel__value">{formatValue(range, mapped, round)}</span>
      </span>
      <input type="range" min="0" max="100" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

export function Toggle({ label, checked, onChange }) {
  return (
    <label className="panel__toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function Field({ label, children }) {
  return (
    <label className="panel__field">
      <span className="panel__row">{label}</span>
      {children}
    </label>
  )
}

export function Button({ primary, wide, children, ...props }) {
  const variant = primary ? ' panel__button--primary' : wide ? ' panel__button--wide' : ''
  return (
    <button type="button" className={`panel__button${variant}`} {...props}>
      {children}
    </button>
  )
}

export default Panel
