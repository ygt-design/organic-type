import { useCallback, useEffect, useRef, useState } from 'react'
import opentype from 'opentype.js'
import fontUrl from '../../assets/fonts/CirrusCumulus.woff?url'
import { buildLayout, plantPaths } from './glyphGrowth.js'
import config from './growth.json'
import ScrollLab from './ScrollLab.jsx'
import ScrollLetters from './ScrollLetters.jsx'
import ModeSelect from './ModeSelect.jsx'
import { MODES, modeHash } from './modes.js'
import Panel, { Button, Field, Section, Slider, Toggle } from './Panel.jsx'
import { exportSvg } from './exportSvg.js'
import './Exploration.css'

const { sliders } = config
const lerp = (range, v) => range[0] + (range[1] - range[0]) * (v / 100)
// These sliders each drive several growth params, so the readout stays 0–100.
const PERCENT = [0, 100]

function Exploration({ view }) {
  const current = MODES.find((m) => m.id === view) ?? MODES[0]
  const mode = current.n
  const buildIdRef = useRef(0)
  const svgRef = useRef(null)
  const [font, setFont] = useState(null)
  const [layout, setLayout] = useState(null)
  const [letter, setLetter] = useState('T')
  const [word, setWord] = useState('Temple')
  const [complexity, setComplexity] = useState(sliders.complexity.default)
  const [length, setLength] = useState(sliders.branchLength.default)
  const [curviness, setCurviness] = useState(sliders.curviness.default)
  const [thickness, setThickness] = useState(sliders.thickness.default)
  const [overlap, setOverlap] = useState(config.overlap.default)
  const [swash, setSwash] = useState(config.swash.default)

  useEffect(() => {
    let cancelled = false
    fetch(fontUrl)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        if (cancelled) return
        setFont(opentype.parse(buffer))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Canonicalize bare, unknown or old-style (`#exploration/...`) URLs without adding a history entry.
  useEffect(() => {
    const hash = modeHash(current.id)
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash)
  }, [view, current.id])

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, select')) return
      if (mode === 1 && e.key.length === 1 && /[a-z0-9]/i.test(e.key)) setLetter(e.key)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode])

  const rebuild = useCallback(() => {
    if (!font || mode >= 4) return
    const opts = {
      seedSpacing: lerp(sliders.complexity.seedSpacing, complexity),
      iterRange: Math.round(lerp(sliders.complexity.iterRange, complexity)),
      maxTendril: lerp(sliders.branchLength.maxTendril, length),
      meanderAmp: lerp(sliders.curviness.meanderAmp, curviness),
      thickness: lerp(sliders.thickness.thickness, thickness),
      avoidOverlap: !overlap,
      swash,
    }
    const { cssW, cssH, placed } = buildLayout(font, mode, letter, word, opts)
    const ds = Math.min(1, (window.innerWidth * 0.96) / cssW, (window.innerHeight * 0.9) / cssH)
    const paths = []
    for (const it of placed) {
      for (const p of plantPaths(it.plant, it.scale, it.ox, it.oy, it.startG)) paths.push(p)
    }
    buildIdRef.current += 1
    setLayout({ cssW, cssH, ds, paths, id: buildIdRef.current })
  }, [font, mode, letter, word, complexity, length, curviness, thickness, overlap, swash])

  useEffect(() => {
    rebuild()
  }, [rebuild])

  if (mode === 4) return <ScrollLab modeSelect={<ModeSelect value={current.id} />} />
  if (mode === 5) return <ScrollLetters font={font} modeSelect={<ModeSelect value={current.id} />} />

  const exportName = `temple-${current.id}-${mode === 1 ? letter : mode === 3 ? word.trim() || 'word' : 'az'}`

  return (
    <div className="exploration">
      {layout && (
        <svg
          ref={svgRef}
          className="exploration__glyph"
          viewBox={`0 0 ${layout.cssW} ${layout.cssH}`}
          width={layout.cssW * layout.ds}
          height={layout.cssH * layout.ds}
          onClick={rebuild}
        >
          {layout.paths.map((p, i) => (
            <path
              key={`${layout.id}-${i}`}
              className="exploration__path"
              d={p.d}
              fill="none"
              stroke="#000000"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={p.width}
              style={{
                strokeDasharray: p.len,
                strokeDashoffset: p.len,
                animationDuration: `${p.dur}s`,
                animationDelay: `${p.delay}s`,
              }}
            />
          ))}
        </svg>
      )}
      <Panel
        modeSelect={<ModeSelect value={current.id} />}
        actions={<Button onClick={rebuild}>regrow</Button>}
        settings={{
          mode: current.id,
          file: 'src/features/exploration/growth.json',
          sliders: { complexity, branchLength: length, curviness, thickness },
          overlap,
          swash,
        }}
        onExport={() => exportSvg(svgRef.current, exportName)}
        footer={font ? 'click the drawing to regrow' : 'loading font…'}
      >
        {mode === 1 && (
          <Section title="Letter">
            <p className="panel__hint">press any key a–z, 0–9 · showing “{letter}”</p>
          </Section>
        )}
        {mode === 3 && (
          <Section title="Word">
            <Field label="text">
              <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="type a word" autoFocus />
            </Field>
          </Section>
        )}
        <Section title="Growth">
          <Slider label={sliders.complexity.label} range={PERCENT} value={complexity} onChange={setComplexity} />
          <Slider label={sliders.branchLength.label} range={PERCENT} value={length} onChange={setLength} />
          <Slider label={sliders.curviness.label} range={PERCENT} value={curviness} onChange={setCurviness} />
          <Toggle label={config.overlap.label} checked={overlap} onChange={setOverlap} />
          <Toggle label={config.swash.label} checked={swash} onChange={setSwash} />
        </Section>
        <Section title="Stroke">
          <Slider label={sliders.thickness.label} range={sliders.thickness.thickness} value={thickness} onChange={setThickness} />
        </Section>
      </Panel>
    </div>
  )
}

export default Exploration
