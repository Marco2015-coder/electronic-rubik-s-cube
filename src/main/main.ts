/**
 * Electron 主进程。
 *
 * 职责：
 *  - 创建游戏窗口（无边框级观感、深色背景，避免启动白屏闪烁）
 *  - 屏蔽菜单栏，通过 IPC 暴露少量系统能力（设置持久化、窗口控制）
 *  - 窗口尺寸 / 位置记忆
 */

import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { runSmokeTest } from './smoke';

interface StoreShape {
  settings?: Record<string, unknown>;
  window?: { width: number; height: number; x?: number; y?: number; maximized?: boolean };
}

const STORE_FILE = () => path.join(app.getPath('userData'), 'cube-store.json');

function readStore(): StoreShape {
  try {
    const raw = fs.readFileSync(STORE_FILE(), 'utf8');
    return JSON.parse(raw) as StoreShape;
  } catch {
    return {};
  }
}

function writeStore(patch: StoreShape): void {
  const cur = readStore();
  const next: StoreShape = { ...cur, ...patch };
  if (patch.settings) next.settings = { ...cur.settings, ...patch.settings };
  if (patch.window) next.window = { ...cur.window, ...patch.window };
  try {
    fs.mkdirSync(path.dirname(STORE_FILE()), { recursive: true });
    fs.writeFileSync(STORE_FILE(), JSON.stringify(next, null, 2), 'utf8');
  } catch {
    /* 忽略写入失败，不影响游戏运行 */
  }
}

let win: BrowserWindow | null = null;
let smokeMode = false;

function createWindow(): BrowserWindow {
  const store = readStore();
  const work = screen.getPrimaryDisplay().workAreaSize;
  const width = store.window?.width ?? Math.min(1440, work.width - 80);
  const height = store.window?.height ?? Math.min(900, work.height - 80);

  win = new BrowserWindow({
    width,
    height,
    x: store.window?.x,
    y: store.window?.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    title: '电子魔方',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  if (store.window?.maximized) win.maximize();

  win.removeMenu();
  win.once('ready-to-show', () => {
    if (smokeMode) win?.showInactive();
    else win?.show();
    if (process.argv.includes('--dev')) win?.webContents.openDevTools({ mode: 'detach' });
  });

  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  const remember = (): void => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    writeStore({
      window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() },
    });
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', remember);

  // 外链一律用系统浏览器打开，避免在游戏窗口内跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    win = null;
  });

  return win;
}

app.whenReady().then(() => {
  smokeMode = process.argv.includes('--smoke');

  ipcMain.handle('store:load', () => readStore().settings ?? {});
  ipcMain.handle('store:save', (_e, settings: Record<string, unknown>) => {
    writeStore({ settings });
    return true;
  });
  ipcMain.handle('win:toggleFullscreen', () => {
    if (!win) return false;
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });
  ipcMain.handle('win:isFullscreen', () => win?.isFullScreen() ?? false);

  const window = createWindow();

  if (smokeMode) {
    window.once('ready-to-show', () => {
      void runSmokeTest(window, path.join(app.getAppPath(), 'preview-out')).then((code) => app.exit(code));
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
