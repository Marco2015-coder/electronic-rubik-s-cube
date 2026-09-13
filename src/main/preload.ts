/**
 * 预加载脚本：以 contextBridge 暴露最小 API 给渲染进程。
 * 渲染进程拿不到 Node 能力，只能调用这里显式列出的方法。
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface CubeBridge {
  loadSettings(): Promise<Record<string, unknown>>;
  saveSettings(settings: Record<string, unknown>): Promise<boolean>;
  toggleFullscreen(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  platform: string;
}

const bridge: CubeBridge = {
  loadSettings: () => ipcRenderer.invoke('store:load'),
  saveSettings: (settings) => ipcRenderer.invoke('store:save', settings),
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('cubeBridge', bridge);
