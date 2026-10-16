// `n` is the numeric mode buildLayout understands; `id` is the URL segment.
export const MODES = [
  { id: 'letter', label: 'single letter', n: 1 },
  { id: 'alphabet', label: 'alphabet', n: 2 },
  { id: 'word', label: 'word', n: 3 },
  { id: 'scroll', label: 'scroll lab', n: 4 },
  { id: 'scroll-letters', label: 'scroll letters', n: 5 },
]

export const modeHash = (id) => `#${id}`
