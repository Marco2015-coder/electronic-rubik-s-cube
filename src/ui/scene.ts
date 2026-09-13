/**
 * Canvas 2D 三维渲染器 + 射线拾取。
 *
 * 魔方是「分离的凸块」组合，采用背面剔除 + 按深度排序（画家算法）绘制，
 * 既快又能得到干净的抗锯齿边缘，比自建像素级 Z-Buffer 更适合这种场景。
 */

import { Mat3, Vec3, V, mApply, mRotate, vAdd, vCross, vDot, vNorm, vScale, vSub } from '../shared/math';
import { HitInfo, Piece, Puzzle, localToWorld } from '../shared/puzzle/types';
import { Theme, colorOf } from '../shared/themes';
import { OrbitCamera } from './camera';

export interface RenderOverride {
  axis: Vec3;
  angle: number;
  ids: Set<number>;
}

const LIGHT = vNorm(V(0.4, 0.82, 0.52));

interface PreparedFace {
  pts: { x: number; y: number }[];
  depth: number;
  fill: string;
  inset: string | null;
  stroke: string | null;
}

// ---------------------------------------------------------------------------
// 颜色
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  return Number.isNaN(n) ? [255, 255, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(rgb: [number, number, number], k: number): string {
  const r = Math.max(0, Math.min(255, Math.round(rgb[0] * k)));
  const g = Math.max(0, Math.min(255, Math.round(rgb[1] * k)));
  const b = Math.max(0, Math.min(255, Math.round(rgb[2] * k)));
  return `rgb(${r},${g},${b})`;
}

class ColorCache {
  private map = new Map<string, [number, number, number]>();

  rgb(key: string): [number, number, number] {
    let v = this.map.get(key);
    if (!v) {
      v = parseHex(key);
      this.map.set(key, v);
    }
    return v;
  }
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

export class CubeRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private colors = new ColorCache();
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('无法创建 2D 画布上下文');
    this.ctx = ctx;
  }

  /** 按设备像素比调整画布尺寸，返回 CSS 像素尺寸。 */
  resize(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pw = Math.round(width * this.dpr);
    const ph = Math.round(height * this.dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    return { width, height };
  }

  render(puzzle: Puzzle, theme: Theme, camera: OrbitCamera, override?: RenderOverride): void {
    const { width, height } = this.resize();
    const ctx = this.ctx;
    const dpr = this.dpr;

    camera.setViewport(width, height);
    camera.updateBasis();

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, height * dpr);
    bg.addColorStop(0, shadeColor(theme.background, 1.35));
    bg.addColorStop(0.55, theme.background);
    bg.addColorStop(1, shadeColor(theme.background, 0.62));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width * dpr, height * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const rot: Mat3 | null = override && override.angle !== 0 ? mRotate(override.axis, override.angle) : null;
    const eye = camera.eyePosition;

    const bodyRgb = this.colors.rgb(theme.body);

    // 按「块」分组：块之间互不穿插，用整块的最近深度排序即可得到正确遮挡，
    // 避免逐面平均深度在斜视时把远处方块画到近处方块之上。
    const groups: { depth: number; faces: PreparedFace[] }[] = [];

    for (const piece of puzzle.pieces) {
      const spinning = rot !== null && override!.ids.has(piece.id);
      const toWorld = (p: Vec3): Vec3 => {
        const w = localToWorld(piece, p);
        return spinning && rot ? mApply(rot, w) : w;
      };

      const group: { depth: number; faces: PreparedFace[] } = { depth: Number.POSITIVE_INFINITY, faces: [] };

      for (let fi = 0; fi < piece.solid.faces.length; fi++) {
        const face = piece.solid.faces[fi];
        const loop = face.loop;
        const a = toWorld(loop[0]);
        const b = toWorld(loop[1]);
        const c = toWorld(loop[2]);
        const normal = vNorm(vCross(vSub(b, a), vSub(c, a)));
        const center = toWorld(face.centroid);

        // 背面剔除
        if (vDot(normal, vSub(eye, center)) <= 0) continue;

        const pts: { x: number; y: number }[] = [];
        let near = Number.POSITIVE_INFINITY;
        let ok = true;
        for (const lp of loop) {
          const s = camera.project(toWorld(lp));
          if (!s) {
            ok = false;
            break;
          }
          pts.push({ x: s.x, y: s.y });
          if (s.depth < near) near = s.depth;
        }
        if (!ok || pts.length < 3) continue;
        if (near < group.depth) group.depth = near;

        const key = piece.faceColors[fi];
        const lambert = 0.44 + 0.66 * Math.max(0, vDot(normal, LIGHT));
        const isSticker = key !== 'body' && key !== 'inner';
        const baseRgb = isSticker ? this.colors.rgb(colorOf(theme, key)) : bodyRgb;

        group.faces.push({
          pts,
          depth: near,
          fill: shade(baseRgb, isSticker ? lambert : lambert * 0.82),
          inset: isSticker ? shade(baseRgb, lambert * 1.06) : null,
          stroke: isSticker ? shade(baseRgb, lambert * 0.55) : null,
        });
      }

      if (group.faces.length > 0) groups.push(group);
    }

    groups.sort((p, q) => q.depth - p.depth);

    const prepared: PreparedFace[] = [];
    for (const g of groups) prepared.push(...g.faces);

    const insetScale = puzzle.id.includes('mirror') ? 0.965 : 0.9;
    for (const f of prepared) {
      path(ctx, f.pts);
      ctx.fillStyle = f.fill;
      ctx.fill();

      if (f.inset) {
        const c = centroid(f.pts);
        path(
          ctx,
          f.pts.map((p) => ({ x: c.x + (p.x - c.x) * insetScale, y: c.y + (p.y - c.y) * insetScale })),
        );
        ctx.fillStyle = f.inset;
        ctx.fill();
        if (theme.id === 'macaron' || puzzle.id.includes('mirror')) {
          ctx.strokeStyle = 'rgba(0,0,0,0.14)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }
}

function shadeColor(hex: string, k: number): string {
  return shade(parseHex(hex), k);
}

function path(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

// ---------------------------------------------------------------------------
// 拾取
// ---------------------------------------------------------------------------

interface BoundingSphere {
  center: Vec3;
  radius: number;
}

export function computeBoundingSpheres(pieces: Piece[]): BoundingSphere[] {
  return pieces.map((piece) => {
    let r = 0;
    for (const v of piece.solid.vertices) r = Math.max(r, Math.hypot(v.x - piece.home.x, v.y - piece.home.y, v.z - piece.home.z));
    return { center: piece.home, radius: Math.max(r, 1e-3) };
  });
}

export function puzzleRadius(puzzle: Puzzle): number {
  let r = 0;
  for (const p of puzzle.pieces) {
    for (const v of p.solid.vertices) r = Math.max(r, Math.hypot(v.x, v.y, v.z));
  }
  return Math.max(r, 0.6);
}

/** 射线拾取：返回最近命中的面。 */
export function pick(
  puzzle: Puzzle,
  camera: OrbitCamera,
  spheres: BoundingSphere[],
  px: number,
  py: number,
  override?: RenderOverride,
): HitInfo | null {
  const { origin, dir } = camera.ray(px, py);
  const rot: Mat3 | null = override && override.angle !== 0 ? mRotate(override.axis, override.angle) : null;

  let best: HitInfo | null = null;
  let bestT = Number.POSITIVE_INFINITY;

  for (const piece of puzzle.pieces) {
    const spinning = rot !== null && override!.ids.has(piece.id);
    const toWorld = (p: Vec3): Vec3 => {
      const w = localToWorld(piece, p);
      return spinning && rot ? mApply(rot, w) : w;
    };

    const sp = spheres[piece.id];
    const center = spinning && rot ? mApply(rot, piece.pos) : piece.pos;
    const sphereT = raySphere(origin, dir, center, sp.radius);
    if (sphereT === null || sphereT > bestT) continue;

    for (const face of piece.solid.faces) {
      const loop = face.loop;
      const a = toWorld(loop[0]);
      for (let i = 1; i + 1 < loop.length; i++) {
        const t = rayTriangle(origin, dir, a, toWorld(loop[i]), toWorld(loop[i + 1]));
        if (t !== null && t > 1e-4 && t < bestT) {
          bestT = t;
          const b = toWorld(loop[1]);
          const c = toWorld(loop[2]);
          best = {
            pieceId: piece.id,
            normal: vNorm(vCross(vSub(b, a), vSub(c, a))),
            point: vAdd(origin, vScale(dir, t)),
          };
        }
      }
    }
  }
  return best;
}

function raySphere(origin: Vec3, dir: Vec3, center: Vec3, radius: number): number | null {
  const oc = vSub(origin, center);
  const b = vDot(oc, dir);
  const c = vDot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = -b - sq;
  const t2 = -b + sq;
  if (t2 < 0) return null;
  return t1 > 0 ? t1 : 0;
}

function rayTriangle(origin: Vec3, dir: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1 = vSub(b, a);
  const e2 = vSub(c, a);
  const p = vCross(dir, e2);
  const det = vDot(e1, p);
  if (Math.abs(det) < 1e-9) return null;
  const inv = 1 / det;
  const t = vSub(origin, a);
  const u = vDot(t, p) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q = vCross(t, e1);
  const v = vDot(dir, q) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  return vDot(e2, q) * inv;
}
