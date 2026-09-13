/**
 * 渲染进程入口。
 */

import { App } from './app';
import { loadSettings } from './settings';

async function main(): Promise<void> {
  const settings = await loadSettings();
  const app = new App(settings);
  Object.assign(window, { __cubeApp: app });
}

void main();
