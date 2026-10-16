import { useCallback, useEffect, useRef, useState } from 'react'
import opentype from 'opentype.js'
import fontUrl from '../assets/fonts/CirrusCumulus.woff?url'
import './Exploration.css'

const RASTER_HEIGHT = 300
const RASTER_PAD = 30

const AXIOM = 'X'
const RULES = {
  X: [
    'F[+X][-X]',
    'F[-X][+X]',
    'F[+X]X',
    'F[-X]X',
    'F[+X][-X]X',
    'F[++X][-X]',
    'F[+X][--X]',
    'FF[+X]-X',
    'F[-X]FX',
    'FX',
  ],
  F: 'FF',
}
const TENDRIL_SEGMENT = 5
const ANGLE = (30  * Math.PI) / 180
const ANGLE_JITTER = 0.5
const CURL = 0.13

const SEED_SPACING = 24
const PCA_RADIUS = 7
const BRANCH_SPREAD = (10 * Math.PI) / 180
const MAX_TENDRIL_LENGTH = 75
const GROW_SPEED = 4
const SVG_SPEED = GROW_SPEED * 60
const STROKE_WEIGHT = 0.5
const BRANCH_WEIGHT = 100

const CANVAS_W = 720
const CANVAS_H = 900
const CANVAS_PAD = 90

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function zhangSuenThin(grid, w, h) {
  const idx = (x, y) => y * w + x
  const toDelete = []
  const pass = (variant) => {
    toDelete.length = 0
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!grid[idx(x, y)]) continue
        const p2 = grid[idx(x, y - 1)]
        const p3 = grid[idx(x + 1, y - 1)]
        const p4 = grid[idx(x + 1, y)]
        const p5 = grid[idx(x + 1, y + 1)]
        const p6 = grid[idx(x, y + 1)]
        const p7 = grid[idx(x - 1, y + 1)]
        const p8 = grid[idx(x - 1, y)]
        const p9 = grid[idx(x - 1, y - 1)]
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
        if (b < 2 || b > 6) continue
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
        let a = 0
        for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) a++
        if (a !== 1) continue
        if (variant === 0) {
          if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue
        } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue
        toDelete.push(idx(x, y))
      }
    }
    for (const i of toDelete) grid[i] = 0
    return toDelete.length > 0
  }
  let changed = true
  while (changed) changed = pass(0) || pass(1)
}

function expand(axiom, rules, iterations) {
  let current = axiom
  for (let i = 0; i < iterations; i++) {
    let next = ''
    for (const ch of current) {
      const rule = rules[ch]
      if (rule == null) next += ch
      else if (Array.isArray(rule)) next += rule[Math.floor(Math.random() * rule.length)]
      else next += rule
    }
    current = next
  }
  return current
}

// Turtle-interpret the L-system string into polyline chains rooted at (0,0),
// heading `startAngle`. Each chain is `[{x,y,d}...]` where d = arc length from the
// tendril root; a fork ('[') begins a new chain at the current point.
function buildTendril(str, startAngle, segLen, maxLen) {
  const chains = []
  const stack = []
  let x = 0
  let y = 0
  let angle = startAngle
  let dist = 0
  let chain = [{ x, y, d: dist }]
  const rand = () => 1 + (Math.random() * 2 - 1) * ANGLE_JITTER
  for (const ch of str) {
    if (ch === 'F') {
      angle += (Math.random() * 2 - 1) * CURL
      if (dist >= maxLen) continue
      x += Math.cos(angle) * segLen
      y += Math.sin(angle) * segLen
      dist += segLen
      chain.push({ x, y, d: dist })
    } else if (ch === '+') angle += ANGLE * rand()
    else if (ch === '-') angle -= ANGLE * rand()
    else if (ch === '[') {
      stack.push({ x, y, angle, dist, chain })
      chain = [{ x, y, d: dist }]
    } else if (ch === ']') {
      if (chain.length >= 2) chains.push(chain)
      const s = stack.pop()
      x = s.x
      y = s.y
      angle = s.angle
      dist = s.dist
      chain = s.chain
    }
  }
  if (chain.length >= 2) chains.push(chain)
  return chains
}

// Trace a thinned (skeleton) grid into polyline chains. Walks each degree-2 run
// between nodes (endpoints/junctions), then any leftover pure loops. Each chain is
// ordered low-d → high-d so a reveal sweep matches geodesic growth from the root.
function tracePolylines(skel, gw, gh, dist) {
  const idx = (x, y) => y * gw + x
  const neighbors = (x, y) => {
    const out = []
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && skel[idx(nx, ny)]) out.push([nx, ny])
      }
    }
    return out
  }

  const pixels = []
  const deg = new Map()
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!skel[idx(x, y)]) continue
      pixels.push([x, y])
      deg.set(idx(x, y), neighbors(x, y).length)
    }
  }

  const usedEdge = new Set()
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  const chains = []
  const withD = (x, y) => ({ x, y, d: dist[idx(x, y)] })

  const walk = (sx, sy, nx, ny) => {
    const pts = [withD(sx, sy)]
    let px = sx
    let py = sy
    let cx = nx
    let cy = ny
    while (true) {
      usedEdge.add(edgeKey(idx(px, py), idx(cx, cy)))
      pts.push(withD(cx, cy))
      if (deg.get(idx(cx, cy)) !== 2) break
      let advanced = false
      for (const [ax, ay] of neighbors(cx, cy)) {
        if (ax === px && ay === py) continue
        if (usedEdge.has(edgeKey(idx(cx, cy), idx(ax, ay)))) continue
        px = cx
        py = cy
        cx = ax
        cy = ay
        advanced = true
        break
      }
      if (!advanced) break
    }
    return pts
  }

  for (const [x, y] of pixels) {
    if (deg.get(idx(x, y)) === 2) continue
    for (const [nx, ny] of neighbors(x, y)) {
      if (usedEdge.has(edgeKey(idx(x, y), idx(nx, ny)))) continue
      chains.push(walk(x, y, nx, ny))
    }
  }
  for (const [x, y] of pixels) {
    for (const [nx, ny] of neighbors(x, y)) {
      if (usedEdge.has(edgeKey(idx(x, y), idx(nx, ny)))) continue
      chains.push(walk(x, y, nx, ny))
    }
  }

  const result = []
  for (const c of chains) {
    if (c.length < 2) continue
    if (c[0].d > c[c.length - 1].d) c.reverse()
    result.push(c)
  }
  return result
}

// Local flow direction of the stroke at (px,py): the way the stroke is heading
// as it travels away from the root (toward increasing geodesic distance).
// Branches follow THIS direction (they lean off it), rather than crossing it.
function flowAngle(px, py, seedDist, points, dist, gw, radius) {
  let fx = 0
  let fy = 0
  for (const p of points) {
    if (Math.abs(p.x - px) > radius || Math.abs(p.y - py) > radius) continue
    if ((p.x - px) ** 2 + (p.y - py) ** 2 > radius * radius) continue
    const nd = dist[p.y * gw + p.x]
    if (!Number.isFinite(nd)) continue
    const w = nd - seedDist
    fx += (p.x - px) * w
    fy += (p.y - py) * w
  }
  if (fx === 0 && fy === 0) return null
  return Math.atan2(fy, fx)
}

// Build one glyph plant: rasterize the char, skeletonize (medial axis), compute
// geodesic distance from the stem base, and seed organic L-system twigs along the
// skeleton. Geometry stays in raster px (px params scaled by rasterHeight/300 so the
// look is identical at any raster resolution). Returns null for empty glyphs (spaces).
function makePlant(font, char, rasterHeight) {
  const k = rasterHeight / RASTER_HEIGHT
  const path = font.getPath(char, 0, 0, rasterHeight)
  const box = path.getBoundingBox()
  if (!Number.isFinite(box.x1) || box.x2 <= box.x1 || box.y2 <= box.y1) return null

  const gw = Math.ceil(box.x2 - box.x1) + RASTER_PAD * 2
  const gh = Math.ceil(box.y2 - box.y1) + RASTER_PAD * 2
  const off = document.createElement('canvas')
  off.width = gw
  off.height = gh
  const offCtx = off.getContext('2d')
  font.getPath(char, RASTER_PAD - box.x1, RASTER_PAD - box.y1, rasterHeight).draw(offCtx)
  const alpha = offCtx.getImageData(0, 0, gw, gh).data

  const skel = new Uint8Array(gw * gh)
  for (let i = 0; i < gw * gh; i++) skel[i] = alpha[i * 4 + 3] > 127 ? 1 : 0
  zhangSuenThin(skel, gw, gh)

  const points = []
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) if (skel[y * gw + x]) points.push({ x, y, d: 0 })
  }
  if (points.length === 0) return null

  // Geodesic distance per connected component: many glyphs in this font have extra
  // strokes detached from the main body, so each disconnected component floods from
  // its own bottom-most pixel and grows independently.
  const dist = new Float32Array(gw * gh).fill(Infinity)
  let remaining = points
  while (remaining.length) {
    let root = null
    for (const p of remaining) {
      if (dist[p.y * gw + p.x] !== Infinity) continue
      if (!root || p.y > root.y) root = p
    }
    if (!root) break
    dist[root.y * gw + root.x] = 0
    let frontier = [root]
    while (frontier.length) {
      const nextF = []
      for (const p of frontier) {
        const base = dist[p.y * gw + p.x]
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nx = p.x + dx
            const ny = p.y + dy
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || !skel[ny * gw + nx]) continue
            const step = Math.hypot(dx, dy)
            if (base + step < dist[ny * gw + nx]) {
              dist[ny * gw + nx] = base + step
              nextF.push({ x: nx, y: ny })
            }
          }
        }
      }
      frontier = nextF
    }
    remaining = remaining.filter((p) => dist[p.y * gw + p.x] === Infinity)
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxReveal = 0
  for (const p of points) {
    p.d = dist[p.y * gw + p.x]
    if (Number.isFinite(p.d)) maxReveal = Math.max(maxReveal, p.d)
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  const seedSpacing = SEED_SPACING * k
  const ordered = [...points].sort((a, b) => a.d - b.d)
  const seeds = []
  for (const p of ordered) {
    let tooClose = false
    for (const s of seeds) {
      if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 < seedSpacing * seedSpacing) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue
    const flow = flowAngle(p.x, p.y, p.d, points, dist, gw, PCA_RADIUS * k)
    if (flow == null) continue
    const sides = Math.random() < 0.55 ? [Math.random() < 0.5 ? 1 : -1] : [1, -1]
    const chains = []
    let maxLocal = 0
    for (const side of sides) {
      const spread = BRANCH_SPREAD * (0.7 + Math.random() * 0.6)
      const startAngle = flow + side * spread + (Math.random() * 2 - 1) * 0.06
      const iter = 2 + Math.floor(Math.random() * 3)
      const segLen = TENDRIL_SEGMENT * k * (0.55 + Math.random() * 1.1)
      const maxLen = MAX_TENDRIL_LENGTH * k * (0.55 + Math.random() * 0.45)
      for (const c of buildTendril(expand(AXIOM, RULES, iter), startAngle, segLen, maxLen)) {
        maxLocal = Math.max(maxLocal, c[c.length - 1].d)
        chains.push(c)
      }
    }
    seeds.push({ x: p.x, y: p.y, seedDist: p.d, chains, maxLocal })
  }
  for (const s of seeds) maxReveal = Math.max(maxReveal, s.seedDist + s.maxLocal)

  return {
    bodyChains: tracePolylines(skel, gw, gh, dist),
    seeds,
    minX,
    minY,
    maxX,
    maxY,
    maxReveal,
    strokeRaster: STROKE_WEIGHT * k,
    origin: { x: RASTER_PAD - box.x1, y: RASTER_PAD - box.y1 },
    advance: font.getAdvanceWidth(char, rasterHeight),
  }
}

// Turn one plant-local polyline into an SVG path descriptor placed at (ox,oy)*scale.
// `baseDist` is the chain's reveal offset (seed dist for branches, 0 for the body);
// delay/dur (seconds) map its geodesic reveal window onto the CSS grow animation.
function emitPath(pts, baseDist, startG, width, scale, ox, oy) {
  let d = `M ${(pts[0].x * scale + ox).toFixed(2)} ${(pts[0].y * scale + oy).toFixed(2)}`
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const px = pts[i - 1].x * scale + ox
    const py = pts[i - 1].y * scale + oy
    const cx = pts[i].x * scale + ox
    const cy = pts[i].y * scale + oy
    d += ` L ${cx.toFixed(2)} ${cy.toFixed(2)}`
    len += Math.hypot(cx - px, cy - py)
  }
  const revealLen = Math.max(0.001, pts[pts.length - 1].d - pts[0].d)
  const startReveal = Math.max(0, startG + baseDist + pts[0].d)
  return { d, width, len, delay: startReveal / SVG_SPEED, dur: revealLen / SVG_SPEED }
}

// All SVG path descriptors for a placed plant (body skeleton + branch chains).
function plantPaths(plant, scale, ox, oy, startG) {
  const out = []
  const bodyBase = Math.max(1, plant.strokeRaster * scale)
  const bodyWidth = 2 * bodyBase
  const branchWidth = 2 * bodyBase * BRANCH_WEIGHT
  for (const c of plant.bodyChains) out.push(emitPath(c, 0, startG, bodyWidth, scale, ox, oy))
  for (const s of plant.seeds) {
    for (const c of s.chains) {
      const pts = c.map((p) => ({ x: s.x + p.x, y: s.y + p.y, d: p.d }))
      out.push(emitPath(pts, s.seedDist, startG, branchWidth, scale, ox, oy))
    }
  }
  return out
}

// Build the placed-plant list + canvas size for the active mode.
function buildLayout(font, mode, letter, word) {
  if (mode === 2) {
    const rh = 120
    const cols = 13
    const rows = Math.ceil(ALPHABET.length / cols)
    const cellW = 88
    const cellH = 180
    const scale = (cellH * 0.4) / rh
    const placed = []
    let maxReveal = 0
    ;[...ALPHABET].forEach((ch, i) => {
      const plant = makePlant(font, ch, rh)
      if (!plant) return
      const cx = (i % cols) * cellW + cellW / 2
      const cy = Math.floor(i / cols) * cellH + cellH / 2
      const ox = cx - ((plant.minX + plant.maxX) / 2) * scale
      const oy = cy - ((plant.minY + plant.maxY) / 2) * scale
      const startG = i * 1.2
      placed.push({ plant, scale, ox, oy, startG })
      maxReveal = Math.max(maxReveal, startG + plant.maxReveal)
    })
    return { cssW: cols * cellW, cssH: rows * cellH, placed, maxReveal }
  }

  if (mode === 3) {
    const rh = 200
    const margin = 60
    const letterSpacing = rh * 0.08
    const branchPad = MAX_TENDRIL_LENGTH * (rh / RASTER_HEIGHT)

    // Lay out in raster units first (baseline-aligned), then fit to the viewport.
    const built = []
    let cursor = 0
    let top = Infinity
    let bottom = -Infinity
    for (const ch of word) {
      if (ch === ' ') {
        cursor += (font.getAdvanceWidth(' ', rh) || rh * 0.3) + letterSpacing
        continue
      }
      const plant = makePlant(font, ch, rh)
      if (!plant) {
        cursor += rh * 0.3 + letterSpacing
        continue
      }
      built.push({ plant, x: cursor - plant.origin.x })
      top = Math.min(top, plant.minY - plant.origin.y)
      bottom = Math.max(bottom, plant.maxY - plant.origin.y)
      cursor += plant.advance + letterSpacing
    }
    if (built.length === 0) return { cssW: 600, cssH: 400, placed: [], maxReveal: 0 }

    const wordW = cursor - letterSpacing + branchPad * 2
    const wordH = bottom - top + branchPad * 2
    const availW = window.innerWidth * 0.92 - margin * 2
    const availH = window.innerHeight * 0.7 - margin * 2
    const scale = Math.min(300 / rh, availW / wordW, availH / wordH)

    const originX = margin + branchPad * scale
    const baselineY = margin + branchPad * scale - top * scale
    const placed = []
    let maxReveal = 0
    built.forEach((it, i) => {
      const startG = i * 6
      const oy = baselineY - it.plant.origin.y * scale
      placed.push({ plant: it.plant, scale, ox: originX + it.x * scale, oy, startG })
      maxReveal = Math.max(maxReveal, startG + it.plant.maxReveal)
    })
    return {
      cssW: wordW * scale + margin * 2,
      cssH: wordH * scale + margin * 2,
      placed,
      maxReveal,
    }
  }

  const plant = makePlant(font, letter || 'T', RASTER_HEIGHT)
  if (!plant) return { cssW: CANVAS_W, cssH: CANVAS_H, placed: [], maxReveal: 0 }
  const scale =
    Math.min(
      (CANVAS_W - CANVAS_PAD * 2) / (plant.maxX - plant.minX),
      (CANVAS_H - CANVAS_PAD * 2) / (plant.maxY - plant.minY),
    ) * 0.72
  const ox = CANVAS_W / 2 - ((plant.minX + plant.maxX) / 2) * scale
  const oy = CANVAS_H / 2 - ((plant.minY + plant.maxY) / 2) * scale
  return {
    cssW: CANVAS_W,
    cssH: CANVAS_H,
    placed: [{ plant, scale, ox, oy, startG: 0 }],
    maxReveal: plant.maxReveal,
  }
}

function Exploration() {
  const buildIdRef = useRef(0)
  const [font, setFont] = useState(null)
  const [layout, setLayout] = useState(null)
  const [mode, setMode] = useState(1)
  const [letter, setLetter] = useState('T')
  const [word, setWord] = useState('Temple')

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

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault()
        setMode(Number(e.key))
        return
      }
      if (mode === 1 && e.key.length === 1 && /[a-z0-9]/i.test(e.key)) setLetter(e.key)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode])

  const rebuild = useCallback(() => {
    if (!font) return
    const { cssW, cssH, placed } = buildLayout(font, mode, letter, word)
    const ds = Math.min(1, (window.innerWidth * 0.96) / cssW, (window.innerHeight * 0.9) / cssH)
    const paths = []
    for (const it of placed) {
      for (const p of plantPaths(it.plant, it.scale, it.ox, it.oy, it.startG)) paths.push(p)
    }
    buildIdRef.current += 1
    setLayout({ cssW, cssH, ds, paths, id: buildIdRef.current })
  }, [font, mode, letter, word])

  useEffect(() => {
    rebuild()
  }, [rebuild])

  return (
    <div className="exploration">
      {layout && (
        <svg
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
      <div className="exploration__hud">
        {mode === 3 && (
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="type a word"
            autoFocus
          />
        )}
      </div>
    </div>
  )
}

export default Exploration
