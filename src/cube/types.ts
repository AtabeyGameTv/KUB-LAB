export type FaceName = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';

export type ColorId = 'W' | 'R' | 'G' | 'Y' | 'O' | 'B';

export type BaseMove = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';

export type MoveName =
  | 'U' | "U'" | 'U2'
  | 'R' | "R'" | 'R2'
  | 'F' | "F'" | 'F2'
  | 'D' | "D'" | 'D2'
  | 'L' | "L'" | 'L2'
  | 'B' | "B'" | 'B2';

/** 54 stickers in order: U(0..8), R(9..17), F(18..26), D(27..35), L(36..44), B(45..53) */
export type Facelets = ColorId[];

/** 54 stickers where unpainted cells are null (rendered as gray) */
export type DraftFacelets = (ColorId | null)[];

export interface ColorMeta {
  id: ColorId;
  face: FaceName;
  nameAz: string;
  hex: string;
  threeHex: number;
  textDark: boolean;
}

export interface ValidationResult {
  valid: boolean;
  counts: Record<ColorId, number>;
  error: string | null;
}

export interface CubieState {
  cp: Int8Array; // length 8
  co: Int8Array; // length 8
  ep: Int8Array; // length 12
  eo: Int8Array; // length 12
}

export interface SolveResult {
  moves: MoveName[];
  durationMs: number;
  alreadySolved: boolean;
}
