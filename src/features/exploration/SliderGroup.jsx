import { Slider } from './Panel.jsx'

function SliderGroup({ group, keys = Object.keys(group), values, setValues }) {
  return keys.map((k) => (
    <Slider
      key={k}
      label={group[k].label}
      range={group[k].range}
      round={group[k].round}
      value={values[k]}
      onChange={(v) => setValues((prev) => ({ ...prev, [k]: v }))}
    />
  ))
}

export default SliderGroup
