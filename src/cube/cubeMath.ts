import type {
  BaseMove,
  ColorId,
  ColorMeta,
  CubieState,
  DraftFacelets,
  Facelets,
  FaceName,
  MoveName,
  ValidationResult,
} from './types';

export const FACE_ORDER: FaceName[] = ['U', 'R', 'F', 'D', 'L', 'B'];

export interface WizardFaceStep {
  face: FaceName;
  offset: number;
  centerColor: ColorId;
  titleAz: string;
  centerLabelAz: string;
}

/** Sequential 6-face input order requested: Ön (Yaşıl), Sağ (Qırmızı), Arxa (Göy), Sol (Narıncı), Yuxarı (Ağ), Aşağı (Sarı) */
export const WIZARD_STEPS: WizardFaceStep[] = [
  { face: 'F', offset: 18, centerColor: 'G', titleAz: 'Ön Üz', centerLabelAz: 'Yaşıl Mərkəz' },
  { face: 'R', offset: 9, centerColor: 'R', titleAz: 'Sağ Üz', centerLabelAz: 'Qırmızı Mərkəz' },
  { face: 'B', offset: 45, centerColor: 'B', titleAz: 'Arxa Üz', centerLabelAz: 'Göy Mərkəz' },
  { face: 'L', offset: 36, centerColor: 'O', titleAz: 'Sol Üz', centerLabelAz: 'Narıncı Mərkəz' },
  { face: 'U', offset: 0, centerColor: 'W', titleAz: 'Yuxarı Üz', centerLabelAz: 'Ağ Mərkəz' },
  { face: 'D', offset: 27, centerColor: 'Y', titleAz: 'Aşağı Üz', centerLabelAz: 'Sarı Mərkəz' },
];

/** Circular palette order: Ağ, Qırmızı, Yaşıl, Sarı, Narıncı, Göy */
export const WIZARD_PALETTE_ORDER: ColorId[] = ['W', 'R', 'G', 'Y', 'O', 'B'];

export const COLOR_META: Record<ColorId, ColorMeta> = {
  W: {
    id: 'W',
    face: 'U',
    nameAz: 'Ağ (Yuxarı)',
    hex: '#F8FAFC',
    threeHex: 0xf4f7fb,
    textDark: true,
  },
  Y: {
    id: 'Y',
    face: 'D',
    nameAz: 'Sarı (Aşağı)',
    hex: '#FACC15',
    threeHex: 0xf5c818,
    textDark: true,
  },
  G: {
    id: 'G',
    face: 'F',
    nameAz: 'Yaşıl (Ön)',
    hex: '#16A34A',
    threeHex: 0x16a34a,
    textDark: false,
  },
  B: {
    id: 'B',
    face: 'B',
    nameAz: 'Göy (Arxa)',
    hex: '#2563EB',
    threeHex: 0x225ce3,
    textDark: false,
  },
  O: {
    id: 'O',
    face: 'L',
    nameAz: 'Narıncı (Sol)',
    hex: '#F97316',
    threeHex: 0xf46b16,
    textDark: false,
  },
  R: {
    id: 'R',
    face: 'R',
    nameAz: 'Qırmızı (Sağ)',
    hex: '#DC2626',
    threeHex: 0xd92626,
    textDark: false,
  },
};

export const FACE_DEFAULT_COLOR: Record<FaceName, ColorId> = {
  U: 'W',
  R: 'R',
  F: 'G',
  D: 'Y',
  L: 'O',
  B: 'B',
};

export const COLOR_TO_FACE: Record<ColorId, FaceName> = {
  W: 'U',
  R: 'R',
  G: 'F',
  Y: 'D',
  O: 'L',
  B: 'B',
};

export const PALETTE_ORDER: ColorId[] = ['W', 'Y', 'G', 'B', 'O', 'R'];

export interface StickerGeom {
  index: number;
  face: FaceName;
  row: number;
  col: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Exact 3D coordinates and outward normal for each of the 54 stickers.
 * Looking directly at each face from outside:
 * U: Top (+Y), B at top, F at bottom, L at left, R at right
 * R: Right (+X), U at top, D at bottom, F at left, B at right
 * F: Front (+Z), U at top, D at bottom, L at left, R at right
 * D: Bottom (-Y), F at top, B at bottom, L at left, R at right
 * L: Left (-X), U at top, D at bottom, B at left, F at right
 * B: Back (-Z), U at top, D at bottom, R at left, L at right
 */
export const STICKER_GEOMS: StickerGeom[] = (() => {
  const list: StickerGeom[] = [];
  for (let fIdx = 0; fIdx < 6; fIdx++) {
    const face = FACE_ORDER[fIdx];
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0;
      if (face === 'U') {
        x = col - 1; y = 1; z = row - 1; ny = 1;
      } else if (face === 'R') {
        x = 1; y = 1 - row; z = 1 - col; nx = 1;
      } else if (face === 'F') {
        x = col - 1; y = 1 - row; z = 1; nz = 1;
      } else if (face === 'D') {
        x = col - 1; y = -1; z = 1 - row; ny = -1;
      } else if (face === 'L') {
        x = -1; y = 1 - row; z = col - 1; nx = -1;
      } else {
        x = 1 - col; y = 1 - row; z = -1; nz = -1;
      }
      list.push({ index: fIdx * 9 + i, face, row, col, x, y, z, nx, ny, nz });
    }
  }
  return list;
})();

const coordKey = (x: number, y: number, z: number, nx: number, ny: number, nz: number) =>
  `${x},${y},${z}|${nx},${ny},${nz}`;

const STICKER_LOOKUP = new Map<string, number>();
for (const s of STICKER_GEOMS) {
  STICKER_LOOKUP.set(coordKey(s.x, s.y, s.z, s.nx, s.ny, s.nz), s.index);
}

/**
 * Rotate vector (x,y,z) around axis ('x'|'y'|'z') by +90 deg or -90 deg (integer right-handed).
 * +90 around X: (x, -z, y)
 * -90 around X: (x, z, -y)
 * +90 around Y: (z, y, -x)
 * -90 around Y: (-z, y, x)
 * +90 around Z: (-y, x, z)
 * -90 around Z: (y, -x, z)
 */
function rotateInt90(
  x: number,
  y: number,
  z: number,
  axis: 'x' | 'y' | 'z',
  dir: 1 | -1
): [number, number, number] {
  if (axis === 'x') {
    return dir === 1 ? [x, -z, y] : [x, z, -y];
  }
  if (axis === 'y') {
    return dir === 1 ? [z, y, -x] : [-z, y, x];
  }
  return dir === 1 ? [-y, x, z] : [y, -x, z];
}

export interface FaceAxisSpec {
  axis: 'x' | 'y' | 'z';
  layer: 1 | -1;
  cwDir: 1 | -1; // right-handed sign for clockwise rotation when viewed from outside
}

export const FACE_AXIS_SPEC: Record<BaseMove, FaceAxisSpec> = {
  U: { axis: 'y', layer: 1, cwDir: -1 },
  D: { axis: 'y', layer: -1, cwDir: 1 },
  R: { axis: 'x', layer: 1, cwDir: -1 },
  L: { axis: 'x', layer: -1, cwDir: 1 },
  F: { axis: 'z', layer: 1, cwDir: -1 },
  B: { axis: 'z', layer: -1, cwDir: 1 },
};

/** Precomputed 54-sticker permutation for each clockwise base move: newState[dest] = oldState[perm[dest]] */
const BASE_MOVE_PERM: Record<BaseMove, number[]> = (() => {
  const perms = {} as Record<BaseMove, number[]>;
  for (const move of FACE_ORDER) {
    const spec = FACE_AXIS_SPEC[move];
    const perm = new Array<number>(54);
    for (let i = 0; i < 54; i++) {
      perm[i] = i;
    }
    for (const s of STICKER_GEOMS) {
      const coord = spec.axis === 'x' ? s.x : spec.axis === 'y' ? s.y : s.z;
      if (coord === spec.layer) {
        const [rx, ry, rz] = rotateInt90(s.x, s.y, s.z, spec.axis, spec.cwDir);
        const [rnx, rny, rnz] = rotateInt90(s.nx, s.ny, s.nz, spec.axis, spec.cwDir);
        const destIdx = STICKER_LOOKUP.get(coordKey(rx, ry, rz, rnx, rny, rnz));
        if (destIdx === undefined) {
          throw new Error(`Invalid sticker rotation for move ${move}`);
        }
        perm[destIdx] = s.index;
      }
    }
    perms[move] = perm;
  }
  return perms;
})();

export function createSolvedFacelets(): Facelets {
  const res: ColorId[] = new Array(54);
  for (let f = 0; f < 6; f++) {
    const col = FACE_DEFAULT_COLOR[FACE_ORDER[f]];
    for (let i = 0; i < 9; i++) {
      res[f * 9 + i] = col;
    }
  }
  return res;
}

export function isSolvedFacelets(facelets: Facelets): boolean {
  for (let f = 0; f < 6; f++) {
    const center = facelets[f * 9 + 4];
    for (let i = 0; i < 9; i++) {
      if (facelets[f * 9 + i] !== center) return false;
    }
  }
  return true;
}

export function parseMove(move: MoveName): { base: BaseMove; turns: 1 | 2 | 3 } {
  const base = move[0] as BaseMove;
  if (move.length === 1) return { base, turns: 1 };
  if (move[1] === '2') return { base, turns: 2 };
  return { base, turns: 3 };
}

export function invertMove(move: MoveName): MoveName {
  const base = move[0] as BaseMove;
  if (move.length === 1) return `${base}'` as MoveName;
  if (move[1] === '2') return move;
  return base;
}

export function applyMove(facelets: Facelets, move: MoveName): Facelets {
  const { base, turns } = parseMove(move);
  const perm = BASE_MOVE_PERM[base];
  let curr = facelets.slice();
  for (let t = 0; t < turns; t++) {
    const next = new Array<ColorId>(54);
    for (let i = 0; i < 54; i++) {
      next[i] = curr[perm[i]];
    }
    curr = next;
  }
  return curr;
}

export function applyMoves(facelets: Facelets, moves: MoveName[]): Facelets {
  let curr = facelets.slice();
  for (const m of moves) {
    curr = applyMove(curr, m);
  }
  return curr;
}

const OPPOSITE_FACE: Record<BaseMove, BaseMove> = {
  U: 'D',
  D: 'U',
  R: 'L',
  L: 'R',
  F: 'B',
  B: 'F',
};

export function generateScramble(length = 20): MoveName[] {
  const suffixes = ['', "'", '2'] as const;
  const moves: MoveName[] = [];
  let prev: BaseMove | null = null;
  let prev2: BaseMove | null = null;

  for (let i = 0; i < length; i++) {
    const candidates = FACE_ORDER.filter((f) => {
      if (f === prev) return false;
      if (prev && prev2 && f === prev2 && OPPOSITE_FACE[prev] === f) return false;
      return true;
    });
    const base = candidates[Math.floor(Math.random() * candidates.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    moves.push(`${base}${suffix}` as MoveName);
    prev2 = prev;
    prev = base;
  }
  return moves;
}

// Corner and Edge facelet indices matching Kociemba conventions
// U(0..8), R(9..17), F(18..26), D(27..35), L(36..44), B(45..53)
export const CORNER_FACELETS: readonly [number, number, number][] = [
  [8, 9, 20],   // URF
  [6, 18, 38],  // UFL
  [0, 36, 47],  // ULB
  [2, 45, 11],  // UBR
  [29, 26, 15], // DFR
  [27, 44, 24], // DLF
  [33, 53, 42], // DBL
  [35, 17, 51], // DRB
];

const CORNER_COLORS: readonly [FaceName, FaceName, FaceName][] = [
  ['U', 'R', 'F'],
  ['U', 'F', 'L'],
  ['U', 'L', 'B'],
  ['U', 'B', 'R'],
  ['D', 'F', 'R'],
  ['D', 'L', 'F'],
  ['D', 'B', 'L'],
  ['D', 'R', 'B'],
];

export const EDGE_FACELETS: readonly [number, number][] = [
  [5, 10],  // UR
  [7, 19],  // UF
  [3, 37],  // UL
  [1, 46],  // UB
  [32, 16], // DR
  [28, 25], // DF
  [30, 43], // DL
  [34, 52], // DB
  [23, 12], // FR
  [21, 41], // FL
  [50, 39], // BL
  [48, 14], // BR
];

const EDGE_COLORS: readonly [FaceName, FaceName][] = [
  ['U', 'R'],
  ['U', 'F'],
  ['U', 'L'],
  ['U', 'B'],
  ['D', 'R'],
  ['D', 'F'],
  ['D', 'L'],
  ['D', 'B'],
  ['F', 'R'],
  ['F', 'L'],
  ['B', 'L'],
  ['B', 'R'],
];

function permutationParity(arr: Int8Array): number {
  let parity = 0;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] > arr[j]) parity ^= 1;
    }
  }
  return parity;
}

export function faceletsToCubie(facelets: Facelets): { cubie: CubieState | null; error: string | null } {
  const cp = new Int8Array(8);
  const co = new Int8Array(8);
  const ep = new Int8Array(12);
  const eo = new Int8Array(12);

  // Dynamically map each center color to its face letter (supports any cube orientation)
  const dynamicColorToFace: Partial<Record<ColorId, FaceName>> = {};
  for (let fIdx = 0; fIdx < 6; fIdx++) {
    const centerColor = facelets[fIdx * 9 + 4];
    if (dynamicColorToFace[centerColor]) {
      return {
        cubie: null,
        error: 'Hər üzün mərkəz xanasında fərqli rəng olmalıdır (təkrarlanan mərkəz rəngi var).',
      };
    }
    dynamicColorToFace[centerColor] = FACE_ORDER[fIdx];
  }

  // Convert color IDs to canonical face letters based on user's 6 center stickers
  const f = facelets.map((c) => dynamicColorToFace[c] ?? COLOR_TO_FACE[c]);

  const seenCorners = new Set<number>();
  for (let i = 0; i < 8; i++) {
    const [i0, i1, i2] = CORNER_FACELETS[i];
    const s = [f[i0], f[i1], f[i2]];
    let ori = -1;
    for (let o = 0; o < 3; o++) {
      if (s[o] === 'U' || s[o] === 'D') {
        ori = o;
        break;
      }
    }
    if (ori === -1) {
      return { cubie: null, error: 'Yanlış künc parçası: Yuxarı (Ağ) və ya Aşağı (Sarı) rəngi olmayan künc var.' };
    }
    const c1 = s[(ori + 1) % 3];
    const c2 = s[(ori + 2) % 3];
    let matched = -1;
    for (let j = 0; j < 8; j++) {
      if (s[ori] === CORNER_COLORS[j][0] && c1 === CORNER_COLORS[j][1] && c2 === CORNER_COLORS[j][2]) {
        matched = j;
        break;
      }
    }
    if (matched === -1) {
      return { cubie: null, error: 'Yanlış künc rəng kombinasiyası aşkarlandı. Rənglərin sırasını yoxlayın.' };
    }
    if (seenCorners.has(matched)) {
      return { cubie: null, error: 'Təkrarlanan künc parçası var. Hər künc yalnız bir dəfə olmalıdır.' };
    }
    seenCorners.add(matched);
    cp[i] = matched;
    co[i] = ori;
  }

  const seenEdges = new Set<number>();
  for (let i = 0; i < 12; i++) {
    const [i0, i1] = EDGE_FACELETS[i];
    const s0 = f[i0];
    const s1 = f[i1];
    let matched = -1;
    let ori = 0;
    for (let j = 0; j < 12; j++) {
      if (s0 === EDGE_COLORS[j][0] && s1 === EDGE_COLORS[j][1]) {
        matched = j;
        ori = 0;
        break;
      }
      if (s0 === EDGE_COLORS[j][1] && s1 === EDGE_COLORS[j][0]) {
        matched = j;
        ori = 1;
        break;
      }
    }
    if (matched === -1) {
      return { cubie: null, error: 'Yanlış kənar (edge) parçası aşkarlandı. Əks rənglər eyni kənarda ola bilməz.' };
    }
    if (seenEdges.has(matched)) {
      return { cubie: null, error: 'Təkrarlanan kənar parçası var. Hər kənar yalnız bir dəfə olmalıdır.' };
    }
    seenEdges.add(matched);
    ep[i] = matched;
    eo[i] = ori;
  }

  let cornerTwistSum = 0;
  for (let i = 0; i < 8; i++) cornerTwistSum += co[i];
  if (cornerTwistSum % 3 !== 0) {
    return {
      cubie: null,
      error: 'Künc bükülmə (twist) xətası: bu vəziyyətdə kub riyazi olaraq yığıla bilməz.',
    };
  }

  let edgeFlipSum = 0;
  for (let i = 0; i < 12; i++) edgeFlipSum += eo[i];
  if (edgeFlipSum % 2 !== 0) {
    return {
      cubie: null,
      error: 'Kənar çevrilmə (flip) xətası: bir kənar tərs qoyulub, kub yığıla bilməz.',
    };
  }

  if (permutationParity(cp) !== permutationParity(ep)) {
    return {
      cubie: null,
      error: 'Paritet xətası: iki künc və ya iki kənar yerini dəyişməlidir, bu vəziyyət həllolunmazdır.',
    };
  }

  return { cubie: { cp, co, ep, eo }, error: null };
}

export function validateFacelets(facelets: Facelets): ValidationResult {
  const counts: Record<ColorId, number> = {
    W: 0,
    Y: 0,
    G: 0,
    B: 0,
    O: 0,
    R: 0,
  };

  for (const c of facelets) {
    if (counts[c] !== undefined) counts[c]++;
  }

  // Check exact count of 9 per color
  for (const color of PALETTE_ORDER) {
    if (counts[color] !== 9) {
      return {
        valid: false,
        counts,
        error: `Hər rəngdən dəqiq 9 ədəd olmalıdır (${COLOR_META[color].nameAz.split(' ')[0]}: ${counts[color]}/9).`,
      };
    }
  }

  // Full cubie & parity check (also verifies 6 unique centers)
  const { error } = faceletsToCubie(facelets);
  if (error) {
    return {
      valid: false,
      counts,
      error,
    };
  }

  return {
    valid: true,
    counts,
    error: null,
  };
}

export function createEmptyDraftFacelets(): DraftFacelets {
  return new Array(54).fill(null);
}

export function isFaceComplete(draft: DraftFacelets, faceOffset: number): boolean {
  for (let i = 0; i < 9; i++) {
    if (draft[faceOffset + i] === null) return false;
  }
  return true;
}

export function validateDraftFacelets(draft: DraftFacelets): ValidationResult {
  const counts: Record<ColorId, number> = {
    W: 0,
    Y: 0,
    G: 0,
    B: 0,
    O: 0,
    R: 0,
  };

  let emptyCount = 0;
  for (const c of draft) {
    if (c === null) {
      emptyCount++;
    } else if (counts[c] !== undefined) {
      counts[c]++;
    }
  }

  if (emptyCount > 0) {
    return {
      valid: false,
      counts,
      error: `Bütün xanalar doldurulmalıdır (${emptyCount} boş xana qalıb).`,
    };
  }

  const diffs: string[] = [];
  for (const color of WIZARD_PALETTE_ORDER) {
    const cnt = counts[color];
    const name = COLOR_META[color].nameAz.split(' ')[0];
    if (cnt < 9) {
      diffs.push(`${name}: ${9 - cnt} azdır (${cnt}/9)`);
    } else if (cnt > 9) {
      diffs.push(`${name}: ${cnt - 9} artıqdır (${cnt}/9)`);
    }
  }

  if (diffs.length > 0) {
    return {
      valid: false,
      counts,
      error: `Rəng sayları uyğun deyil — ${diffs.join(' · ')}`,
    };
  }

  return validateFacelets(draft as Facelets);
}

