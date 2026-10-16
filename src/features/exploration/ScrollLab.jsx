import { useRef, useState } from 'react'
import { buildStroke, defaultChain, growScrolls, makeRng, packCircles } from './scrollGrowth.js'
import config from './scroll.json'
import SliderGroup from './SliderGroup.jsx'
import { resolveSliders, sliderDefaults } from './sliderValues.js'
import Panel, { Button, Section, Toggle } from './Panel.jsx'
import { exportSvg } from './exportSvg.js'

const { canvas, sliders, autoSliders } = config
const BLUE = '#2b3bd6'
const RED = '#e0473f'
const W = canvas.width
const H = canvas.height
// One quarter tile is grown, then reflected into the other three.
const CIRCLE_KEYS = ['count', 'maxRadius', 'minRadius', 'gap']
const STROKE_KEYS = ['startSweep', 'spiralTurns', 'spiralTightness', 'flow', 'thickness']
const MIRRORS = [
  '',
  `translate(${W} 0) scale(-1 1)`,
  `translate(0 ${H}) scale(1 -1)`,
  `translate(${W} ${H}) scale(-1 -1)`,
]

function SweepLabels({ sweeps }) {
  return sweeps.map((sw) => (
    <text key={sw.id} x={sw.x} y={sw.y + 12} className="scroll-lab__id" fill={BLUE}>
      {`${sw.s > 0 ? '↻' : '↺'} ${Math.round(sw.deg)}°`}
    </text>
  ))
}

function ScrollLab({ modeSelect }) {
  const svgRef = useRef(null)
  const [seed, setSeed] = useState(1)
  const [growSeed, setGrowSeed] = useState(1)
  const [values, setValues] = useState(() => sliderDefaults(sliders))
  const [autoValues, setAutoValues] = useState(() => sliderDefaults(autoSliders))
  const [auto, setAuto] = useState(true)
  const [newShapes, setNewShapes] = useState(config.newShapes.default)
  const [debug, setDebug] = useState(true)
  // Tagged with the packing it was picked on; a new packing falls back to the default chain.
  const [picked, setPicked] = useState({ key: null, items: [] })

  const p = resolveSliders(sliders, values)
  const a = resolveSliders(autoSliders, autoValues)
  const count = Math.round(p.count)
  const { maxRadius, gap } = p
  // Below this a spiral closes up into a blob that reads as a dot, so smaller
  // circles aren't packed at all.
  const minRadius = Math.max(p.minRadius, p.thickness * config.auto.minCurlScale)
  const packKey = `${seed}-${count}-${minRadius}-${maxRadius}-${gap}`
  const circles = packCircles(makeRng(seed), {
    count,
    minRadius,
    maxRadius,
    gap,
    width: W / 2,
    height: H / 2,
    seamMargin: gap / 2,
  })

  const chain = picked.key === packKey ? picked.items : defaultChain(circles, makeRng(seed + 1))
  const manual = auto ? null : buildStroke(circles, chain, p)

  const grown = auto
    ? growScrolls(circles, makeRng(seed * 7919 + growSeed), {
        ...a,
        stems: Math.round(a.stems),
        depth: Math.round(a.depth),
        maxSteps: Math.round(a.maxSteps),
        reach: gap + a.reach,
        newShapes,
        startSweep: p.startSweep,
        spiralTurns: p.spiralTurns,
        spiralTightness: p.spiralTightness,
        flow: p.flow,
        thickness: p.thickness,
        // A curve this close to a seam would touch its own mirrored copy.
        pointBlocked: (x, y, clear) => x > W / 2 - clear / 2 || y > H / 2 - clear / 2,
      })
    : null
  // Any change regrows, so a fresh key per state restarts the draw-in animation.
  const animKey = JSON.stringify([packKey, growSeed, auto, newShapes, values, autoValues, chain])
  const art = auto ? grown.strokes : manual ? [{ ...manual, revealAt: 0 }] : []

  const used = auto ? grown.used : new Set(chain.map((k) => k.id))
  const ds = Math.min(1, (window.innerWidth * 0.96) / W, (window.innerHeight * 0.9) / H)

  const onCircleClick = (id) => {
    if (auto) return
    const last = chain[chain.length - 1]
    let items
    if (last && last.id === id) items = [...chain.slice(0, -1), { id, s: -last.s }]
    else if (used.has(id)) return
    else items = [...chain, { id, s: last ? -last.s : 1 }]
    setPicked({ key: packKey, items })
  }

  const circleColor = (id) => (used.has(id) ? BLUE : RED)

  return (
    <div className="exploration">
      <svg
        ref={svgRef}
        className={auto ? 'scroll-lab' : 'scroll-lab scroll-lab--manual'}
        viewBox={`0 0 ${W} ${H}`}
        width={W * ds}
        height={H * ds}
      >
        {MIRRORS.map((t) => (
          <g key={t} transform={t || undefined}>
            {art.map((s, i) => (
              <path
                key={`${animKey}-${i}`}
                className="exploration__path"
                d={s.d}
                fill="none"
                stroke="#000000"
                strokeWidth={p.thickness}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  strokeDasharray: s.len,
                  strokeDashoffset: s.len,
                  animationDuration: `${s.len / config.drawSpeed}s`,
                  animationDelay: `${s.revealAt / config.drawSpeed}s`,
                }}
              />
            ))}
          </g>
        ))}

        <g data-export="skip">
        {circles.map((c) => (
          <g key={c.id} className="scroll-lab__circle" onClick={() => onCircleClick(c.id)}>
            <circle
              cx={c.x}
              cy={c.y}
              r={c.r}
              fill="transparent"
              stroke={debug ? circleColor(c.id) : 'none'}
              strokeWidth={used.has(c.id) ? 1 : 0.6}
              opacity={used.has(c.id) ? 1 : 0.6}
            />
            {debug && (
              <text x={c.x} y={c.y} className="scroll-lab__id" fill={circleColor(c.id)}>
                {c.id}
              </text>
            )}
          </g>
        ))}
        </g>

        {debug && manual && (
          <g data-export="skip" className="scroll-lab__debug">
            {manual.lines.map((l, i) => (
              <g key={i}>
                {l.blocked && (
                  <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={RED} strokeWidth="3" opacity="0.5" />
                )}
                <circle cx={l.a.x} cy={l.a.y} r="2.5" fill={BLUE} />
                <circle cx={l.b.x} cy={l.b.y} r="2.5" fill={BLUE} />
              </g>
            ))}
            <SweepLabels sweeps={manual.sweeps} />
          </g>
        )}
        {debug && (
          <g data-export="skip" className="scroll-lab__debug" stroke={RED} strokeDasharray="4 4" opacity="0.6">
            <line x1={W / 2} y1="0" x2={W / 2} y2={H} />
            <line x1="0" y1={H / 2} x2={W} y2={H / 2} />
          </g>
        )}
        {debug && grown && (
          <g data-export="skip" className="scroll-lab__debug">
            {grown.strokes.map((s, i) => (
              <g key={i}>
                {/* Red = where a stem starts, blue = where a branch forks off its parent. */}
                <circle cx={s.start.x} cy={s.start.y} r="3" fill={s.depth ? BLUE : RED} />
                <SweepLabels sweeps={s.depth ? s.sweeps.slice(1) : s.sweeps} />
              </g>
            ))}
          </g>
        )}
      </svg>

      <Panel
        modeSelect={modeSelect}
        actions={
          <>
            <Button onClick={() => setSeed((s) => s + 1)}>new circles</Button>
            {auto ? (
              <Button onClick={() => setGrowSeed((s) => s + 1)}>regrow</Button>
            ) : (
              <Button onClick={() => setPicked({ key: packKey, items: [] })}>clear</Button>
            )}
          </>
        }
        settings={{
          mode: 'scroll',
          file: 'src/features/exploration/scroll.json',
          sliders: values,
          autoSliders: autoValues,
          newShapes,
        }}
        onExport={() => exportSvg(svgRef.current, 'temple-scroll')}
        footer={
          auto
            ? `${grown.strokes.length} strokes · ${circles.length - grown.used.size} empty · ${grown.tried} tried`
            : 'click circles to chain · click the last to flip'
        }
      >
        <Section title="Circles">
          <SliderGroup group={sliders} keys={CIRCLE_KEYS} values={values} setValues={setValues} />
        </Section>
        <Section title="Stroke">
          <SliderGroup group={sliders} keys={STROKE_KEYS} values={values} setValues={setValues} />
        </Section>
        <Section title="Growth">
          <Toggle label="auto" checked={auto} onChange={setAuto} />
          {auto && (
            <>
              <SliderGroup group={autoSliders} values={autoValues} setValues={setAutoValues} />
              <Toggle label={config.newShapes.label} checked={newShapes} onChange={setNewShapes} />
            </>
          )}
        </Section>
        <Section title="View">
          <Toggle label="debug" checked={debug} onChange={setDebug} />
        </Section>
      </Panel>
    </div>
  )
}

export default ScrollLab
