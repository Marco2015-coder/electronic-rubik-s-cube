/**
 * 凸多面体构造：把「若干半空间的交集」变成带面环的实体。
 *
 * 每种魔方的每个块都只需描述它被哪些平面切割，本模块会自动求出
 * 精确的顶点与面。这样立方体、正十二面体、正四面体、斜转切割
 * 全都共用同一套代码。
 */

import {
  EPS,
  Vec3,
  V,
  vAdd,
  vAlmost,
  vCross,
  vDot,
  vKey,
  vNorm,
  vScale,
  vSub,
  vCentroid,
} from './math';

/** 半空间：n·x <= d 为实体内部。 */
export interface Plane {
  n: Vec3;
  d: number;
}

export const plane = (n: Vec3, d: number): Plane => ({ n: vNorm(n), d });

/** 由「经过 offset、法向 n」的平面构造半空间：n·x <= n·offset。 */
export const planeAt = (n: Vec3, offset: Vec3): Plane => {
  const nn = vNorm(n);
  return { n: nn, d: vDot(nn, offset) };
};

export interface SolidFace {
  /** 该面所在平面在传入数组中的下标。 */
  planeIndex: number;
  /** 外法向。 */
  normal: Vec3;
  /** 面重心。 */
  centroid: Vec3;
  /** 面积。 */
  area: number;
  /** 顶点环（按外法向看去为逆时针）。 */
  loop: Vec3[];
}

export interface Solid {
  vertices: Vec3[];
  faces: SolidFace[];
}

/** 克拉默法则解 3x3 方程组，退化时返回 null。 */
function solve3(a: Vec3, b: Vec3, c: Vec3, ad: number, bd: number, cd: number): Vec3 | null {
  const det = vDot(a, vCross(b, c));
  if (Math.abs(det) < 1e-9) return null;
  const p = vAdd(
    vAdd(vScale(vCross(b, c), ad), vScale(vCross(c, a), bd)),
    vScale(vCross(a, b), cd),
  );
  return vScale(p, 1 / det);
}

/** Newell 法求多边形法向（未归一化，长度 = 2 倍面积）。 */
function newell(loop: Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return V(nx, ny, nz);
}

/** 把同一平面上的若干点整理成逆时针面环。 */
export function orderLoop(points: Vec3[], normal: Vec3): Vec3[] {
  const c = vCentroid(points);
  const up = Math.abs(normal.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  const u = vNorm(vCross(normal, up));
  const w = vCross(normal, u);

  const sorted = points
    .map((p) => {
      const d = vSub(p, c);
      return { p, a: Math.atan2(vDot(d, w), vDot(d, u)) };
    })
    .sort((x, y) => x.a - y.a)
    .map((x) => x.p);

  if (vDot(newell(sorted), normal) < 0) sorted.reverse();
  return sorted;
}

/**
 * 由半空间集合构造凸多面体。
 *
 * 步骤：合并重复平面 → 枚举三元组求交点 → 保留满足全部约束的点 →
 * 按平面分组、排序成面环。
 */
export function buildConvex(planes: Plane[], minArea = 1e-7): Solid {
  // 1. 去掉重复平面
  const uniq: Plane[] = [];
  const seen = new Set<string>();
  for (const p of planes) {
    const key = `${vKey(p.n, 1e-6)}|${Math.round(p.d * 1e6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }

  // 2. 枚举三元组求顶点
  const verts: Vec3[] = [];
  const buckets = new Map<string, Vec3>();
  const pushIfValid = (p: Vec3): void => {
    for (const pl of uniq) {
      if (vDot(pl.n, p) > pl.d + 1e-6) return;
    }
    const k = vKey(p, 1e-5);
    if (!buckets.has(k)) {
      buckets.set(k, p);
      verts.push(p);
    }
  };

  const n = uniq.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const p = solve3(uniq[i].n, uniq[j].n, uniq[k].n, uniq[i].d, uniq[j].d, uniq[k].d);
        if (p) pushIfValid(p);
      }
    }
  }
  if (verts.length < 4) return { vertices: verts, faces: [] };

  // 3. 按平面收集面
  const faces: SolidFace[] = [];
  uniq.forEach((pl, idx) => {
    const on: Vec3[] = [];
    const used = new Set<string>();
    for (const p of verts) {
      if (Math.abs(vDot(pl.n, p) - pl.d) > 1e-5) continue;
      const k = vKey(p, 1e-5);
      if (used.has(k)) continue;
      used.add(k);
      on.push(p);
    }
    if (on.length < 3) return;
    const loop = orderLoop(on, pl.n);
    const nl = newell(loop);
    const area = Math.sqrt(vDot(nl, nl)) / 2;
    if (area < minArea) return;
    faces.push({ planeIndex: idx, normal: pl.n, centroid: vCentroid(loop), area, loop });
  });

  return { vertices: verts, faces };
}

/** 把一个多面体沿其重心缩放（用于制造块与块之间的缝隙）。 */
export function scaleSolid(solid: Solid, factor: number, origin?: Vec3): Solid {
  const o = origin ?? vCentroid(solid.vertices);
  const map = (p: Vec3): Vec3 => vAdd(o, vScale(vSub(p, o), factor));
  return {
    vertices: solid.vertices.map(map),
    faces: solid.faces.map((f) => ({ ...f, loop: f.loop.map(map), centroid: map(f.centroid) })),
  };
}

/** 多边形是否与给定法向同向（用于挑选贴纸面）。 */
export const faceFacesOutward = (f: SolidFace): boolean => vDot(f.normal, f.normal) > 0;

/** 便捷：构造轴对齐盒子的 6 个半空间。 */
export function boxPlanes(min: Vec3, max: Vec3): Plane[] {
  return [
    plane(V(1, 0, 0), max.x),
    plane(V(-1, 0, 0), -min.x),
    plane(V(0, 1, 0), max.y),
    plane(V(0, -1, 0), -min.y),
    plane(V(0, 0, 1), max.z),
    plane(V(0, 0, -1), -min.z),
  ];
}

export { EPS, vAlmost };
