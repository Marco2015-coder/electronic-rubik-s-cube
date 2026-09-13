/**
 * 魔方清单：界面上可选的 13 种魔方。
 */

import { Puzzle } from '../shared/puzzle/types';
import { createCubicPuzzle } from '../shared/puzzle/cubic';

export interface PuzzleDef {
  id: string;
  name: string;
  group: string;
  badge: string;
  desc: string;
  /** 未实现的先占位显示。 */
  create: (() => Puzzle) | null;
}

const cube = (size: number, style: 'standard' | 'mirror') => () =>
  createCubicPuzzle({ size, style });

export const PUZZLE_DEFS: PuzzleDef[] = [
  {
    id: 'cube2',
    name: '普通二阶魔方',
    group: '正阶魔方',
    badge: '2×2',
    desc: '只有 8 个角块，入门首选。',
    create: cube(2, 'standard'),
  },
  {
    id: 'cube2-mirror',
    name: '镜面二阶魔方',
    group: '正阶魔方',
    badge: '2×2 · 镜面',
    desc: '没有颜色，靠块的大小辨认位置。',
    create: cube(2, 'mirror'),
  },
  {
    id: 'cube3',
    name: '普通三阶魔方',
    group: '正阶魔方',
    badge: '3×3',
    desc: '最经典的魔方，支持宽层转。',
    create: cube(3, 'standard'),
  },
  {
    id: 'cube3-mirror',
    name: '镜面三阶魔方',
    group: '正阶魔方',
    badge: '3×3 · 镜面',
    desc: '金色镜面块，形状即线索。',
    create: cube(3, 'mirror'),
  },
  {
    id: 'cube4',
    name: '普通四阶魔方',
    group: '正阶魔方',
    badge: '4×4',
    desc: '中心块可互换，会出现特殊情形。',
    create: cube(4, 'standard'),
  },
  {
    id: 'cube4-mirror',
    name: '镜面四阶魔方',
    group: '正阶魔方',
    badge: '4×4 · 镜面',
    desc: '镜面块 + 大量同尺寸块，难度不低。',
    create: cube(4, 'mirror'),
  },
  {
    id: 'cube5',
    name: '普通五阶魔方',
    group: '正阶魔方',
    badge: '5×5',
    desc: '支持 1～3 层转动，考验耐心。',
    create: cube(5, 'standard'),
  },
  {
    id: 'cube5-mirror',
    name: '镜面五阶魔方',
    group: '正阶魔方',
    badge: '5×5 · 镜面',
    desc: '巨量镜像块，纯形状推理。',
    create: cube(5, 'mirror'),
  },
  {
    id: 'kilominx',
    name: '二阶五魔方',
    group: '五魔方',
    badge: 'Kilominx',
    desc: '正十二面体，只有角块。',
    create: null,
  },
  {
    id: 'megaminx',
    name: '五魔方',
    group: '五魔方',
    badge: 'Megaminx',
    desc: '12 个五边形面，终极挑战。',
    create: null,
  },
  {
    id: 'pyraminx',
    name: '金字塔魔方',
    group: '异形魔方',
    badge: 'Pyraminx',
    desc: '正四面体，四个角可以单独转。',
    create: null,
  },
  {
    id: 'maple',
    name: '枫叶魔方',
    group: '异形魔方',
    badge: 'Maple',
    desc: '斜转机构，面心切成四片枫叶。',
    create: null,
  },
  {
    id: 'skewb',
    name: '斜转魔方',
    group: '异形魔方',
    badge: 'Skewb',
    desc: '绕体对角线 120° 转，8 角 6 心。',
    create: null,
  },
];

export const PUZZLE_GROUPS = ['正阶魔方', '五魔方', '异形魔方'];

export function findPuzzle(id: string): PuzzleDef | undefined {
  return PUZZLE_DEFS.find((p) => p.id === id);
}
