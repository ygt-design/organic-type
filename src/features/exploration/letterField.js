import { tracePolylines, zhangSuenThin } from './glyphGrowth.js'

const DIAG = Math.SQRT2

// Two-pass chamfer distance (px) from every pixel to the nearest skeleton pixel.
function chamfer(skel, w, h) {
  const d = new Float32Array(w * h).fill(Infinity)
  for (let i = 0; i < w * h; i++) if (skel[i]) d[i] = 0
  const relax = (i, j, cost) => {
    if (d[j] + cost < d[i]) d[i] = d[j] + cost
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (x > 0) relax(i, i - 1, 1)
      if (y > 0) {
        relax(i, i - w, 1)
        if (x > 0) relax(i, i - w - 1, DIAG)
        if (x < w - 1) relax(i, i - w + 1, DIAG)
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (x < w - 1) relax(i, i + 1, 1)
      if (y < h - 1) {
        relax(i, i + w, 1)
        if (x < w - 1) relax(i, i + w + 1, DIAG)
        if (x > 0) relax(i, i + w - 1, DIAG)
      }
    }
  }
  return d
}

// Pixels reachable from the border without crossing the (slightly thickened)
// skeleton. Everything else is inside a counter (the hole of an o, e, p...),
// where flourishes don't belong.
function outsideMask(dist, w, h) {
  const out = new Uint8Array(w * h)
  const open = (i) => dist[i] > 1.5 && !out[i]
  const queue = []
  for (let x = 0; x < w; x++) queue.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y++) queue.push(y * w, y * w + w - 1)
  const seeds = queue.filter(open)
  for (const i of seeds) out[i] = 1
  for (let q = 0; q < seeds.length; q++) {
    const i = seeds[q]
    const x = i % w
    const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]
    for (const j of next) {
      if (j < 0 || j >= w * h || !open(j)) continue
      out[j] = 1
      seeds.push(j)
    }
  }
  return out
}

// Pixels hemmed in by the skeleton on at least three of four sides within
// `depth` px: the open pockets between strokes (under an m's arches, the mouth
// of a c) that aren't sealed counters but still read as inside the letter.
function pocketMask(skel, w, h, depth) {
  const hits = new Uint8Array(w * h)
  const scan = (count, length, at) => {
    for (let line = 0; line < count; line++) {
      for (const dir of [1, -1]) {
        let last = -Infinity
        for (let k = dir > 0 ? 0 : length - 1; k >= 0 && k < length; k += dir) {
          const i = at(line, k)
          if (skel[i]) last = k
          else if (Math.abs(k - last) <= depth) hits[i]++
        }
      }
    }
  }
  scan(h, w, (y, x) => y * w + x)
  scan(w, h, (x, y) => y * w + x)
  const pocket = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) pocket[i] = hits[i] >= 3 ? 1 : 0
  return pocket
}

// Rasterize `text` centred in a width×height field (shrunk to fit inside
// `margin`), thin it to its medial skeleton, and build the lookups flourish
// growth needs: distance to the letter, outside-vs-counter, skeleton chains.
export function buildLetterField(font, text, { width, height, size, margin, pocketDepth }) {
  const probe = font.getPath(text, 0, 0, size).getBoundingBox()
  if (!Number.isFinite(probe.x1) || probe.x2 <= probe.x1 || probe.y2 <= probe.y1) return null
  const fit = Math.min(
    1,
    (width - 2 * margin) / (probe.x2 - probe.x1),
    (height - 2 * margin) / (probe.y2 - probe.y1),
  )
  const fontSize = size * fit
  const box = font.getPath(text, 0, 0, fontSize).getBoundingBox()
  const ox = (width - (box.x2 - box.x1)) / 2 - box.x1
  const oy = (height - (box.y2 - box.y1)) / 2 - box.y1

  const raster = document.createElement('canvas')
  raster.width = width
  raster.height = height
  const ctx = raster.getContext('2d')
  font.getPath(text, ox, oy, fontSize).draw(ctx)
  const alpha = ctx.getImageData(0, 0, width, height).data
  const skel = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) skel[i] = alpha[i * 4 + 3] > 127 ? 1 : 0
  zhangSuenThin(skel, width, height)

  const chains = tracePolylines(skel, width, height, new Float32Array(width * height))
  const dist = chamfer(skel, width, height)
  const outside = outsideMask(dist, width, height)
  const pocket = pocketMask(skel, width, height, fontSize * pocketDepth)
  const index = (x, y) => {
    const ix = Math.round(x)
    const iy = Math.round(y)
    return ix < 0 || iy < 0 || ix >= width || iy >= height ? -1 : iy * width + ix
  }
  const distAt = (x, y) => {
    const i = index(x, y)
    return i < 0 ? Infinity : dist[i]
  }
  const degree = (x, y) => {
    let n = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && skel[index(x + dx, y + dy)]) n++
    }
    return n
  }
  return {
    width,
    height,
    chains,
    distAt,
    degree,
    isOutside: (x, y) => {
      const i = index(x, y)
      return outside[i] === 1 && pocket[i] === 0
    },
    // True when segment a→b passes within `clear` px of the letter.
    lineHits: (a, b, clear) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2))
      for (let k = 0; k <= steps; k++) {
        if (distAt(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps) < clear) return true
      }
      return false
    },
  }
}

const unit = (a, b) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.hypot(dx, dy) || 1
  return { x: dx / l, y: dy / l }
}
const TANGENT_SPAN = 6
const SPROUT_SIZES = 5

// Sprout circles: each touches the letter's skeleton at P, aligned with the
// stroke there, so a flourish riding it leaves the letter tangentially instead of
// being stuck on. Traveling the circle in direction `s` from angle `from` starts
// at P heading along the stroke. Stroke ends come first and curl the way the
// stroke was already bending; then points every `spacing` px along each stroke.
export function letterSprouts(field, rng, { spacing, minR, maxR, gap, margin }) {
  const out = []
  const tryAt = (P, u, sides) => {
    const n = { x: -u.y, y: u.x }
    for (const s of sides) {
      const fits = []
      for (let k = 0; k < SPROUT_SIZES; k++) {
        const r = maxR - ((maxR - minR) * k) / (SPROUT_SIZES - 1)
        const x = P.x + s * r * n.x
        const y = P.y + s * r * n.y
        if (x < r + margin || y < r + margin || x > field.width - r - margin || y > field.height - r - margin) continue
        // ~r means only P touches; any less and the circle overlaps another stroke.
        if (!field.isOutside(x, y) || field.distAt(x, y) < r - 1.5) continue
        if (out.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + r + gap)) continue
        fits.push({ x, y, r, s, from: Math.atan2(P.y - y, P.x - x) })
      }
      if (fits.length) {
        out.push(fits[Math.floor(rng() * fits.length)])
        return true
      }
    }
    return false
  }

  const K = TANGENT_SPAN
  for (const c of field.chains) {
    if (c.length < 2 * K + 1) continue
    for (const end of [c, [...c].reverse()]) {
      const P = end[end.length - 1]
      if (field.degree(P.x, P.y) !== 1) continue
      const before = unit(end[end.length - 1 - 2 * K], end[end.length - 1 - K])
      const u = unit(end[end.length - 1 - K], P)
      const turn = before.x * u.y - before.y * u.x
      const s = turn === 0 ? (rng() < 0.5 ? 1 : -1) : Math.sign(turn)
      tryAt(P, u, [s, -s])
    }
    let run = spacing / 2
    for (let i = K; i < c.length - K; i++) {
      run += Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y)
      if (run < spacing) continue
      const along = unit(c[i - K], c[i + K])
      const dir = rng() < 0.5 ? 1 : -1
      const s = rng() < 0.5 ? 1 : -1
      if (tryAt(c[i], { x: along.x * dir, y: along.y * dir }, [s, -s])) run = 0
    }
  }
  return out
}
