import { Field } from './Panel.jsx'
import { MODES, modeHash } from './modes.js'

function ModeSelect({ value }) {
  return (
    <Field label="mode">
      <select
        value={value}
        onChange={(e) => {
          window.location.hash = modeHash(e.target.value)
        }}
      >
        {MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export default ModeSelect
