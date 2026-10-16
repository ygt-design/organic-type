import { growScrolls, makeRng, packCircles } from './scrollGrowth.js'
import config from './scroll.json'
import { resolveSliders, sliderDefaults } from './sliderValues.js'

// A miniature of the scroll lab at its default settings: half a strip is packed
// and grown, then mirrored across the centre like the lab's tiles. Units are ~1px
// at the header's size.
const HALF = 107
const HEIGHT = 40
const STROKE = 1.4
// Growth is random, so a few candidates are grown and the one with the most
// line wins: that biases toward rich ornaments without making them alike.
const CANDIDATES = 4
const DRAW_SPEED = 110

const lab = resolveSliders(config.sliders, sliderDefaults(config.sliders))
const growth = resolveSliders(config.autoSliders, sliderDefaults(config.autoSliders))
// Every length scales by the same factor as the stroke, so curl size, spacing and
// reach keep the lab's proportions; angles, spirals and growth rules carry over as-is.
const SCALE = STROKE / lab.thickness
const GAP = lab.gap * SCALE
const MIN_RADIUS = Math.max(lab.minRadius, lab.thickness * config.auto.minCurlScale) * SCALE

function growSwash(seed, attempt) {
  const rng = makeRng(seed + attempt * 104729)
  const circles = packCircles(rng, {
    count: Math.round(lab.count),
    minRadius: MIN_RADIUS,
    maxRadius: lab.maxRadius * SCALE,
    gap: GAP,
    width: HALF,
    height: HEIGHT,
    margin: STROKE,
    seamMargin: GAP / 2,
    tries: 1000,
  })
  const { strokes } = growScrolls(circles, rng, {
    ...growth,
    stems: Math.round(growth.stems),
    depth: Math.round(growth.depth),
    maxSteps: Math.round(growth.maxSteps),
    reach: GAP + growth.reach * SCALE,
    newShapes: config.newShapes.default,
    startSweep: lab.startSweep,
    spiralTurns: lab.spiralTurns,
    spiralTightness: lab.spiralTightness,
    flow: lab.flow,
    thickness: STROKE,
    pointBlocked: (x, y, clear) => x > HALF - clear / 2,
  })
  return { strokes, ink: strokes.reduce((total, s) => total + s.len, 0) }
}

function PanelSwash({ seed }) {
  let best = null
  for (let k = 0; k < CANDIDATES; k++) {
    const grown = growSwash(seed, k)
    if (!best || grown.ink > best.ink) best = grown
  }

  return (
    <svg className="panel__swash" viewBox={`0 0 ${HALF * 2} ${HEIGHT}`} aria-hidden="true" focusable="false">
      {['', `translate(${HALF * 2} 0) scale(-1 1)`].map((transform) => (
        <g key={`${seed}-${transform}`} transform={transform || undefined} strokeWidth={STROKE}>
          {best.strokes.map((s, i) => (
            <path
              key={i}
              d={s.d}
              style={{
                strokeDasharray: s.len,
                strokeDashoffset: s.len,
                animationDuration: `${s.len / DRAW_SPEED}s`,
                animationDelay: `${s.revealAt / DRAW_SPEED}s`,
              }}
            />
          ))}
        </g>
      ))}
    </svg>
  )
}

export default PanelSwash
