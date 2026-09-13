/**
 * 仅供离线校验用的软件光栅器：透视投影 + Z-Buffer + 兰伯特光照。
 * 它和游戏内 Canvas 渲染器共享同一份世界坐标几何，用来肉眼确认外形与配色。
 */

const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

export function cameraBasis({ yaw, pitch, distance, target = [0, 0, 0] }) {
  const cp = Math.cos(pitch);
  const dir = [cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw)];
  const eye = [target[0] + dir[0] * distance, target[1] + dir[1] * distance, target[2] + dir[2] * distance];
  const zc = V.norm(dir);
  const xc = V.norm(V.cross([0, 1, 0], zc));
  const yc = V.cross(zc, xc);
  return { eye, xc, yc, zc };
}

export function createScene(width, height, background = [13, 17, 23, 255]) {
  const color = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    color[i * 4] = background[0];
    color[i * 4 + 1] = background[1];
    color[i * 4 + 2] = background[2];
    color[i * 4 + 3] = background[3];
  }
  const depth = new Float32Array(width * height);
  return { width, height, color, depth };
}

const LIGHT = V.norm([0.45, 0.8, 0.55]);

/**
 * faces: [{ points: [[x,y,z]...], color: [r,g,b], unlit?: boolean }]
 * viewport: { x, y, w, h }
 */
export function renderFaces(scene, faces, camera, viewport) {
  const vp = viewport ?? { x: 0, y: 0, w: scene.width, h: scene.height };
  const focal = vp.h / 2 / Math.tan(camera.fov / 2);
  const cx = vp.x + vp.w / 2;
  const cy = vp.y + vp.h / 2;
  const { eye, xc, yc, zc } = cameraBasis(camera);

  const project = (p) => {
    const v = V.sub(p, eye);
    const vz = V.dot(v, zc);
    if (vz > -1e-6) return null;
    const depth = -vz;
    return [cx + (V.dot(v, xc) * focal) / depth, cy - (V.dot(v, yc) * focal) / depth, depth];
  };

  // 由远到近绘制，配合 Z-Buffer 双保险
  const prepared = [];
  for (const face of faces) {
    const n = V.norm(
      V.cross(V.sub(face.points[1], face.points[0]), V.sub(face.points[2], face.points[0])),
    );
    const centroid = face.points.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => v / face.points.length);
    const toEye = V.sub(eye, centroid);
    if (V.dot(n, toEye) <= 0) continue; // 背面剔除
    const pts = [];
    let ok = true;
    for (const p of face.points) {
      const s = project(p);
      if (!s) {
        ok = false;
        break;
      }
      pts.push(s);
    }
    if (!ok) continue;
    const lambert = face.unlit ? 1 : 0.42 + 0.62 * Math.max(0, V.dot(n, LIGHT));
    prepared.push({ pts, color: face.color, lambert, depth: pts.reduce((a, s) => a + s[2], 0) / pts.length });
  }
  prepared.sort((a, b) => b.depth - a.depth);

  const put = (x, y, r, g, b, invDepth) => {
    if (x < vp.x || y < vp.y || x >= vp.x + vp.w || y >= vp.y + vp.h) return;
    const idx = y * scene.width + x;
    if (invDepth <= scene.depth[idx]) return;
    scene.depth[idx] = invDepth;
    scene.color[idx * 4] = r;
    scene.color[idx * 4 + 1] = g;
    scene.color[idx * 4 + 2] = b;
    scene.color[idx * 4 + 3] = 255;
  };

  for (const item of prepared) {
    const r = Math.min(255, Math.round(item.color[0] * item.lambert));
    const g = Math.min(255, Math.round(item.color[1] * item.lambert));
    const b = Math.min(255, Math.round(item.color[2] * item.lambert));
    const pts = item.pts;
    for (let i = 1; i + 1 < pts.length; i++) {
      rasterTri(put, pts[0], pts[i], pts[i + 1], r, g, b);
    }
  }
}

function rasterTri(put, a, b, c, r, g, bl) {
  const minX = Math.floor(Math.min(a[0], b[0], c[0]));
  const maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
  const minY = Math.floor(Math.min(a[1], b[1], c[1]));
  const maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
  const area2 = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(area2) < 1e-9) return;
  const ia = 1 / a[2];
  const ib = 1 / b[2];
  const ic = 1 / c[2];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const wa = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area2;
      if (wa < -1e-6) continue;
      const wb = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area2;
      if (wb < -1e-6) continue;
      const wc = 1 - wa - wb;
      if (wc < -1e-6) continue;
      put(x, y, r, g, bl, wa * ia + wb * ib + wc * ic);
    }
  }
}
