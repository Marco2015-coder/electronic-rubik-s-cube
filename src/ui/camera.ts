/**
 * 轨道相机：球坐标 + 惯性阻尼 + 透视投影 + 屏幕射线（用于拾取）。
 */

import { Mat3, Vec3, V, mApply, mTranspose, vAdd, vCross, vNorm, vScale } from '../shared/math';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}

export class OrbitCamera {
  yaw = 0.62;
  pitch = 0.44;
  distance = 4.6;
  target: Vec3 = V(0, 0, 0);
  fov = 0.52;

  /** 惯性角速度。 */
  private yawVel = 0;
  private pitchVel = 0;

  /** 最近一次渲染的视口尺寸，供拾取使用。 */
  viewWidth = 1;
  viewHeight = 1;

  private eye: Vec3 = V(0, 0, 1);
  private xc: Vec3 = V(1, 0, 0);
  private yc: Vec3 = V(0, 1, 0);
  private zc: Vec3 = V(0, 0, 1);
  private focal = 1;

  setViewport(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.focal = height / 2 / Math.tan(this.fov / 2);
  }

  updateBasis(): void {
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    const cp = Math.cos(this.pitch);
    const dir = V(cp * Math.sin(this.yaw), Math.sin(this.pitch), cp * Math.cos(this.yaw));
    this.eye = vAdd(this.target, vScale(dir, this.distance));
    this.zc = vNorm(dir);
    this.xc = vNorm(vCross(V(0, 1, 0), this.zc));
    this.yc = vCross(this.zc, this.xc);
  }

  /** 拖动旋转（dx/dy 为像素位移）。 */
  orbit(dx: number, dy: number): void {
    const k = 0.0072;
    this.yaw -= dx * k;
    this.pitch += dy * k;
    this.yawVel = -dx * k * 0.35;
    this.pitchVel = dy * k * 0.35;
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    this.updateBasis();
  }

  zoom(delta: number): void {
    this.distance = clamp(this.distance * Math.exp(delta * 0.0011), this.minDistance(), 60);
    this.updateBasis();
  }

  minDistance(): number {
    return 1.6;
  }

  /** 每帧调用，处理惯性；返回是否仍在运动。 */
  step(dt: number): boolean {
    const friction = Math.exp(-dt * 4.2);
    if (Math.abs(this.yawVel) < 1e-4 && Math.abs(this.pitchVel) < 1e-4) return false;
    this.yaw += this.yawVel * dt * 60 * 0.5;
    this.pitch = clamp(this.pitch + this.pitchVel * dt * 60 * 0.5, -1.45, 1.45);
    this.yawVel *= friction;
    this.pitchVel *= friction;
    this.updateBasis();
    return true;
  }

  project(p: Vec3): ScreenPoint | null {
    const v = { x: p.x - this.eye.x, y: p.y - this.eye.y, z: p.z - this.eye.z };
    const vz = v.x * this.zc.x + v.y * this.zc.y + v.z * this.zc.z;
    if (vz > -1e-4) return null;
    const depth = -vz;
    const vx = v.x * this.xc.x + v.y * this.xc.y + v.z * this.xc.z;
    const vy = v.x * this.yc.x + v.y * this.yc.y + v.z * this.yc.z;
    return {
      x: this.viewWidth / 2 + (vx * this.focal) / depth,
      y: this.viewHeight / 2 - (vy * this.focal) / depth,
      depth,
    };
  }

  /** 屏幕坐标 → 世界空间射线。 */
  ray(px: number, py: number): { origin: Vec3; dir: Vec3 } {
    const sx = (px - this.viewWidth / 2) / this.focal;
    const sy = -(py - this.viewHeight / 2) / this.focal;
    const dir = vNorm(
      vAdd(vAdd(vScale(this.xc, sx), vScale(this.yc, sy)), this.zc),
    );
    return { origin: this.eye, dir };
  }

  /** 视空间方向 → 屏幕上的二维方向（用于拖动判定）。 */
  screenDirection(worldPoint: Vec3, worldDirection: Vec3): { x: number; y: number } | null {
    const p = this.project(worldPoint);
    const q = this.project(vAdd(worldPoint, worldDirection));
    if (!p || !q) return null;
    return { x: q.x - p.x, y: q.y - p.y };
  }

  get basisX(): Vec3 {
    return this.xc;
  }
  get basisY(): Vec3 {
    return this.yc;
  }
  get basisZ(): Vec3 {
    return this.zc;
  }
  get eyePosition(): Vec3 {
    return this.eye;
  }

  /** 让整机在屏幕上的可见范围匹配魔方尺寸。 */
  frame(radius: number): void {
    this.distance = clamp(radius * 2.75, this.minDistance(), 60);
    this.target = V(0, 0, 0);
    this.updateBasis();
  }
}

/** 求旋转矩阵的逆（正交矩阵取转置）。 */
export function invertRotation(m: Mat3): Mat3 {
  return mTranspose(m);
}

export { mApply };
