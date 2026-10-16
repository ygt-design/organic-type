// Sliders store 0-100; each config entry maps that onto its own `range`.
const lerp = (range, v) => range[0] + (range[1] - range[0]) * (v / 100)

export const sliderDefaults = (group) =>
  Object.fromEntries(Object.keys(group).map((k) => [k, group[k].default]))

export const resolveSliders = (group, values) =>
  Object.fromEntries(Object.keys(group).map((k) => [k, lerp(group[k].range, values[k])]))

export const pickSliders = (group, keys) => Object.fromEntries(keys.map((k) => [k, group[k]]))

// A tab with its own defaults keeps the shared labels and ranges but swaps in its
// own `default` per key, so tuning one tab never moves another.
export const withDefaults = (group, defaults = {}) =>
  Object.fromEntries(
    Object.entries(group).map(([k, spec]) => [k, k in defaults ? { ...spec, default: defaults[k] } : spec]),
  )
