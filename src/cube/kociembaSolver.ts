import {
  applyMove,
  createSolvedFacelets,
  FACE_ORDER,
  faceletsToCubie,
  isSolvedFacelets,
} from './cubeMath';
import type { BaseMove, CubieState, Facelets, MoveName, SolveResult } from './types';

// 18 moves order: U, U2, U', R, R2, R', F, F2, F', D, D2, D', L, L2, L', B, B2, B'
const ALL_MOVES: MoveName[] = [
  'U', 'U2', "U'",
  'R', 'R2', "R'",
  'F', 'F2', "F'",
  'D', 'D2', "D'",
  'L', 'L2', "L'",
  'B', 'B2', "B'",
];

// Indices into ALL_MOVES for the 10 Phase-2 (G1) moves: U, U2, U', D, D2, D', R2, L2, F2, B2
const G1_MOVE_INDICES = [0, 1, 2, 9, 10, 11, 4, 13, 7, 16] as const;

const N_TWIST = 2187;
const N_FLIP = 2048;
const N_SLICE = 495;
const N_CP = 40320;
const N_EP8 = 40320;
const N_SLICE4 = 24;

function multiplyCubies(a: CubieState, b: CubieState): CubieState {
  const cp = new Int8Array(8);
  const co = new Int8Array(8);
  const ep = new Int8Array(12);
  const eo = new Int8Array(12);

  for (let i = 0; i < 8; i++) {
    cp[i] = a.cp[b.cp[i]];
    co[i] = (a.co[b.cp[i]] + b.co[i]) % 3;
  }
  for (let i = 0; i < 12; i++) {
    ep[i] = a.ep[b.ep[i]];
    eo[i] = a.eo[b.ep[i]] ^ b.eo[i];
  }
  return { cp, co, ep, eo };
}

// Binomial coefficients C[n][k]
const C: number[][] = Array.from({ length: 13 }, () => new Array(5).fill(0));
for (let n = 0; n <= 12; n++) {
  C[n][0] = 1;
  for (let k = 1; k <= Math.min(n, 4); k++) {
    C[n][k] = C[n - 1][k - 1] + C[n - 1][k];
  }
}

const FACTORIAL = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];

function getTwist(co: Int8Array): number {
  let ret = 0;
  for (let i = 0; i < 7; i++) {
    ret = ret * 3 + co[i];
  }
  return ret;
}

function setTwist(twist: number, co: Int8Array): void {
  let parity = 0;
  for (let i = 6; i >= 0; i--) {
    const v = twist % 3;
    co[i] = v;
    parity += v;
    twist = (twist / 3) | 0;
  }
  co[7] = (3 - (parity % 3)) % 3;
}

function getFlip(eo: Int8Array): number {
  let ret = 0;
  for (let i = 0; i < 11; i++) {
    ret = (ret << 1) | eo[i];
  }
  return ret;
}

function setFlip(flip: number, eo: Int8Array): void {
  let parity = 0;
  for (let i = 10; i >= 0; i--) {
    const v = flip & 1;
    eo[i] = v;
    parity ^= v;
    flip >>= 1;
  }
  eo[11] = parity;
}

function getUDSlice(ep: Int8Array): number {
  let s = 0;
  let x = 0;
  for (let j = 0; j < 12; j++) {
    if (ep[j] >= 8) {
      x++;
    } else if (x > 0) {
      s += C[j][x - 1];
    }
  }
  return s;
}

function setUDSlice(slice: number, ep: Int8Array): void {
  let k = 4;
  let nextOther = 0;
  let nextSlice = 8;
  for (let j = 11; j >= 0; j--) {
    if (k === 0 || (k > 0 && slice >= C[j][k - 1])) {
      if (k > 0) slice -= C[j][k - 1];
      ep[j] = nextOther++;
    } else {
      ep[j] = nextSlice++;
      k--;
    }
  }
}

function encodePerm(perm: Int8Array, n: number, offset = 0): number {
  let code = 0;
  for (let i = 0; i < n - 1; i++) {
    let smaller = 0;
    const vi = perm[i] - offset;
    for (let j = i + 1; j < n; j++) {
      if (perm[j] - offset < vi) smaller++;
    }
    code += smaller * FACTORIAL[n - 1 - i];
  }
  return code;
}

function decodePerm(code: number, n: number, out: Int8Array, offset = 0): void {
  const pool: number[] = [];
  for (let i = 0; i < n; i++) pool.push(i + offset);
  for (let i = 0; i < n; i++) {
    const f = FACTORIAL[n - 1 - i];
    const idx = (code / f) | 0;
    code %= f;
    out[i] = pool.splice(idx, 1)[0];
  }
}

interface SolverTables {
  twistMove: Uint16Array;
  flipMove: Uint16Array;
  sliceMove: Uint16Array;
  sliceTwistPrun: Int8Array;
  sliceFlipPrun: Int8Array;
  cpMove: Uint16Array;
  ep8Move: Uint16Array;
  slice4Move: Uint8Array;
  slice4CpPrun: Int8Array;
  slice4Ep8Prun: Int8Array;
}

let cachedTables: SolverTables | null = null;

function buildMoveCubies(): CubieState[] {
  const solvedFacelets = createSolvedFacelets();
  const baseCubies: Record<BaseMove, CubieState> = {} as Record<BaseMove, CubieState>;
  for (const f of FACE_ORDER) {
    const moved = applyMove(solvedFacelets, f);
    const { cubie } = faceletsToCubie(moved);
    if (!cubie) throw new Error(`Failed to derive base move cubie for ${f}`);
    baseCubies[f] = cubie;
  }

  const moveCubies: CubieState[] = [];
  for (const f of FACE_ORDER) {
    const m1 = baseCubies[f];
    const m2 = multiplyCubies(m1, m1);
    const m3 = multiplyCubies(m2, m1);
    moveCubies.push(m1, m2, m3);
  }
  return moveCubies;
}

function initTables(): SolverTables {
  if (cachedTables) return cachedTables;

  const moveCubies = buildMoveCubies();

  // Phase 1 move tables
  const twistMove = new Uint16Array(N_TWIST * 18);
  const flipMove = new Uint16Array(N_FLIP * 18);
  const sliceMove = new Uint16Array(N_SLICE * 18);

  const tmpCo = new Int8Array(8);
  const newCo = new Int8Array(8);
  for (let i = 0; i < N_TWIST; i++) {
    setTwist(i, tmpCo);
    for (let m = 0; m < 18; m++) {
      const mc = moveCubies[m];
      for (let k = 0; k < 8; k++) {
        newCo[k] = (tmpCo[mc.cp[k]] + mc.co[k]) % 3;
      }
      twistMove[i * 18 + m] = getTwist(newCo);
    }
  }

  const tmpEo = new Int8Array(12);
  const newEo = new Int8Array(12);
  for (let i = 0; i < N_FLIP; i++) {
    setFlip(i, tmpEo);
    for (let m = 0; m < 18; m++) {
      const mc = moveCubies[m];
      for (let k = 0; k < 12; k++) {
        newEo[k] = tmpEo[mc.ep[k]] ^ mc.eo[k];
      }
      flipMove[i * 18 + m] = getFlip(newEo);
    }
  }

  const tmpEp = new Int8Array(12);
  const newEp = new Int8Array(12);
  for (let i = 0; i < N_SLICE; i++) {
    setUDSlice(i, tmpEp);
    for (let m = 0; m < 18; m++) {
      const mc = moveCubies[m];
      for (let k = 0; k < 12; k++) {
        newEp[k] = tmpEp[mc.ep[k]];
      }
      sliceMove[i * 18 + m] = getUDSlice(newEp);
    }
  }

  // Phase 1 pruning tables (BFS from 0)
  const sliceTwistPrun = new Int8Array(N_SLICE * N_TWIST).fill(-1);
  {
    const queue = new Int32Array(N_SLICE * N_TWIST);
    let head = 0;
    let tail = 0;
    sliceTwistPrun[0] = 0;
    queue[tail++] = 0;
    while (head < tail) {
      const idx = queue[head++];
      const depth = sliceTwistPrun[idx];
      const slice = (idx / N_TWIST) | 0;
      const twist = idx - slice * N_TWIST;
      const sBase = slice * 18;
      const tBase = twist * 18;
      const nextDepth = depth + 1;
      for (let m = 0; m < 18; m++) {
        const nIdx = sliceMove[sBase + m] * N_TWIST + twistMove[tBase + m];
        if (sliceTwistPrun[nIdx] === -1) {
          sliceTwistPrun[nIdx] = nextDepth;
          queue[tail++] = nIdx;
        }
      }
    }
  }

  const sliceFlipPrun = new Int8Array(N_SLICE * N_FLIP).fill(-1);
  {
    const queue = new Int32Array(N_SLICE * N_FLIP);
    let head = 0;
    let tail = 0;
    sliceFlipPrun[0] = 0;
    queue[tail++] = 0;
    while (head < tail) {
      const idx = queue[head++];
      const depth = sliceFlipPrun[idx];
      const slice = (idx / N_FLIP) | 0;
      const flip = idx - slice * N_FLIP;
      const sBase = slice * 18;
      const fBase = flip * 18;
      const nextDepth = depth + 1;
      for (let m = 0; m < 18; m++) {
        const nIdx = sliceMove[sBase + m] * N_FLIP + flipMove[fBase + m];
        if (sliceFlipPrun[nIdx] === -1) {
          sliceFlipPrun[nIdx] = nextDepth;
          queue[tail++] = nIdx;
        }
      }
    }
  }

  // Phase 2 move tables (10 G1 moves)
  const cpMove = new Uint16Array(N_CP * 10);
  const ep8Move = new Uint16Array(N_EP8 * 10);
  const slice4Move = new Uint8Array(N_SLICE4 * 10);

  const g1Cubies = G1_MOVE_INDICES.map((idx) => moveCubies[idx]);
  const tmp8 = new Int8Array(8);
  const out8 = new Int8Array(8);

  for (let i = 0; i < N_CP; i++) {
    decodePerm(i, 8, tmp8, 0);
    for (let m = 0; m < 10; m++) {
      const mcp = g1Cubies[m].cp;
      for (let k = 0; k < 8; k++) out8[k] = tmp8[mcp[k]];
      cpMove[i * 10 + m] = encodePerm(out8, 8, 0);
    }
  }

  for (let i = 0; i < N_EP8; i++) {
    decodePerm(i, 8, tmp8, 0);
    for (let m = 0; m < 10; m++) {
      const mep = g1Cubies[m].ep;
      for (let k = 0; k < 8; k++) out8[k] = tmp8[mep[k]];
      ep8Move[i * 10 + m] = encodePerm(out8, 8, 0);
    }
  }

  const tmp4 = new Int8Array(4);
  const out4 = new Int8Array(4);
  for (let i = 0; i < N_SLICE4; i++) {
    decodePerm(i, 4, tmp4, 0);
    for (let m = 0; m < 10; m++) {
      const mep = g1Cubies[m].ep;
      for (let k = 0; k < 4; k++) out4[k] = tmp4[mep[k + 8] - 8];
      slice4Move[i * 10 + m] = encodePerm(out4, 4, 0);
    }
  }

  // Phase 2 pruning tables
  const slice4CpPrun = new Int8Array(N_SLICE4 * N_CP).fill(-1);
  {
    const queue = new Int32Array(N_SLICE4 * N_CP);
    let head = 0;
    let tail = 0;
    slice4CpPrun[0] = 0;
    queue[tail++] = 0;
    while (head < tail) {
      const idx = queue[head++];
      const depth = slice4CpPrun[idx];
      const s4 = (idx / N_CP) | 0;
      const cp = idx - s4 * N_CP;
      const sBase = s4 * 10;
      const cBase = cp * 10;
      const nextDepth = depth + 1;
      for (let m = 0; m < 10; m++) {
        const nIdx = slice4Move[sBase + m] * N_CP + cpMove[cBase + m];
        if (slice4CpPrun[nIdx] === -1) {
          slice4CpPrun[nIdx] = nextDepth;
          queue[tail++] = nIdx;
        }
      }
    }
  }

  const slice4Ep8Prun = new Int8Array(N_SLICE4 * N_EP8).fill(-1);
  {
    const queue = new Int32Array(N_SLICE4 * N_EP8);
    let head = 0;
    let tail = 0;
    slice4Ep8Prun[0] = 0;
    queue[tail++] = 0;
    while (head < tail) {
      const idx = queue[head++];
      const depth = slice4Ep8Prun[idx];
      const s4 = (idx / N_EP8) | 0;
      const ep8 = idx - s4 * N_EP8;
      const sBase = s4 * 10;
      const eBase = ep8 * 10;
      const nextDepth = depth + 1;
      for (let m = 0; m < 10; m++) {
        const nIdx = slice4Move[sBase + m] * N_EP8 + ep8Move[eBase + m];
        if (slice4Ep8Prun[nIdx] === -1) {
          slice4Ep8Prun[nIdx] = nextDepth;
          queue[tail++] = nIdx;
        }
      }
    }
  }

  cachedTables = {
    twistMove,
    flipMove,
    sliceMove,
    sliceTwistPrun,
    sliceFlipPrun,
    cpMove,
    ep8Move,
    slice4Move,
    slice4CpPrun,
    slice4Ep8Prun,
  };
  return cachedTables;
}

export function warmUpSolver(): void {
  initTables();
}

export function solveFacelets(facelets: Facelets): SolveResult {
  const t0 = performance.now();
  if (isSolvedFacelets(facelets)) {
    return { moves: [], durationMs: 0, alreadySolved: true };
  }

  const { cubie, error } = faceletsToCubie(facelets);
  if (!cubie || error) {
    throw new Error(error || 'Kub vəziyyəti etibarsızdır.');
  }

  const tables = initTables();
  const moveCubies = buildMoveCubies();

  const startTwist = getTwist(cubie.co);
  const startFlip = getFlip(cubie.eo);
  const startSlice = getUDSlice(cubie.ep);

  // Track best total solution across Phase 1 -> Phase 2
  const p1Moves = new Int32Array(32);
  const p2Moves = new Int32Array(32);
  let bestSolution: MoveName[] | null = null;
  let maxAllowedTotal = 25;
  const searchDeadline = performance.now() + 250; // generous 250ms budget for shortening

  function searchPhase2(
    cp: number,
    ep8: number,
    s4: number,
    depth: number,
    maxDepth2: number,
    lastFace: number
  ): boolean {
    const h = Math.max(
      tables.slice4CpPrun[s4 * N_CP + cp],
      tables.slice4Ep8Prun[s4 * N_EP8 + ep8]
    );
    if (h > maxDepth2) return false;
    if (h === 0) {
      // Found solution!
      if (cp === 0 && ep8 === 0 && s4 === 0) {
        return true;
      }
    }
    if (maxDepth2 === 0) return false;

    for (let m = 0; m < 10; m++) {
      const fullMoveIdx = G1_MOVE_INDICES[m];
      const face = (fullMoveIdx / 3) | 0;
      if (face === lastFace) continue;
      // Avoid commuting redundant order like D before U or L2 before R2 or B2 before F2
      if (lastFace !== -1 && (face - lastFace === 3 || (lastFace - face === 3 && face < lastFace))) {
        // Only allow U before D (0 before 3), R before L (1 before 4), F before B (2 before 5)
        if (lastFace - face === 3) continue;
      }

      const nCp = tables.cpMove[cp * 10 + m];
      const nEp8 = tables.ep8Move[ep8 * 10 + m];
      const nS4 = tables.slice4Move[s4 * 10 + m];
      p2Moves[depth] = fullMoveIdx;
      if (searchPhase2(nCp, nEp8, nS4, depth + 1, maxDepth2 - 1, face)) {
        return true;
      }
    }
    return false;
  }

  function runPhase2(p1Len: number): boolean {
    // Apply p1Moves to initial cubie state
    let state: CubieState = {
      cp: new Int8Array(cubie!.cp),
      co: new Int8Array(cubie!.co),
      ep: new Int8Array(cubie!.ep),
      eo: new Int8Array(cubie!.eo),
    };
    for (let i = 0; i < p1Len; i++) {
      state = multiplyCubies(state, moveCubies[p1Moves[i]]);
    }

    const cp = encodePerm(state.cp, 8, 0);
    const ep8 = encodePerm(state.ep.subarray(0, 8), 8, 0);
    const s4 = encodePerm(state.ep.subarray(8, 12), 4, 8);

    const minD2 = Math.max(
      tables.slice4CpPrun[s4 * N_CP + cp],
      tables.slice4Ep8Prun[s4 * N_EP8 + ep8]
    );
    const limitD2 = Math.min(18, maxAllowedTotal - p1Len - 1);
    if (minD2 > limitD2) return false;

    const lastP1Face = p1Len > 0 ? ((p1Moves[p1Len - 1] / 3) | 0) : -1;

    for (let d2 = minD2; d2 <= limitD2; d2++) {
      if (searchPhase2(cp, ep8, s4, 0, d2, lastP1Face)) {
        const total = p1Len + d2;
        const combined: MoveName[] = [];
        for (let i = 0; i < p1Len; i++) combined.push(ALL_MOVES[p1Moves[i]]);
        for (let i = 0; i < d2; i++) combined.push(ALL_MOVES[p2Moves[i]]);
        bestSolution = combined;
        maxAllowedTotal = total;
        return true;
      }
    }
    return false;
  }

  function searchPhase1(
    twist: number,
    flip: number,
    slice: number,
    depth: number,
    maxDepth1: number,
    lastFace: number
  ): boolean {
    if (bestSolution && performance.now() > searchDeadline) {
      return true;
    }

    const h = Math.max(
      tables.sliceTwistPrun[slice * N_TWIST + twist],
      tables.sliceFlipPrun[slice * N_FLIP + flip]
    );
    if (h > maxDepth1) return false;

    if (maxDepth1 === 0) {
      if (twist === 0 && flip === 0 && slice === 0) {
        runPhase2(depth);
        // Stop early if we found a great solution <= 20 moves
        if (bestSolution && bestSolution.length <= 20) return true;
      }
      return false;
    }

    for (let m = 0; m < 18; m++) {
      const face = (m / 3) | 0;
      if (face === lastFace) continue;
      if (lastFace !== -1 && lastFace - face === 3) continue;

      const nTwist = tables.twistMove[twist * 18 + m];
      const nFlip = tables.flipMove[flip * 18 + m];
      const nSlice = tables.sliceMove[slice * 18 + m];
      p1Moves[depth] = m;
      if (searchPhase1(nTwist, nFlip, nSlice, depth + 1, maxDepth1 - 1, face)) {
        return true;
      }
    }
    return false;
  }

  const minD1 = Math.max(
    tables.sliceTwistPrun[startSlice * N_TWIST + startTwist],
    tables.sliceFlipPrun[startSlice * N_FLIP + startFlip]
  );

  for (let d1 = minD1; d1 <= 12; d1++) {
    if (searchPhase1(startTwist, startFlip, startSlice, 0, d1, -1)) {
      break;
    }
    if (bestSolution && (bestSolution as MoveName[]).length <= 21) {
      break;
    }
    if (bestSolution && performance.now() > searchDeadline) {
      break;
    }
  }

  if (!bestSolution) {
    // Fallback: relax total limit up to 30
    maxAllowedTotal = 30;
    for (let d1 = minD1; d1 <= 14; d1++) {
      if (searchPhase1(startTwist, startFlip, startSlice, 0, d1, -1)) break;
      if (bestSolution) break;
    }
  }

  if (!bestSolution) {
    throw new Error('Həll tapılmadı. Zəhmət olmasa kubun rənglərini yoxlayın.');
  }

  return {
    moves: bestSolution,
    durationMs: Math.round(performance.now() - t0),
    alreadySolved: false,
  };
}
