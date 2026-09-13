/**
 * 设置与记录：优先走 Electron 主进程持久化到用户目录，
 * 浏览器里调试时回退到 localStorage。
 */

import { FaceColorKey, Theme, STANDARD_THEME, builtinThemes, makeCustomTheme } from '../shared/themes';

export interface Settings {
  themeId: string;
  customFace: Record<FaceColorKey, string>;
  customBody: string;
  customMirror: string;
  /** 转动动画速度倍率。 */
  speed: number;
  /** 是否显示操作提示条。 */
  hints: boolean;
}

export interface CubeBridge {
  loadSettings(): Promise<Record<string, unknown>>;
  saveSettings(settings: Record<string, unknown>): Promise<boolean>;
  toggleFullscreen(): Promise<boolean>;
  platform: string;
}

declare global {
  interface Window {
    cubeBridge?: CubeBridge;
  }
}

export const defaultSettings = (): Settings => ({
  themeId: 'standard',
  customFace: { ...STANDARD_THEME.face },
  customBody: STANDARD_THEME.body,
  customMirror: STANDARD_THEME.mirror,
  speed: 1,
  hints: true,
});

const KEY = 'cube.settings.v1';

export async function loadSettings(): Promise<Settings> {
  const base = defaultSettings();
  try {
    const raw = window.cubeBridge
      ? await window.cubeBridge.loadSettings()
      : JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return merge(base, raw as Partial<Settings>);
  } catch {
    return base;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    if (window.cubeBridge) void window.cubeBridge.saveSettings(settings as unknown as Record<string, unknown>);
    else localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* 忽略 */
  }
}

function merge(base: Settings, patch: Partial<Settings>): Settings {
  return {
    ...base,
    ...patch,
    customFace: { ...base.customFace, ...(patch.customFace ?? {}) },
  };
}

export function resolveTheme(settings: Settings): Theme {
  const list = builtinThemes();
  if (settings.themeId === 'custom') {
    const t = makeCustomTheme();
    t.face = { ...settings.customFace };
    t.body = settings.customBody;
    t.mirror = settings.customMirror;
    return t;
  }
  return list.find((t) => t.id === settings.themeId) ?? list[0];
}
