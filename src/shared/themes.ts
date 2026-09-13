/**
 * 配色方案：普通配色 / 马卡龙配色 / 自定义配色。
 * 颜色用十六进制字符串表示，渲染层负责解析。
 *
 * 朝向采用「黄顶蓝前红右」，也就是国际标准配色（白顶绿前红右）
 * **整体翻转 180°** 的结果：两者其实是同一个魔方换个拿法，手性完全一致
 * （红仍在橙对面、蓝的右边仍是红）。之所以选黄顶，是因为人们平时复原魔方
 * 习惯让黄面朝上，玩家打开就看到和手里实物相同的朝向，不用在脑子里倒过来
 * 换算。
 *
 * 注意 U/D 与 F/B 必须**成对**翻转：只换上下会把魔方变成镜像（左右手性
 * 反掉），转动的顺/逆时针看上去就全反了。想做「黄顶绿前」（红橙互换）则是
 * 另一套翻法（U↔D 且 L↔R，F 保持绿），按需改即可。
 */

import { ColorKey } from './puzzle/types';

export type FaceColorKey = 'U' | 'D' | 'F' | 'B' | 'L' | 'R';

export interface Theme {
  id: string;
  name: string;
  /** 六个面的颜色。 */
  face: Record<FaceColorKey, string>;
  /** 魔方本体（塑料）颜色。 */
  body: string;
  /** 镜面魔方的金属色。 */
  mirror: string;
  /** 背景色。 */
  background: string;
}

export const FACE_COLOR_KEYS: FaceColorKey[] = ['U', 'D', 'F', 'B', 'L', 'R'];

export const FACE_COLOR_LABELS: Record<FaceColorKey, string> = {
  U: '上',
  D: '下',
  F: '前',
  B: '后',
  L: '左',
  R: '右',
};

export const STANDARD_THEME: Theme = {
  id: 'standard',
  name: '普通配色',
  face: {
    U: '#ffd400',
    D: '#f4f6fa',
    F: '#0046ad',
    B: '#009b48',
    R: '#c41e3a',
    L: '#ff5800',
  },
  body: '#15171c',
  mirror: '#e0bd68',
  background: '#0d1117',
};

export const MACARON_THEME: Theme = {
  id: 'macaron',
  name: '马卡龙配色',
  face: {
    U: '#fbe38e',
    D: '#faf6ee',
    F: '#a3c4e8',
    B: '#a8d8b9',
    R: '#f2a1a8',
    L: '#f6c39b',
  },
  body: '#2c2833',
  mirror: '#f0d9b5',
  background: '#1b1a24',
};

export const CUSTOM_THEME_ID = 'custom';

export function makeCustomTheme(base?: Partial<Theme>): Theme {
  return {
    id: CUSTOM_THEME_ID,
    name: '自定义配色',
    face: { ...STANDARD_THEME.face, ...(base?.face ?? {}) },
    body: base?.body ?? STANDARD_THEME.body,
    mirror: base?.mirror ?? STANDARD_THEME.mirror,
    background: base?.background ?? STANDARD_THEME.background,
  };
}

export function builtinThemes(): Theme[] {
  return [STANDARD_THEME, MACARON_THEME, makeCustomTheme()];
}

/** 把颜色键解析成实际色值。 */
export function colorOf(theme: Theme, key: ColorKey): string {
  if (key === 'body' || key === 'inner') return theme.body;
  if (key === 'mirror') return theme.mirror;
  return theme.face[key as FaceColorKey] ?? theme.body;
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
