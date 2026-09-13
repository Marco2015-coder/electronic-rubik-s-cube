/**
 * 魔方模型自测：验证转动方向、还原判定、撤销、打乱的正确性。
 *   node scripts/selftest.mjs
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'shared');
const { createCubicPuzzle } = require(path.join(dist, 'puzzle', 'cubic.js'));
const { localToWorld, applyRotationToPiece } = require(path.join(dist, 'puzzle', 'types.js'));

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

/** 从某个面的最外层开始转 width 层。 */
function mv(puzzle, face, width = 1, turns = 1) {
  const n = puzzle.size;
  const plus = face === 'R' || face === 'U' || face === 'F';
  const layers = plus ? [n - width, n - 1] : [0, width - 1];
  return puzzle.buildMove(face, layers, turns);
}

const inverse = (m) => ({ axis: m.axis, angle: -m.angle, label: `inv(${m.label})`, pieceIds: m.pieceIds });

for (const size of [2, 3, 4, 5]) {
  for (const style of ['standard', 'mirror']) {
    const tag = `${size}阶/${style}`;
    const puzzle = createCubicPuzzle({ size, style });

    check(`${tag} 初始已还原`, puzzle.isSolved());

    // 单面转 4 次回到原位
    for (let i = 0; i < 4; i++) puzzle.apply(mv(puzzle, 'R'));
    check(`${tag} R×4 复原`, puzzle.isSolved());

    // 顺逆互逆：R 之后 R' 必须复原（不能和 R 同向）
    puzzle.apply(mv(puzzle, 'R', 1, 1));
    puzzle.apply(mv(puzzle, 'R', 1, -1));
    check(`${tag} R 与 R' 互逆`, puzzle.isSolved());

    puzzle.apply(mv(puzzle, 'F', 1, 1));
    puzzle.apply(mv(puzzle, 'F', 1, 1));
    puzzle.apply(mv(puzzle, 'F', 1, -2));
    check(`${tag} F2 与 F'2 互逆`, puzzle.isSolved());

    // U2 不应等于复原（2 阶以上）
    const p2 = createCubicPuzzle({ size, style });
    p2.apply(mv(p2, 'U', 1, 2));
    check(`${tag} U2 不等于复原`, !p2.isSolved());

    // 撤销
    puzzle.reset();
    puzzle.apply(mv(puzzle, 'F'));
    puzzle.apply(mv(puzzle, 'L'));
    puzzle.apply(mv(puzzle, 'D', 1, -1));
    check(`${tag} 走三步后未还原`, !puzzle.isSolved());
    puzzle.undo();
    puzzle.undo();
    puzzle.undo();
    check(`${tag} 撤销回到已还原`, puzzle.isSolved());

    // 打乱：从已还原开始、清空历史、逆序执行可复原
    puzzle.apply(mv(puzzle, 'F'));
    const seq = puzzle.scramble();
    check(`${tag} 打乱后未还原`, !puzzle.isSolved());
    check(`${tag} 打乱清空了历史`, puzzle.history.length === 0, `实际 ${puzzle.history.length}`);
    check(`${tag} 打乱后无历史可撤销`, puzzle.undo() === null);
    check(`${tag} 打乱后无块重叠`, countOverlap(puzzle) === 0, `重叠 ${countOverlap(puzzle)} 对`);

    // 界面播放打乱动画的路径：回到还原态，再按原顺序静默重放同一串转动。
    // 必须复现出同一打乱状态，且不能污染撤销历史、不能产生重叠。
    const scrambledKey = poseKey(puzzle);
    puzzle.reset();
    for (const m of seq) puzzle.applySilent(m);
    check(`${tag} 重放打乱序列复现同一状态`, poseKey(puzzle) === scrambledKey);
    check(`${tag} 重放打乱序列无块重叠`, countOverlap(puzzle) === 0, `重叠 ${countOverlap(puzzle)} 对`);
    check(`${tag} 重放打乱序列不写入历史`, puzzle.history.length === 0, `实际 ${puzzle.history.length}`);

    for (let i = seq.length - 1; i >= 0; i--) puzzle.apply(inverse(seq[i]));
    check(`${tag} 逆序执行打乱序列可复原`, puzzle.isSolved());

    // 贴纸必须始终贴在立方体表面，且每面贴纸数保持 6N²
    puzzle.reset();
    puzzle.scramble();
    let onSurface = true;
    const counts = {};
    for (const piece of puzzle.pieces) {
      for (const st of piece.stickers) {
        const w = localToWorld(piece, st.centroid);
        const m = Math.max(Math.abs(w.x), Math.abs(w.y), Math.abs(w.z));
        if (Math.abs(m - 1) > 0.02) onSurface = false;
        const key = dominantFace(w);
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    check(`${tag} 打乱后所有贴纸仍在表面`, onSurface);
    const expected = 6 * size * size;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    check(`${tag} 贴纸总数 = 6N² = ${expected}`, total === expected, `实际 ${total}`);
  }
}

// 转动方向：3 阶角块位移
{
  const puzzle = createCubicPuzzle({ size: 3, style: 'standard' });
  const ufr = puzzle.pieces.find((p) => p.home.x > 0 && p.home.y > 0 && p.home.z > 0);
  check('存在 UFR 角块', !!ufr);

  puzzle.apply(mv(puzzle, 'R'));
  check(
    'R 把 UFR 转到 URB（前→上）',
    ufr.pos.x > 0.1 && ufr.pos.y > 0.1 && ufr.pos.z < -0.1,
    JSON.stringify(ufr.pos),
  );
  puzzle.undo();

  puzzle.apply(mv(puzzle, 'U'));
  check(
    'U 把 UFR 转到 UFL（前→左）',
    ufr.pos.x < -0.1 && ufr.pos.y > 0.1 && ufr.pos.z > 0.1,
    JSON.stringify(ufr.pos),
  );
  puzzle.undo();

  puzzle.apply(mv(puzzle, 'F'));
  check(
    'F 把 UFR 转到 DFR（上→右）',
    ufr.pos.x > 0.1 && ufr.pos.y < -0.1 && ufr.pos.z > 0.1,
    JSON.stringify(ufr.pos),
  );
  puzzle.undo();
}

// 层数与记号
{
  const p3 = createCubicPuzzle({ size: 3, style: 'standard' });
  check('3 阶 R 覆盖 9 块', mv(p3, 'R').pieceIds.length === 9);
  check('3 阶 U 覆盖 9 块', mv(p3, 'U').pieceIds.length === 9);
  check('3 阶 Rw 覆盖 17 块', mv(p3, 'R', 2).pieceIds.length === 17, `实际 ${mv(p3, 'R', 2).pieceIds.length}`);
  check('3 阶 Rw 记号', mv(p3, 'R', 2).label === 'Rw', mv(p3, 'R', 2).label);

  const p4 = createCubicPuzzle({ size: 4, style: 'standard' });
  check('4 阶 R 覆盖 16 块', mv(p4, 'R').pieceIds.length === 16);
  check('4 阶 Rw 覆盖 28 块', mv(p4, 'R', 2).pieceIds.length === 28, `实际 ${mv(p4, 'R', 2).pieceIds.length}`);

  const p5 = createCubicPuzzle({ size: 5, style: 'standard' });
  check('5 阶 R 覆盖 25 块', mv(p5, 'R').pieceIds.length === 25, `实际 ${mv(p5, 'R').pieceIds.length}`);
  check('5 阶 Rw 覆盖 41 块', mv(p5, 'R', 2).pieceIds.length === 41, `实际 ${mv(p5, 'R', 2).pieceIds.length}`);
}

// 点击拾取 → 转动
{
  const p5 = createCubicPuzzle({ size: 5, style: 'standard' });
  const at = (x, y, z) =>
    p5.pieces.find(
      (p) => Math.abs(p.home.x - x) < 0.05 && Math.abs(p.home.y - y) < 0.05 && Math.abs(p.home.z - z) < 0.05,
    );
  const upNormal = { x: 0, y: 1, z: 0 };
  const hit = (piece, wide) => p5.moveFromHit({ pieceId: piece.id, normal: upNormal, point: piece.home }, { wide });

  const outer = at(0.8, 0.8, 0.8);
  const m1 = hit(outer, false);
  check('5 阶顶面最外层单击 → U', m1?.label === 'U', m1?.label);
  const m2 = hit(outer, true);
  check('5 阶顶面最外层长按 → Uw', m2?.label === 'Uw', m2?.label);

  const second = at(0.8, 0.4, 0.8);
  const m3 = hit(second, false);
  check('5 阶顶面第二层单击 → 2U', m3?.label === '2U', m3?.label);
  const m4 = hit(second, true);
  check('5 阶顶面第二层长按 → Uw', m4?.label === 'Uw', m4?.label);
  check('2U 只覆盖 16 块（单层）', m3?.pieceIds.length === 16, `实际 ${m3?.pieceIds.length}`);
  check('2U 与 U2 不同（单层 vs 两层）', m3?.pieceIds.length !== m2?.pieceIds.length);
}

/** 块在世界空间的轴对齐包围盒（所有转动都是 90° 倍数，块始终轴对齐）。 */
function aabb(piece) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const v of piece.solid.vertices) {
    const w = localToWorld(piece, v);
    if (w.x < min.x) min.x = w.x;
    if (w.y < min.y) min.y = w.y;
    if (w.z < min.z) min.z = w.z;
    if (w.x > max.x) max.x = w.x;
    if (w.y > max.y) max.y = w.y;
    if (w.z > max.z) max.z = w.z;
  }
  return { min, max };
}

/** 统计互相侵占体积的块对数：>0 说明两块被拧到了同一格（视觉重叠）。 */
function countOverlap(puzzle) {
  const boxes = puzzle.pieces.map(aabb);
  let bad = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
      const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
      const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
      if (ox > 0.01 && oy > 0.01 && oz > 0.01) bad++;
    }
  }
  return bad;
}

/** 所有块的位置快照，用于比较两个状态是否一致。 */
function poseKey(puzzle) {
  return puzzle.pieces
    .map((p) => `${p.pos.x.toFixed(6)},${p.pos.y.toFixed(6)},${p.pos.z.toFixed(6)}`)
    .join('|');
}

function dominantFace(w) {
  const ax = Math.abs(w.x);
  const ay = Math.abs(w.y);
  const az = Math.abs(w.z);
  if (ax >= ay && ax >= az) return w.x > 0 ? 'R' : 'L';
  if (ay >= az) return w.y > 0 ? 'U' : 'D';
  return w.z > 0 ? 'F' : 'B';
}

// 镜面魔方：对称切分必然产生「正方体块」，其朝向在外观上不可见
{
  const p = createCubicPuzzle({ size: 3, style: 'mirror' });
  const cubeShaped = (pc) => {
    const b = aabb(pc);
    const dx = b.max.x - b.min.x;
    const dy = b.max.y - b.min.y;
    const dz = b.max.z - b.min.z;
    const avg = (dx + dy + dz) / 3;
    return Math.abs(dx - avg) < 1e-4 && Math.abs(dy - avg) < 1e-4 && Math.abs(dz - avg) < 1e-4;
  };
  const cubePiece = p.pieces.find(cubeShaped);
  check('3阶镜面确实存在正方体块', !!cubePiece);
  if (cubePiece) {
    // 绕体对角线转 120°：位置不变、外形不变，只有内部朝向矩阵变了
    const k = 1 / Math.sqrt(3);
    applyRotationToPiece(cubePiece, { x: k, y: k, z: k }, (2 * Math.PI) / 3);
    check('正方体块转 120° 后仍判定为已复原', p.isSolved());
    check('正方体块位置未被改变', Math.hypot(
      cubePiece.pos.x - cubePiece.home.x,
      cubePiece.pos.y - cubePiece.home.y,
      cubePiece.pos.z - cubePiece.home.z,
    ) < 1e-4);
  }
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
