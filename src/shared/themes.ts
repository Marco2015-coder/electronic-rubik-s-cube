/**
 * 配色方案：普通配色 / 马卡龙配色 / 自定义配色。
 * 颜色用十六进制字符串表示，渲染层负责解析。
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
    U: '#f4f6fa',
    D: '#ffd400',
    F: '#009b48',
    B: '#0046ad',
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
    U: '#faf6ee',
    D: '#fbe38e',
    F: '#a8d8b9',
    B: '#a3c4e8',
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
