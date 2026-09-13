/**
 * N 阶立方体魔方（2x2 / 3x3 / 4x4 / 5x5），以及镜面（镜面块）版本。
 *
 * 所有块都是长方体：把 [-1,1]^3 按每个轴切成 N 段即可。
 *  - 普通配色：外表面贴彩色贴纸，内部面为深色塑料。
 *  - 镜面配色：全部贴纸同色（金属/金色），靠各块尺寸差异辨认，属于「形状魔方」。
 */

import { Vec3, V, vAdd, vScale, vDist, mRotate, mSnap } from '../math';
import { Plane, Solid, buildConvex, boxPlanes, scaleSolid } from '../solid';
import {
  ColorKey,
  HitInfo,
  Move,
  MoveOptions,
  Piece,
  Puzzle,
  applyRotationToPiece,
  isPieceHome,
  localToWorld,
} from './types';

export type FaceKey = 'R' | 'L' | 'U' | 'D' | 'F' | 'B';

export interface FaceDef {
  key: FaceKey;
  axis: number;
  dir: 1 | -1;
}

export const FACE_DEFS: FaceDef[] = [
  { key: 'R', axis: 0, dir: 1 },
  { key: 'L', axis: 0, dir: -1 },
  { key: 'U', axis: 1, dir: 1 },
  { key: 'D', axis: 1, dir: -1 },
  { key: 'F', axis: 2, dir: 1 },
  { key: 'B', axis: 2, dir: -1 },
];

export const AXES: Vec3[] = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)];

export type CubeStyle = 'standard' | 'mirror';

export interface CubicOptions {
  size: number;
  style: CubeStyle;
  /** 块之间的缝隙（相对块尺寸的比例）。 */
  gap?: number;
  /** 镜面魔方的随机切分种子。 */
  seed?: number;
}

/** 可复现的伪随机数发生器。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 均匀切分。 */
function uniformCuts(size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= size; i++) out.push(-1 + (2 * i) / size);
  return out;
}

/**
 * 镜面魔方的切分：三轴共用同一套、且关于原点对称的随机切分。
 *
 * 为什么必须「关于 0 对称」并且「三个轴完全相同」：
 * 块绕某根轴转 90° 时，它在另外两根轴上的跨度会被搬到另一根轴上。
 * 只有切分关于 0 对称（-A = A）、且三个轴用的是同一套位置，旋转后的块
 * 才会仍然精确落在某个格子里。否则块会横跨两层，之后按「位置所在层」
 * 挑参与转动的块时就会带上不该转的块，两块被拧进同一格（视觉重叠）。
 *
 * 代价是段长必然成对出现（对称导致的），块尺寸不再两两不同——但这是纯几何
 * 刚体模型下唯一能保证转动后仍严丝合缝的做法。
 */
export function mirrorCutPositions(size: number, seed: number): number[] {
  const count = size - 1; // 内切面个数
  const half = Math.floor(count / 2); // 正半轴上的内切面个数
  const hasCenter = count % 2 === 1; // 内切面为奇数个时，正中间正好落一刀
  const minGap = Math.min(0.34, 1.5 / size);
  const rnd = mulberry32(seed);

  const positive: number[] = [];
  let prev = 0;
  for (let i = 0; i < half; i++) {
    // 右侧还要放下 (half - i) 刀，每刀之间至少留 minGap
    const upper = 1 - (half - i) * minGap;
    const lower = prev + minGap;
    const v = lower + rnd() * Math.max(0, upper - lower);
    positive.push(v);
    prev = v;
  }

  const negative = positive.map((v) => -v).reverse();
  const inner = hasCenter ? [...negative, 0, ...positive] : [...negative, ...positive];
  return [-1, ...inner, 1];
}

/** 计算每个轴上的切分位置（长度 size + 1，从 -1 到 1 递增）。 */
export function cutPositions(size: number, style: CubeStyle, seed: number): number[] {
  return style === 'mirror' ? mirrorCutPositions(size, seed) : uniformCuts(size);
}

/** 由外法向求面定义。 */
export function faceDefFromNormal(n: Vec3): FaceDef | null {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  let axis = 0;
  let sign = 1;
  if (ax >= ay && ax >= az) {
    axis = 0;
    sign = n.x >= 0 ? 1 : -1;
  } else if (ay >= ax && ay >= az) {
    axis = 1;
    sign = n.y >= 0 ? 1 : -1;
  } else {
    axis = 2;
    sign = n.z >= 0 ? 1 : -1;
  }
  return FACE_DEFS.find((f) => f.axis === axis && f.dir === sign) ?? null;
}

class CubicPuzzle implements Puzzle {
  readonly id: string;
  readonly displayName: string;
  readonly pieces: Piece[] = [];
  readonly history: Move[] = [];

  readonly size: number;
  readonly style: CubeStyle;

  /** pieceId -> 该块在三个轴上的层索引。 */
  private layerOf: number[][] = [];
  /** 每个块在三个轴上的层索引。 */
  private cuts: number[][];

  constructor(options: CubicOptions) {
    const { size, style } = options;
    this.size = size;
    this.style = style;
    this.id = style === 'mirror' ? `cube${size}-mirror` : `cube${size}`;
    this.displayName =
      style === 'mirror' ? `镜面${cnNumber(size)}阶魔方` : `普通${cnNumber(size)}阶魔方`;

    const gap = options.gap ?? (style === 'mirror' ? 0.006 : 0.012);
    // 三个轴共用同一套切分（镜面魔方必须如此，理由见 mirrorCutPositions；
    // 普通魔方本来就是均匀切分，共用毫无差别）。
    const cuts = cutPositions(size, style, options.seed ?? 20240901);
    this.cuts = [cuts, cuts, cuts];

    let id = 0;
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        for (let k = 0; k < size; k++) {
          const idx = [i, j, k];
          if (style === 'standard' && i > 0 && i < size - 1 && j > 0 && j < size - 1 && k > 0 && k < size - 1) {
            // 完全不可见的内部块（3 阶只有 1 块）
            continue;
          }
          const min = V(this.cuts[0][i], this.cuts[1][j], this.cuts[2][k]);
          const max = V(this.cuts[0][i + 1], this.cuts[1][j + 1], this.cuts[2][k + 1]);
          const solid = buildConvex(boxPlanes(min, max));
          const home = vScale(vAdd(min, max), 0.5);

          const body = scaleSolid(solid, 1 - gap, home);
          const stickers = [];
          const faceColors: ColorKey[] = [];
          for (const face of body.faces) {
            const key = this.stickerKey(idx, face.normal);
            faceColors.push(key ?? 'body');
            if (!key) continue;
            stickers.push({
              colorKey: key,
              normal: face.normal,
              loop: face.loop,
              centroid: face.centroid,
            });
          }

          const piece: Piece = {
            id,
            home,
            solid: body,
            faceColors,
            stickers,
            // 镜面魔方靠尺寸辨认朝向；普通魔方单色块朝向不可见
            orientationMatters: style === 'mirror' ? true : stickers.length >= 2,
            pos: { ...home },
            rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          };
          this.pieces.push(piece);
          this.layerOf[id] = idx;
          id++;
        }
      }
    }
  }

  /** 判断某个面是否需要贴纸，返回贴纸颜色键。 */
  private stickerKey(idx: number[], normal: Vec3): ColorKey | null {
    const def = faceDefFromNormal(normal);
    if (!def) return null;
    const onSurface = def.dir === 1 ? idx[def.axis] === this.size - 1 : idx[def.axis] === 0;
    if (!onSurface) return null;
    return this.style === 'mirror' ? 'mirror' : def.key;
  }

  /**
   * 该块「当前」在某轴上的层索引。
   * 必须按当前位置判定：块转过之后，归位层索引已经不能代表它实际所在的层，
   * 否则会选错块集合，导致两块转到同一格（视觉上重叠）。
   */
  private currentLayer(piece: Piece, axis: number): number {
    const c = this.cuts[axis];
    const v = axis === 0 ? piece.pos.x : axis === 1 ? piece.pos.y : piece.pos.z;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.size; i++) {
      const d = Math.abs((c[i] + c[i + 1]) / 2 - v);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /** 该块在某轴上的层索引。 */
  layerIndex(pieceId: number, axis: number): number {
    const piece = this.pieces[pieceId];
    return piece ? this.currentLayer(piece, axis) : this.layerOf[pieceId][axis];
  }

  /**
   * 构造一条转动。
   * @param layers 沿该轴的层索引闭区间（从 0 数起）
   * @param turns  转数，正数为该面的顺时针，负数为逆时针，2 为 180°
   */
  buildMove(faceKey: FaceKey, layers: [number, number], turns: number): Move {
    const def = FACE_DEFS.find((f) => f.key === faceKey)!;
    const n = this.size;
    const lo = Math.max(0, Math.min(layers[0], layers[1]));
    const hi = Math.min(n - 1, Math.max(layers[0], layers[1]));
    const width = hi - lo + 1;

    const pieceIds: number[] = [];
    for (const p of this.pieces) {
      const idx = this.currentLayer(p, def.axis);
      if (idx >= lo && idx <= hi) pieceIds.push(p.id);
    }

    const abs = Math.abs(turns);
    // 该面顺时针 = 绕「面外法向」旋转 -90°（右手定则）
    const angle = -def.dir * (Math.PI / 2) * turns;
    const suffix =
      (width === 2 ? 'w' : width > 2 ? `${width}w` : '') + (abs === 2 ? '2' : turns < 0 ? "'" : '');
    // 单独转内层时用「深度前缀」区分，例如 5 阶的 2U
    const depth = def.dir === 1 ? n - hi : lo + 1;
    const prefix = width === 1 && depth > 1 ? String(depth) : '';
    return {
      axis: AXES[def.axis],
      angle,
      label: `${prefix}${faceKey}${suffix}`,
      pieceIds,
      face: faceKey,
      layers: [lo, hi],
    };
  }

  /** 拾取某层的单层转（内层则为切片转）。 */
  moveFromHit(hit: HitInfo, options: MoveOptions): Move | null {
    const def = faceDefFromNormal(hit.normal);
    if (!def) return null;
    const hitPiece = this.pieces[hit.pieceId];
    if (!hitPiece) return null;
    const layer = this.currentLayer(hitPiece, def.axis);
    const n = this.size;
    if (!options.wide) return this.buildMove(def.key, [layer, layer], 1);
    // 长按/Shift：从该面向内连同若干层一起转（最外层默认带 2 层）
    const depth = def.dir === 1 ? n - layer : layer + 1;
    const width = Math.min(n, Math.max(2, depth));
    const layers: [number, number] = def.dir === 1 ? [n - width, n - 1] : [0, width - 1];
    return this.buildMove(def.key, layers, 1);
  }

  /**
   * 枚举拾取点可能的转动：该块所在的三个轴各自正反两个方向。
   * 具体转哪一层取决于拖动方向，由界面层按「预测位移方向」打分挑选。
   */
  candidateMoves(hit: HitInfo, options: MoveOptions): Move[] {
    const out: Move[] = [];
    const n = this.size;
    const hitPiece = this.pieces[hit.pieceId];
    if (!hitPiece) return out;
    for (let axis = 0; axis < 3; axis++) {
      const i = this.currentLayer(hitPiece, axis);
      const plus = FACE_DEFS.find((f) => f.axis === axis && f.dir === 1)!.key;
      const minus = FACE_DEFS.find((f) => f.axis === axis && f.dir === -1)!.key;
      if (!options.wide) {
        out.push(this.buildMove(plus, [i, i], 1));
        out.push(this.buildMove(plus, [i, i], -1));
      } else {
        const fromPlus = i >= (n - 1) / 2;
        const face = fromPlus ? plus : minus;
        const span = fromPlus ? n - i : i + 1;
        const width = Math.min(n, Math.max(2, span));
        const layers: [number, number] = fromPlus ? [n - width, n - 1] : [0, width - 1];
        out.push(this.buildMove(face, layers, 1));
        out.push(this.buildMove(face, layers, -1));
      }
    }
    return out;
  }

  /** 生成该魔方全部基础转动（用于打乱与教学提示）。 */
  allTurns(): Move[] {
    const out: Move[] = [];
    const n = this.size;
    const maxWidth = Math.max(1, Math.floor(n / 2));
    for (const def of FACE_DEFS) {
      for (let w = 1; w <= maxWidth; w++) {
        const layers: [number, number] = def.dir === 1 ? [n - w, n - 1] : [0, w - 1];
        out.push(this.buildMove(def.key, layers, 1));
      }
    }
    return out;
  }

  apply(move: Move): void {
    for (const id of move.pieceIds) {
      const piece = this.pieces[id];
      if (piece) applyRotationToPiece(piece, move.axis, move.angle);
    }
    this.history.push(move);
    if (this.history.length > 200) this.history.shift();
  }

  /** 施加但不记入历史（打乱用）。 */
  applySilent(move: Move): void {
    for (const id of move.pieceIds) {
      const piece = this.pieces[id];
      if (piece) applyRotationToPiece(piece, move.axis, move.angle);
    }
  }

  reset(): void {
    for (const p of this.pieces) {
      p.pos = { ...p.home };
      p.rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }
    this.history.length = 0;
  }

  isSolved(): boolean {
    if (this.style === 'mirror') {
      // 镜面魔方靠形状辨认朝向。对称切分下必然会切出「正方体块」，
      // 它们绕任意轴转 90°、绕体对角线转 120° 后外观完全一样，
      // 所以这类块只要位置归位就算归位，否则会出现「看着已复原却不判定」。
      return this.pieces.every((p) => isPieceHome(p) || (isCubeShaped(p) && vDist(p.pos, p.home) < 1e-4));
    }
    for (const piece of this.pieces) {
      for (const st of piece.stickers) {
        const worldNormal = mSnap([
          piece.rot[0] * st.normal.x + piece.rot[1] * st.normal.y + piece.rot[2] * st.normal.z,
          piece.rot[3] * st.normal.x + piece.rot[4] * st.normal.y + piece.rot[5] * st.normal.z,
          piece.rot[6] * st.normal.x + piece.rot[7] * st.normal.y + piece.rot[8] * st.normal.z,
        ]);
        const def = faceDefFromNormal({ x: worldNormal[0], y: worldNormal[1], z: worldNormal[2] });
        if (!def) return false;
        if (def.key !== st.colorKey) return false;
      }
    }
    return true;
  }

  scramble(): Move[] {
    // 打乱一律从已还原状态开始，并清空拧动历史
    this.reset();
    const pool = this.allTurns();
    const rnd = mulberry32(Date.now() & 0xffffffff);
    const count = this.size <= 2 ? 12 : this.size === 3 ? 22 : this.size === 4 ? 40 : 60;
    const out: Move[] = [];
    for (let i = 0; i < count; i++) {
      let pick = pool[Math.floor(rnd() * pool.length)];
      let guard = 0;
      const prev = out[out.length - 1];
      while (guard++ < 30 && prev && pick.face === prev.face) {
        pick = pool[Math.floor(rnd() * pool.length)];
      }
      const roll = rnd();
      const turns = roll < 0.18 ? 2 : roll < 0.5 ? -1 : 1;
      const move = this.buildMove(pick.face as FaceKey, pick.layers as [number, number], turns);
      out.push(move);
      this.applySilent(move);
    }
    return out;
  }

  undo(): Move | null {
    const last = this.history.pop();
    if (!last) return null;
    const inverse: Move = {
      axis: last.axis,
      angle: -last.angle,
      label: invertLabel(last.label),
      pieceIds: last.pieceIds.slice(),
    };
    for (const id of inverse.pieceIds) {
      const piece = this.pieces[id];
      if (piece) applyRotationToPiece(piece, inverse.axis, inverse.angle);
    }
    return inverse;
  }

  /** 贴纸世界坐标（供渲染/调试）。 */
  stickerWorldLoop(piece: Piece, index: number): Vec3[] {
    const st = piece.stickers[index];
    return st ? st.loop.map((p) => localToWorld(piece, p)) : [];
  }
}

/** 块是否为正方体（三个方向的尺寸相等）：这类块转 90° 后外观不变。 */
function isCubeShaped(piece: Piece): boolean {
  const min = V(Infinity, Infinity, Infinity);
  const max = V(-Infinity, -Infinity, -Infinity);
  for (const v of piece.solid.vertices) {
    min.x = Math.min(min.x, v.x);
    min.y = Math.min(min.y, v.y);
    min.z = Math.min(min.z, v.z);
    max.x = Math.max(max.x, v.x);
    max.y = Math.max(max.y, v.y);
    max.z = Math.max(max.z, v.z);
  }
  const dx = max.x - min.x;
  const dy = max.y - min.y;
  const dz = max.z - min.z;
  const avg = (dx + dy + dz) / 3;
  return Math.abs(dx - avg) < 1e-4 && Math.abs(dy - avg) < 1e-4 && Math.abs(dz - avg) < 1e-4;
}

export function invertLabel(label: string): string {
  if (label.endsWith("'")) return label.slice(0, -1);
  if (label.endsWith('2')) return label.slice(0, -2) + '2';
  return label + "'";
}

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export function cnNumber(n: number): string {
  return CN[n] ?? String(n);
}

export function createCubicPuzzle(options: CubicOptions): Puzzle {
  return new CubicPuzzle(options);
}

export { mRotate };
export type { Plane, Solid };
