import { useRef, useState } from 'react'
import { catmullRomPath } from './glyphGrowth.js'
import { buildLetterField, letterSprouts } from './letterField.js'
import { growScrolls, makeRng, packCircles } from './scrollGrowth.js'
import config from './scroll.json'
import SliderGroup from './SliderGroup.jsx'
import { pickSliders, resolveSliders, sliderDefaults, withDefaults } from './sliderValues.js'
import Panel, { Button, Field, Section, Toggle } from './Panel.jsx'
import { exportSvg } from './exportSvg.js'

const { canvas, letters } = config
const W = canvas.width
const H = canvas.height
const SCROLL_SLIDERS = withDefaults(pickSliders(config.sliders, [
  'count',
  'maxRadius',
  'minRadius',
  'gap',
  'startSweep',
  'spiralTurns',
  'spiralTightness',
  'flow',
  'thickness',
]), letters.defaults.sliders)
const GROWTH_SLIDERS = withDefaults(pickSliders(config.autoSliders, [
  'depth',
  'branching',
  'mirror',
  'reverse',
  'maxSteps',
  'reach',
  'tolerance',
]), letters.defaults.autoSliders)
const CIRCLE_KEYS = ['count', 'maxRadius', 'minRadius', 'gap']
const STROKE_KEYS = ['startSweep', 'spiralTurns', 'spiralTightness', 'flow', 'thickness']
// Skeleton pixels are a staircase; thinning before the spline smooths it out.
const BODY_STEP = 3
const BLUE = '#2b3bd6'
const RED = '#e0473f'
const GREEN = '#2e9d57'

function DrawnPath({ d, len, width, delay }) {
  return (
    <path
      className="exploration__path"
      d={d}
      fill="none"
      stroke="#000000"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        strokeDasharray: len,
        strokeDashoffset: len,
        animationDuration: `${len / config.drawSpeed}s`,
        animationDelay: `${delay}s`,
      }}
    />
  )
}

function ScrollLetters({ font, modeSelect }) {
  const svgRef = useRef(null)
  const [text, setText] = useState(letters.text)
  const [seed, setSeed] = useState(1)
  const [letterValues, setLetterValues] = useState(() => sliderDefaults(letters.sliders))
  const [values, setValues] = useState(() => sliderDefaults(SCROLL_SLIDERS))
  const [growValues, setGrowValues] = useState(() => sliderDefaults(GROWTH_SLIDERS))
  const [debug, setDebug] = useState(false)
  const [newShapes, setNewShapes] = useState(letters.defaults.newShapes)

  const l = resolveSliders(letters.sliders, letterValues)
  const p = resolveSliders(SCROLL_SLIDERS, values)
  const g = resolveSliders(GROWTH_SLIDERS, growValues)
  // Below this a spiral closes up into a blob that reads as a dot.
  const minRadius = Math.max(p.minRadius, p.thickness * config.auto.minCurlScale)
  const size = l.size
  const field = font && text.trim() ? buildLetterField(font, text, { width: W, height: H, size, margin: letters.margin, pocketDepth: letters.pocketDepth }) : null

  let body = []
  let circles = []
  let sproutCount = 0
  let grown = null
  if (field) {
    body = field.chains.map((c) => catmullRomPath(c.filter((_, i) => i % BODY_STEP === 0 || i === c.length - 1)))
    const rng = makeRng(seed)
    const sprouts = letterSprouts(field, rng, {
      spacing: l.sprouts,
      minR: Math.max(minRadius, letters.minSproutRadius),
      maxR: p.maxRadius,
      gap: p.gap,
      margin: canvas.margin,
    })
    sproutCount = sprouts.length
    // Packed circles stay clear of the letter and within `spread` of it, and
    // never inside a counter, so flourishes hug the word instead of tiling the page.
    circles = packCircles(rng, {
      count: Math.round(p.count),
      minRadius,
      maxRadius: p.maxRadius,
      gap: p.gap,
      initial: sprouts,
      tries: letters.tries,
      accept: (x, y, r) => {
        const d = field.distAt(x, y)
        return d >= r + p.gap && d <= r + l.spread && field.isOutside(x, y)
      },
    })
    grown = growScrolls(circles, rng, {
      ...g,
      depth: Math.round(g.depth),
      maxSteps: Math.round(g.maxSteps),
      reach: p.gap + g.reach,
      startSweep: p.startSweep,
      newShapes,
      spiralTurns: p.spiralTurns,
      spiralTightness: p.spiralTightness,
      flow: p.flow,
      thickness: p.thickness,
      pointBlocked: (x, y, clear) => field.distAt(x, y) < clear,
      seeds: sprouts.map((c, id) => ({ id, s: c.s, from: c.from })),
      lineBlocked: (line) => field.lineHits(line.a, line.b, p.thickness + letters.clearance),
    })
  }

  const animKey = JSON.stringify([text, seed, newShapes, letterValues, values, growValues])
  const bodyEnd = Math.max(0, ...body.map((b) => b.len)) / config.drawSpeed
  const ds = Math.min(1, (window.innerWidth * 0.96) / W, (window.innerHeight * 0.9) / H)
  const circleColor = (c) => (c.id < sproutCount ? GREEN : grown?.used.has(c.id) ? BLUE : RED)

  return (
    <div className="exploration">
      <svg ref={svgRef} className="scroll-lab" viewBox={`0 0 ${W} ${H}`} width={W * ds} height={H * ds}>
        {body.map((b, i) => (
          <DrawnPath key={`${animKey}-body-${i}`} d={b.d} len={b.len} width={p.thickness} delay={0} />
        ))}
        {grown?.strokes.map((s, i) => (
          <DrawnPath
            key={`${animKey}-${i}`}
            d={s.d}
            len={s.len}
            width={p.thickness}
            delay={bodyEnd + s.revealAt / config.drawSpeed}
          />
        ))}
        {debug && (
          <g data-export="skip" className="scroll-lab__debug">
            {circles.map((c) => (
              <circle
                key={c.id}
                cx={c.x}
                cy={c.y}
                r={c.r}
                fill="none"
                stroke={circleColor(c)}
                strokeWidth={c.id < sproutCount ? 1 : 0.6}
                opacity={grown?.used.has(c.id) ? 1 : 0.6}
              />
            ))}
          </g>
        )}
      </svg>

      <Panel
        modeSelect={modeSelect}
        actions={
          <>
            <Button onClick={() => setSeed((s) => s + 1)}>regrow</Button>
          </>
        }
        settings={{
          mode: 'scroll-letters',
          file: 'src/features/exploration/scroll.json',
          letters: {
            text,
            sliders: letterValues,
            defaults: { sliders: values, autoSliders: growValues, newShapes },
          },
        }}
        onExport={() => exportSvg(svgRef.current, `temple-${text.trim() || 'letters'}`)}
        footer={
          !font
            ? 'loading font…'
            : grown
              ? `${sproutCount} sprouts · ${grown.strokes.length} strokes · ${circles.length - grown.used.size} empty`
              : 'type a word to grow'
        }
      >
        <Section title="Word">
          <Field label="text">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="type a word" />
          </Field>
          <SliderGroup group={letters.sliders} values={letterValues} setValues={setLetterValues} />
        </Section>
        <Section title="Circles">
          <SliderGroup group={SCROLL_SLIDERS} keys={CIRCLE_KEYS} values={values} setValues={setValues} />
        </Section>
        <Section title="Stroke">
          <SliderGroup group={SCROLL_SLIDERS} keys={STROKE_KEYS} values={values} setValues={setValues} />
        </Section>
        <Section title="Growth">
          <SliderGroup group={GROWTH_SLIDERS} values={growValues} setValues={setGrowValues} />
          <Toggle label={config.newShapes.label} checked={newShapes} onChange={setNewShapes} />
        </Section>
        <Section title="View">
          <Toggle label="debug" checked={debug} onChange={setDebug} />
        </Section>
      </Panel>
    </div>
  )
}

export default ScrollLetters
