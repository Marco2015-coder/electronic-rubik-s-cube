/**
 * 离线校验：把魔方渲染成 PNG，用来确认外形、配色、块结构是否正确。
 *   node scripts/preview.mjs [--only=cube3,cube4-mirror] [--out=preview-out] [--cols=4]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';
import { createScene, renderFaces } from './raster.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'shared');

const { createCubicPuzzle } = require(path.join(dist, 'puzzle', 'cubic.js'));
const { localToWorld } = require(path.join(dist, 'puzzle', 'types.js'));
const { STANDARD_THEME, MACARON_THEME, colorOf, hexToRgb } = require(path.join(dist, 'themes.js'));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2] || true] : [a, true];
  }),
);

const PUZZLES = [
  { id: 'cube2', name: '普通2阶', make: () => createCubicPuzzle({ size: 2, style: 'standard' }) },
  { id: 'cube2-mirror', name: '镜面2阶', make: () => createCubicPuzzle({ size: 2, style: 'mirror' }) },
  { id: 'cube3', name: '普通3阶', make: () => createCubicPuzzle({ size: 3, style: 'standard' }) },
  { id: 'cube3-mirror', name: '镜面3阶', make: () => createCubicPuzzle({ size: 3, style: 'mirror' }) },
  { id: 'cube4', name: '普通4阶', make: () => createCubicPuzzle({ size: 4, style: 'standard' }) },
  { id: 'cube4-mirror', name: '镜面4阶', make: () => createCubicPuzzle({ size: 4, style: 'mirror' }) },
  { id: 'cube5', name: '普通5阶', make: () => createCubicPuzzle({ size: 5, style: 'standard' }) },
  { id: 'cube5-mirror', name: '镜面5阶', make: () => createCubicPuzzle({ size: 5, style: 'mirror' }) },
];

function collectFaces(puzzle, theme) {
  const out = [];
  for (const piece of puzzle.pieces) {
    piece.solid.faces.forEach((face, i) => {
      const key = piece.faceColors[i];
      const rgb = hexToRgb(colorOf(theme, key));
      out.push({
        points: face.loop.map((p) => {
          const w = localToWorld(piece, p);
          return [w.x, w.y, w.z];
        }),
        color: rgb,
      });
    });
  }
  return out;
}

function bounds(faces) {
  let r = 0;
  for (const f of faces) {
    for (const p of f.points) r = Math.max(r, Math.hypot(p[0], p[1], p[2]));
  }
  return r;
}

function hexToRgba(hex) {
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b, 255];
}

const only = args.only ? String(args.only).split(',') : null;
const list = only ? PUZZLES.filter((p) => only.includes(p.id)) : PUZZLES;
const cols = Number(args.cols ?? 4);
const themeId = args.theme ?? 'standard';
const theme = themeId === 'macaron' ? MACARON_THEME : STANDARD_THEME;
const tile = Number(args.tile ?? 380);

const rows = Math.ceil(list.length / cols);
const width = cols * tile;
const height = rows * tile;
const scene = createScene(width, height, hexToRgba(theme.background));

list.forEach((entry, index) => {
  const puzzle = entry.make();
  if (args.scramble) puzzle.scramble();
  const faces = collectFaces(puzzle, theme);
  const r = bounds(faces);
  const viewport = {
    x: (index % cols) * tile,
    y: Math.floor(index / cols) * tile,
    w: tile,
    h: tile,
  };
  renderFaces(
    scene,
    faces,
    {
      yaw: Number(args.yaw ?? 0.62),
      pitch: Number(args.pitch ?? 0.46),
      distance: r * 2.85,
      fov: 0.52,
    },
    viewport,
  );
  console.log(`渲染 ${entry.name}（${entry.id}）：${puzzle.pieces.length} 块 / ${faces.length} 面`);
});

const outDir = path.resolve(root, String(args.out ?? 'preview-out'));
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${args.name ?? 'sheet'}.png`);
fs.writeFileSync(file, encodePNG(width, height, scene.color));
console.log(`已生成 ${file}（${width}x${height}）`);
