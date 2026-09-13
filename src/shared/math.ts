/**
 * 基础三维数学：向量与 3x3 矩阵。
 *
 * 这是整个游戏的地基：所有魔方（N 阶立方体、五魔方、金字塔、斜转……）
 * 的每个「块」都由凸多面体生成，块的姿态用 3x3 旋转矩阵表示。
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 数值容差：坐标量级约 1，1e-6 足够。 */
export const EPS = 1e-6;
/** 顶点合并容差。 */
export const MERGE_EPS = 1e-5;

export const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const vAdd = (a: Vec3, b: Vec3): Vec3 => V(a.x + b.x, a.y + b.y, a.z + b.z);
export const vSub = (a: Vec3, b: Vec3): Vec3 => V(a.x - b.x, a.y - b.y, a.z - b.z);
export const vScale = (a: Vec3, s: number): Vec3 => V(a.x * s, a.y * s, a.z * s);
export const vNeg = (a: Vec3): Vec3 => V(-a.x, -a.y, -a.z);

export const vDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const vCross = (a: Vec3, b: Vec3): Vec3 =>
  V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const vLen = (a: Vec3): number => Math.sqrt(vDot(a, a));

export function vNorm(a: Vec3): Vec3 {
  const l = vLen(a);
  return l < EPS ? V(0, 0, 0) : vScale(a, 1 / l);
}

export const vDist = (a: Vec3, b: Vec3): number => vLen(vSub(a, b));

export const vLerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

export const vAlmost = (a: Vec3, b: Vec3, eps: number = EPS): boolean => vDist(a, b) <= eps;

/** 顶点去重用的哈希键。 */
export const vKey = (a: Vec3, eps: number = MERGE_EPS): string =>
  `${Math.round(a.x / eps)},${Math.round(a.y / eps)},${Math.round(a.z / eps)}`;

/** 求若干点的重心。 */
export function vCentroid(points: Vec3[]): Vec3 {
  if (points.length === 0) return V(0, 0, 0);
  const s = points.reduce((acc, p) => vAdd(acc, p), V(0, 0, 0));
  return vScale(s, 1 / points.length);
}

// ---------------------------------------------------------------------------
// 3x3 矩阵（行主序）
// ---------------------------------------------------------------------------

/** 3x3 矩阵，行主序：[m00,m01,m02, m10,m11,m12, m20,m21,m22]。 */
export type Mat3 = number[];

export const mIdentity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** 矩阵乘法 a·b（语义：先施加 b，再施加 a）。 */
export function mMul(a: Mat3, b: Mat3): Mat3 {
  const out: Mat3 = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

export function mApply(m: Mat3, v: Vec3): Vec3 {
  return V(
    m[0] * v.x + m[1] * v.y + m[2] * v.z,
    m[3] * v.x + m[4] * v.y + m[5] * v.z,
    m[6] * v.x + m[7] * v.y + m[8] * v.z,
  );
}

/** 转置（对旋转矩阵即为逆）。 */
export const mTranspose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** 绕轴 axis 旋转 angle 弧度（罗德里格斯公式）。 */
export function mRotate(axis: Vec3, angle: number): Mat3 {
  const a = vNorm(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const { x, y, z } = a;
  return [
    c + x * x * t, x * y * t - z * s, x * z * t + y * s,
    y * x * t + z * s, c + y * y * t, y * z * t - x * s,
    z * x * t - y * s, z * y * t + x * s, c + z * z * t,
  ];
}

/** 消除浮点漂移：把接近整数 / 接近 0 的分量吸附干净。 */
export function mSnap(m: Mat3): Mat3 {
  return m.map((v) => {
    const r = Math.round(v);
    return Math.abs(v - r) < 1e-6 ? r : Math.abs(v) < 1e-6 ? 0 : v;
  });
}

export function mAlmostEqual(a: Mat3, b: Mat3, eps = 1e-5): boolean {
  for (let i = 0; i < 9; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
  return true;
}

/** 矩阵行列式。 */
export function mDet(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}
