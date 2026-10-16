import config from "./scroll.json";

const { canvas } = config;
const TAU = Math.PI * 2;
const mod = (x, m) => ((x % m) + m) % m;
const angleOf = (c, p) => Math.atan2(p.y - c.y, p.x - c.x);
// Caps the turn between samples so small circles and the spiral's tight centre
// don't read as polygons (a pure px step is far too coarse at radius ~5).
const DEG = Math.PI / 180;
const MAX_STEP_ANGLE = 3 * DEG;

// Seeded so a given seed + slider set always packs the same circles (a picked
// chain stays meaningful until the packing itself changes).
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random-placement packing, largest first so small circles settle into the gaps
// between big ones. Radii are biased small (u^3) to get a few big, many little.
export function packCircles(
  rng,
  {
    count,
    minRadius,
    maxRadius,
    gap,
    width = canvas.width,
    height = canvas.height,
    margin = canvas.margin,
    seamMargin,
    initial = [],
    accept,
    tries = canvas.tries,
  },
) {
  // Right/bottom edges of a mirrored tile are seams: half a gap there puts a
  // circle exactly one gap from its own reflection, so the seam doesn't read.
  const far = seamMargin ?? margin;
  const lo = Math.min(minRadius, maxRadius);
  const hi = Math.max(minRadius, maxRadius);
  const radii = Array.from(
    { length: count },
    () => lo + (hi - lo) * rng() ** 3,
  ).sort((a, b) => b - a);
  // `initial` circles are placed as-is first (ids 0..n-1); `accept(x, y, r)`
  // rejects positions, e.g. too close to a letter.
  const circles = initial.map((c, id) => ({ ...c, id }));
  for (const r of radii) {
    const spanX = width - 2 * r - margin - far;
    const spanY = height - 2 * r - margin - far;
    if (spanX < 0 || spanY < 0) continue;
    for (let t = 0; t < tries; t++) {
      const x = r + margin + rng() * spanX;
      const y = r + margin + rng() * spanY;
      let free = !accept || accept(x, y, r);
      for (const c of free ? circles : []) {
        const min = c.r + r + gap;
        if ((c.x - x) ** 2 + (c.y - y) ** 2 < min * min) {
          free = false;
          break;
        }
      }
      if (free) {
        circles.push({ id: circles.length, x, y, r });
        break;
      }
    }
  }
  return circles;
}

const gapBetween = (a, b) => Math.hypot(b.x - a.x, b.y - a.y) - a.r - b.r;

// A starter chain so the page never opens empty: a big circle, its nearest
// neighbor, then a smaller neighbor of that for the spiral terminal.
export function defaultChain(circles, rng) {
  if (circles.length < 2) return [];
  const nearest = (from, exclude, accept) => {
    let best = null;
    let bestGap = Infinity;
    for (const c of circles) {
      if (exclude.includes(c) || !accept(c)) continue;
      const g = gapBetween(from, c);
      if (g < bestGap) {
        bestGap = g;
        best = c;
      }
    }
    return best;
  };
  const big = circles.slice(0, Math.max(1, Math.ceil(circles.length / 4)));
  const a = big[Math.floor(rng() * big.length)];
  const b = nearest(a, [a], () => true);
  const picked = [a, b];
  if (circles.length > 2) {
    picked.push(
      nearest(b, picked, (c) => c.r < b.r) ?? nearest(b, picked, () => true),
    );
  }
  return picked.map((c, i) => ({ id: c.id, s: i % 2 ? -1 : 1 }));
}

// The tangent line leaving A and arriving at B while traveling each circle in its
// direction s (+1 = increasing angle). A traveler's centre sits at distance s·r
// along the line's left normal n, so n·(cB − cA) = sB·rB − sA·rA picks n. Opposite
// directions give the crossing (internal) tangent → S-curve; equal → C-curve.
function tangentLine(A, B) {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const D = Math.hypot(dx, dy);
  const delta = B.s * B.r - A.s * A.r;
  if (Math.abs(delta) >= D) return null;
  const a = Math.atan2(dy, dx) + Math.acos(delta / D);
  const nx = Math.cos(a);
  const ny = Math.sin(a);
  return {
    a: { x: A.x - A.s * A.r * nx, y: A.y - A.s * A.r * ny },
    b: { x: B.x - B.s * B.r * nx, y: B.y - B.s * B.r * ny },
  };
}

function segmentHitsCircle(p, q, c) {
  const vx = q.x - p.x;
  const vy = q.y - p.y;
  const t = Math.max(
    0,
    Math.min(1, ((c.x - p.x) * vx + (c.y - p.y) * vy) / (vx * vx + vy * vy)),
  );
  return Math.hypot(p.x + vx * t - c.x, p.y + vy * t - c.y) < c.r;
}

function pushArc(pts, c, from, sweep, s) {
  const steps = Math.max(
    1,
    Math.ceil((sweep * c.r) / config.sampleStep),
    Math.ceil(sweep / MAX_STEP_ANGLE),
  );
  for (let k = 0; k <= steps; k++) {
    const th = from + (s * sweep * k) / steps;
    pts.push({ x: c.x + c.r * Math.cos(th), y: c.y + c.r * Math.sin(th) });
  }
}

// Winds inward around the terminal circle's centre. The radius eases in (u^p, p>1)
// so dρ/dφ = 0 at entry: the spiral leaves the circle with no kink.
function pushSpiral(pts, c, from, s, turns, tightness) {
  const total = turns * TAU;
  const rhoAt = (phi) =>
    c.r * (1 - (1 - tightness) * (phi / total) ** config.spiralEase);
  for (let phi = 0; ; ) {
    const rho = rhoAt(phi);
    const th = from + s * phi;
    pts.push({ x: c.x + rho * Math.cos(th), y: c.y + rho * Math.sin(th) });
    if (phi >= total) break;
    phi = Math.min(total, phi + Math.min(MAX_STEP_ANGLE, config.sampleStep / rho));
  }
}

// Geometry for one stroke through `steps` ([{id, s}]): lead-in arc of `leadSweep`
// (radians) ending where it leaves the first circle, arc → tangent → arc through
// the middle, spiral inside the last. `arcs` records each circle's traversed
// interval (and its distance along the stroke) so branches can sprout from it.
//
// `flow` (0–1) turns each straight tangent, plus a slice of the arcs either side,
// into one cubic whose ends keep the arcs' tangents, so arc–line–arc zig-zags
// become continuous sweeps. `arcs` only lists what stays true arc, so forks
// still land exactly on the drawn stroke.
export function strokeGeometry(circles, steps, { leadSweep, startAngle, spiralTurns, spiralTightness, flow = 0 }) {
  if (steps.length < 2) return null;
  const A = config.auto;
  const cs = steps.map((k) => ({ ...circles[k.id], s: k.s }));
  const n = cs.length;
  const lines = [];
  for (let i = 0; i < n - 1; i++) {
    const line = tangentLine(cs[i], cs[i + 1]);
    if (!line) return null;
    lines.push(line);
  }

  // A fixed `startAngle` (a sprout leaving a letter) runs the first arc from that
  // point to the exit; otherwise the lead-in is `leadSweep` back from the exit.
  const enter = [];
  const leave = [];
  leave[0] = angleOf(cs[0], lines[0].a);
  enter[0] = startAngle ?? leave[0] - cs[0].s * leadSweep;
  for (let i = 1; i < n; i++) {
    enter[i] = angleOf(cs[i], lines[i - 1].b);
    if (i < n - 1) leave[i] = angleOf(cs[i], lines[i].a);
  }
  const sweepOf = (i) => mod(cs[i].s * (leave[i] - enter[i]), TAU);

  const bIn = new Array(n).fill(0);
  const bOut = new Array(n).fill(0);
  for (let j = 0; j < n - 1; j++) {
    const len = Math.hypot(lines[j].b.x - lines[j].a.x, lines[j].b.y - lines[j].a.y);
    const want = flow * (len + A.blendRadius * Math.min(cs[j].r, cs[j + 1].r));
    bOut[j] = want / cs[j].r;
    bIn[j + 1] = want / cs[j + 1].r;
  }
  for (let i = 0; i < n - 1; i++) {
    // A fork (no lead-in) may reach back along its parent's arc, but only inside
    // the fork margin, where the parent is guaranteed to be drawn.
    const room = sweepOf(i) > 0 ? A.blendShare * sweepOf(i) : A.branchMarginDeg * DEG * 0.9;
    const total = bIn[i] + bOut[i];
    if (total > room) {
      bIn[i] *= room / total;
      bOut[i] *= room / total;
    }
  }
  bIn[n - 1] = Math.min(bIn[n - 1], A.spiralBlendMax);

  const pts = [];
  const arcs = [];
  const on = (c, a) => ({ x: c.x + c.r * Math.cos(a), y: c.y + c.r * Math.sin(a) });
  const heading = (c, a) => ({ x: -c.s * Math.sin(a), y: c.s * Math.cos(a) });
  for (let i = 0; i < n - 1; i++) {
    const c = cs[i];
    const from = enter[i] + c.s * bIn[i];
    const sweep = sweepOf(i) - bIn[i] - bOut[i];
    if (sweep > 0) {
      arcs.push({ id: c.id, s: c.s, x: c.x, y: c.y, from, sweep, startIdx: pts.length });
      pushArc(pts, c, from, sweep, c.s);
    } else {
      pts.push(on(c, leave[i] - c.s * bOut[i]));
    }

    const a1 = leave[i] - c.s * bOut[i];
    const a2 = enter[i + 1] + cs[i + 1].s * bIn[i + 1];
    const P1 = on(c, a1);
    const P2 = on(cs[i + 1], a2);
    const T1 = heading(c, a1);
    const T2 = heading(cs[i + 1], a2);
    const span = Math.hypot(P2.x - P1.x, P2.y - P1.y);
    const h = span * A.blendHandle;
    const c1 = { x: P1.x + T1.x * h, y: P1.y + T1.y * h };
    const c2 = { x: P2.x - T2.x * h, y: P2.y - T2.y * h };
    const count = Math.max(2, Math.ceil(span / config.sampleStep));
    for (let k = 1; k < count; k++) {
      const t = k / count;
      const m = 1 - t;
      pts.push({
        x: m * m * m * P1.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * P2.x,
        y: m * m * m * P1.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * P2.y,
      });
    }
  }
  const last = cs[n - 1];
  pushSpiral(pts, last, enter[n - 1] + last.s * bIn[n - 1], last.s, spiralTurns, spiralTightness);

  return finishGeometry(pts, arcs, lines, last, spiralTurns);
}

function finishGeometry(pts, arcs, lines, last, spiralTurns) {
  const cum = [0];
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  for (const a of arcs) a.startLen = cum[a.startIdx];
  const sweeps = [
    ...arcs.map((a) => ({ id: a.id, s: a.s, x: a.x, y: a.y, deg: a.sweep / DEG })),
    { id: last.id, s: last.s, x: last.x, y: last.y, deg: spiralTurns * 360 },
  ];
  return { d, pts, len: cum[cum.length - 1], start: pts[0], lines, arcs, sweeps };
}

// One hand-picked stroke (manual mode), with lines that cut through other circles flagged.
export function buildStroke(circles, chain, { startSweep, spiralTurns, spiralTightness, flow }) {
  const geom = strokeGeometry(circles, chain, {
    leadSweep: startSweep * DEG,
    flow,
    spiralTurns,
    spiralTightness,
  });
  if (!geom) return null;
  const lines = geom.lines.map((line, i) => ({
    ...line,
    blocked: circles.some(
      (c) =>
        c.id !== chain[i].id &&
        c.id !== chain[i + 1].id &&
        segmentHitsCircle(line.a, line.b, c),
    ),
  }));
  return { ...geom, lines };
}

function segmentsCross(p1, p2, q1, q2) {
  const side = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return side(p1, p2, q1) !== side(p1, p2, q2) && side(q1, q2, p1) !== side(q1, q2, p2);
}

// Automatic field: a few long stems walk the circle graph from the biggest
// circles, then strokes sprout off earlier strokes' arcs, depth by depth. Each
// circle hosts one stroke (a branch shares only its parent's circle) and tangent
// lines may not cut circles or cross other lines, so nothing overlaps.
export function growScrolls(circles, rng, o) {
  const A = config.auto;
  if (!circles.length) return { strokes: [], used: new Set(), tried: 0 };
  const radii = circles.map((c) => c.r);
  const lo = Math.min(...radii);
  const hi = Math.max(...radii);
  const terminalR = lo + (hi - lo) * A.terminalRadius;
  const minSweep = A.minSweepDeg * DEG;
  const maxSweep = A.maxSweepDeg * DEG;
  const idealSweep = A.idealSweepDeg * DEG;
  const margin = A.branchMarginDeg * DEG;
  const within = (reach) =>
    circles.map((a) => circles.filter((b) => b !== a && gapBetween(a, b) <= reach));
  const neighbors = within(o.reach);
  // The fill phase looks further so leftover circles can still be reached.
  const wideNeighbors = within(o.reach * A.fillReachScale);
  const used = new Set();
  const segs = [];
  const strokes = [];
  let tried = 0;

  // Long straight runs read as mechanical, so a tangent may be at most
  // `maxLineRatio` × the two radii; big circles earn proportionally longer lines.
  // A line must also keep a stroke-width off other circles: grazing one touches
  // whatever stroke runs along its edge.
  const pad = o.thickness ?? 0;
  const lineOk = (line, a, b) =>
    Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) <= A.maxLineRatio * Math.sqrt(a.r * b.r) &&
    !circles.some(
      (c) => c.id !== a.id && c.id !== b.id && segmentHitsCircle(line.a, line.b, { ...c, r: c.r + pad }),
    ) &&
    !segs.some((sg) => segmentsCross(line.a, line.b, sg.a, sg.b)) &&
    !o.lineBlocked?.(line);

  // Scored candidate moves from circle C (travelling C.s) to unused circles in
  // `pool`. `accept(line)` filters by where the move leaves C and returns its own
  // awkwardness (sweep far from ideal). Long straights and jumps up to a bigger
  // circle add to it; past `o.tolerance` the move is refused, so the stroke ends in
  // its spiral and the space is left for a separate shape. Returns best-first.
  const moves = (C, pool, accept) => {
    const out = [];
    for (const N of pool[C.id]) {
      if (used.has(N.id)) continue;
      for (const sN of [1, -1]) {
        tried++;
        const B = { ...N, s: sN };
        const line = tangentLine(C, B);
        if (!line) continue;
        const fit = accept(line);
        if (fit == null) continue;
        const straight = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) / (A.maxLineRatio * Math.sqrt(C.r * N.r));
        const awkward = fit + A.lineWeight * straight + A.growWeight * Math.max(0, Math.log(N.r / C.r));
        if (awkward > o.tolerance || !lineOk(line, C, B)) continue;
        const score =
          rng() +
          (sN !== C.s ? o.reverse : 1 - o.reverse) +
          (N.r < C.r ? A.shrinkBias : 0) -
          awkward;
        out.push({ B, line, score });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  };

  const take = (steps, m) => {
    segs.push(m.line);
    used.add(m.B.id);
    steps.push({ id: m.B.id, s: m.B.s });
    return angleOf(m.B, m.line.b);
  };

  // Keep extending until the stroke is long enough, lands on a small circle,
  // or runs out of moves; whichever circle it ends on gets the spiral.
  const walk = (steps, thetaIn, maxSteps, pool) => {
    while (steps.length < maxSteps) {
      const cur = steps[steps.length - 1];
      const C = { ...circles[cur.id], s: cur.s };
      if (steps.length >= 2 && C.r <= terminalR) break;
      const [best] = moves(C, pool, (line) => {
        if (thetaIn == null) return 0;
        const sweep = mod(C.s * (angleOf(C, line.a) - thetaIn), TAU);
        if (sweep < minSweep || sweep > maxSweep) return null;
        return Math.abs(sweep - idealSweep) / Math.PI;
      });
      if (!best) break;
      thetaIn = take(steps, best);
    }
    return steps;
  };

  const addStroke = (steps, depth, leadSweep, revealAt, startAngle) => {
    const shape = {
      leadSweep,
      startAngle,
      spiralTurns: o.spiralTurns * (1 - A.spiralJitter / 2 + rng() * A.spiralJitter),
      spiralTightness: o.spiralTightness,
    };
    const geom = strokeGeometry(circles, steps, { ...shape, flow: o.flow });
    if (geom) strokes.push({ ...geom, depth, revealAt, steps, shape });
  };

  const growStem = (start, maxSteps, pool) => {
    used.add(start.id);
    const steps = walk([{ id: start.id, s: rng() < 0.5 ? 1 : -1 }], null, maxSteps, pool);
    if (steps.length < 2) {
      used.delete(start.id);
      return false;
    }
    addStroke(steps, 0, o.startSweep * DEG, 0);
    return true;
  };

  // Fork children off one parent arc. Each arc gets a chance per `branchEveryDeg`
  // of sweep, so long curves sprout repeatedly along their length. Leaving P on
  // its own arc keeps the fork tangent to the parent; travelling the opposite way
  // (mirror) makes the pointed, lyre-like junctions.
  const forkArc = (parent, arc, pool, chance, maxSteps) => {
    if (arc.sweep < 2 * margin) return 0;
    const P = circles[arc.id];
    const along = (line) => mod(arc.s * (angleOf(P, line.a) - arc.from), TAU);
    let added = 0;
    const chances = Math.max(1, Math.round(arc.sweep / (A.branchEveryDeg * DEG)));
    for (let k = 0; k < chances; k++) {
      if (rng() > chance) continue;
      const dirs = rng() < o.mirror ? [arc.s, -arc.s] : [arc.s];
      for (const s of dirs) {
        const [best] = moves({ ...P, s }, pool, (line) => {
          const t = along(line);
          return t < margin || t > arc.sweep - margin ? null : 0;
        });
        if (!best) continue;
        const steps = [{ id: P.id, s }];
        const thetaIn = take(steps, best);
        walk(steps, thetaIn, maxSteps, pool);
        addStroke(steps, parent.depth + 1, 0, parent.revealAt + arc.startLen + along(best.line) * P.r);
        added++;
      }
    }
    return added;
  };

  const childSteps = (depth) => Math.max(2, Math.round(o.maxSteps * A.childStepFalloff ** (depth + 1)));

  if (o.seeds) {
    // Seeds are fixed starts (sprout circles on a letter): the first arc begins at
    // the seed's tangent point, so the usual sweep limits apply from there.
    for (const seed of o.seeds) {
      used.add(seed.id);
      const steps = walk([{ id: seed.id, s: seed.s }], seed.from, o.maxSteps, neighbors);
      if (steps.length < 2) used.delete(seed.id);
      else addStroke(steps, 0, 0, 0, seed.from);
    }
  } else {
    for (let attempts = 0; strokes.length < o.stems && attempts < o.stems * 4; attempts++) {
      const free = circles.filter((c) => !used.has(c.id)).slice(0, A.stemPool);
      if (!free.length) break;
      growStem(free[Math.floor(rng() * free.length)], o.maxSteps, neighbors);
    }
  }

  // `strokes` grows while we iterate, so children get their own turn to branch.
  const branchFrom = (start) => {
    for (let i = start; i < strokes.length; i++) {
      const parent = strokes[i];
      if (parent.depth >= o.depth) continue;
      for (const arc of parent.arcs) forkArc(parent, arc, neighbors, o.branching, childSteps(parent.depth));
    }
  };

  // Fill: keep sprouting off every arc (no depth limit, wider reach) until no
  // leftover circle can be reached. Everything stays attached to a stroke; a
  // circle nothing can reach is left empty rather than given a lone curl.
  const fill = () => {
    for (let progress = true; progress && used.size < circles.length; ) {
      progress = false;
      for (let i = 0; i < strokes.length; i++) {
        for (const arc of strokes[i].arcs) {
          if (forkArc(strokes[i], arc, wideNeighbors, 1, A.fillSteps)) progress = true;
        }
      }
    }
  };

  branchFrom(0);
  fill();

  // New shapes: where strokes stopped making sense, empty regions get their own
  // stem instead of a forced connection. These are kept short (`shapeSteps`) so
  // gaps fill with small separate motifs, not more long runs. A shape is kept only if it claims
  // `minCluster` circles over at least `minShapeStrokes` strokes (a stem plus a
  // branch), so this never leaves a lone spiral behind.
  while (o.newShapes && used.size < circles.length) {
    let kept = false;
    for (const c of circles.filter((c) => !used.has(c.id)).slice(0, A.stemPool)) {
      const before = { strokes: strokes.length, segs: segs.length, used: [...used] };
      if (!growStem(c, A.shapeSteps, neighbors)) continue;
      branchFrom(before.strokes);
      fill();
      if (
        used.size - before.used.length >= A.minCluster &&
        strokes.length - before.strokes >= A.minShapeStrokes
      ) {
        kept = true;
        break;
      }
      strokes.length = before.strokes;
      segs.length = before.segs;
      used.clear();
      for (const id of before.used) used.add(id);
    }
    if (!kept) break;
  }

  return { strokes: settleFlow(circles, strokes, o), used, tried };
}

// Collision checks run on the straight tangents, but a flowed curve bows away
// from them and can cut across a neighbour. So every stroke starts at flow 0 (the
// checked geometry), then each in turn is upgraded to full or half flow only if,
// as actually drawn, it keeps clear of every other stroke's current geometry and
// of `o.pointBlocked` (mirror seams, the letter). Every final pair is therefore
// checked against each other. Less flow only lengthens the true arcs, so forks
// chosen during growth stay on their parent either way.
function settleFlow(circles, strokes, o) {
  const A = config.auto;
  if (!o.flow) return strokes;
  const clear = o.thickness + A.strokeClearance;
  // A stroke's first stretch is meant to touch whatever it leaves (parent, letter).
  const near = Math.max(A.forkIgnore, 4 * o.thickness);
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / clear)},${Math.floor(y / clear)}`;
  const place = (id, pts) => {
    const start = pts[0];
    for (const p of pts) {
      if (Math.hypot(p.x - start.x, p.y - start.y) < near) continue;
      const k = key(p.x, p.y);
      const bucket = grid.get(k);
      if (bucket) bucket.push({ x: p.x, y: p.y, id });
      else grid.set(k, [{ x: p.x, y: p.y, id }]);
    }
  };
  const remove = (id, pts) => {
    for (const p of pts) {
      const k = key(p.x, p.y);
      const bucket = grid.get(k);
      if (bucket) grid.set(k, bucket.filter((q) => q.id !== id));
    }
  };
  const hits = (id, x, y) => {
    const gx = Math.floor(x / clear);
    const gy = Math.floor(y / clear);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(`${gx + dx},${gy + dy}`);
        if (bucket?.some((q) => q.id !== id && (q.x - x) ** 2 + (q.y - y) ** 2 < clear * clear)) return true;
      }
    }
    return false;
  };
  const collides = (id, pts) => {
    const start = pts[0];
    return pts.some(
      (p) =>
        Math.hypot(p.x - start.x, p.y - start.y) > near &&
        (hits(id, p.x, p.y) || o.pointBlocked?.(p.x, p.y, clear)),
    );
  };

  const settled = strokes.map((stroke) => ({
    ...stroke,
    ...strokeGeometry(circles, stroke.steps, { ...stroke.shape, flow: 0 }),
  }));
  settled.forEach((s, id) => place(id, s.pts));
  strokes.forEach((stroke, id) => {
    for (const f of [o.flow, o.flow / 2]) {
      const geom = f === o.flow ? stroke : strokeGeometry(circles, stroke.steps, { ...stroke.shape, flow: f });
      if (!geom || collides(id, geom.pts)) continue;
      remove(id, settled[id].pts);
      settled[id] = { ...stroke, ...geom };
      place(id, geom.pts);
      break;
    }
  });
  return settled;
}
