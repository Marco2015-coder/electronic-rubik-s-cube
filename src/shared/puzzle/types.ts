/**
 * 魔方通用模型。
 *
 * 设计要点：
 *  - 每种魔方都由一组「块」(Piece) 组成，每个块是一个凸多面体加若干贴纸。
 *  - 块的姿态只有「平移 + 旋转」，转一圈后能精确回到原位，不存在浮点累积问题。
 *  - 转动 (Move) 是「绕经过原点的某条轴旋转固定角度」，一次性更新参与块。
 */

import { Mat3, Vec3, mApply, mRotate, mMul, mSnap, vDist } from '../math';
import { Solid } from '../solid';

/** 贴纸颜色：语义化键名，由主题映射成具体色值。 */
export type ColorKey = 'U' | 'D' | 'F' | 'B' | 'L' | 'R' | 'body' | 'mirror' | 'inner';

export interface Sticker {
  colorKey: ColorKey;
  /** 归位时的外法向。 */
  normal: Vec3;
  /** 归位时的多边形顶点环。 */
  loop: Vec3[];
  centroid: Vec3;
}

export interface Piece {
  id: number;
  /** 归位时的重心。 */
  home: Vec3;
  /** 归位时的几何（含所有面）。 */
  solid: Solid;
  /** 与 solid.faces 一一对应的面颜色，非贴纸面为 'body'。 */
  faceColors: ColorKey[];
  stickers: Sticker[];
  /** 朝向是否影响外观（镜面魔方：形状不同，必须为 true）。 */
  orientationMatters: boolean;
  /** 当前位置（重心）。 */
  pos: Vec3;
  /** 当前朝向（旋转矩阵）。 */
  rot: Mat3;
}

/** 姿态：把块的局部坐标（相对 home）映射到世界。 */
export interface Pose {
  pos: Vec3;
  rot: Mat3;
}

export interface Move {
  /** 转轴（单位向量，过原点）。 */
  axis: Vec3;
  /** 有符号弧度。 */
  angle: number;
  /** 显示用的记号，如 "U"、"R'"、"Uw2"。 */
  label: string;
  /** 参与转动的块 id。 */
  pieceIds: number[];
  /** 所属面（立方体系魔方用）。 */
  face?: string;
  /** 沿轴的层索引闭区间（立方体系魔方用）。 */
  layers?: [number, number];
}

/** 拾取结果。 */
export interface HitInfo {
  pieceId: number;
  /** 命中面在世界空间的外法向。 */
  normal: Vec3;
  /** 命中点（世界空间）。 */
  point: Vec3;
}

export interface MoveOptions {
  /** 是否连带内层一起转（宽层转）。 */
  wide: boolean;
}

export interface Puzzle {
  readonly id: string;
  readonly displayName: string;
  readonly pieces: Piece[];
  /** 拧动历史（用于撤销）。 */
  readonly history: Move[];
  /** 由拾取结果推导出该执行的转动。 */
  moveFromHit(hit: HitInfo, options: MoveOptions): Move | null;
  /** 枚举该次拾取可能触发的全部转动（供「按拖动方向决定转法」使用）。 */
  candidateMoves(hit: HitInfo, options: MoveOptions): Move[];
  /** 施加转动（不带动画，动画由渲染层负责）。 */
  apply(move: Move): void;
  /**
   * 施加转动但不记入历史。
   * 打乱动画必须走这条路径：打乱序列已经在 `scramble()` 里算过一遍，
   * 动画播放时是「从还原态重新执行一遍」，不应该污染撤销历史。
   */
  applySilent(move: Move): void;
  reset(): void;
  isSolved(): boolean;
  /** 随机打乱并返回打乱序列。 */
  scramble(): Move[];
  /** 撤销上一步。 */
  undo(): Move | null;
}

// ---------------------------------------------------------------------------
// 姿态工具
// ---------------------------------------------------------------------------

export const identityPose = (): Pose => ({ pos: { x: 0, y: 0, z: 0 }, rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] });

/** 把块局部坐标转换到世界坐标。 */
export function localToWorld(piece: Piece, local: Vec3): Vec3 {
  const d = { x: local.x - piece.home.x, y: local.y - piece.home.y, z: local.z - piece.home.z };
  const r = mApply(piece.rot, d);
  return { x: piece.pos.x + r.x, y: piece.pos.y + r.y, z: piece.pos.z + r.z };
}

/** 计算某个块在「动画中」的临时姿态。 */
export function animPose(piece: Piece, axis: Vec3, angle: number): Pose {
  if (Math.abs(angle) < 1e-9) return { pos: piece.pos, rot: piece.rot };
  const r = mRotate(axis, angle);
  return { pos: mApply(r, piece.pos), rot: mMul(r, piece.rot) };
}

export function applyRotationToPiece(piece: Piece, axis: Vec3, angle: number): void {
  const r = mRotate(axis, angle);
  const p = mApply(r, piece.pos);
  piece.pos = { x: snap(p.x), y: snap(p.y), z: snap(p.z) };
  piece.rot = mSnap(mMul(r, piece.rot));
}

function snap(v: number): number {
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-6 ? r : Math.abs(v) < 1e-6 ? 0 : v;
}

/** 块是否回到归位状态。 */
export function isPieceHome(piece: Piece): boolean {
  if (vDist(piece.pos, piece.home) > 1e-4) return false;
  if (!piece.orientationMatters) return true;
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let i = 0; i < 9; i++) {
    if (Math.abs(piece.rot[i] - id[i]) > 1e-4) return false;
  }
  return true;
}

/** 查找命中面所属的块。 */
export function findPiece(pieces: Piece[], id: number): Piece | undefined {
  return pieces.find((p) => p.id === id);
}

export type { Mat3, Vec3, Solid };
