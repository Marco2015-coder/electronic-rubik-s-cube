/**
 * 冒烟测试：用真实 Electron 窗口跑一遍交互流程并截图，
 * 便于在没有人工操作的情况下确认界面与渲染是否正常。
 * 用法：electron . --smoke
 */

import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function runSmokeTest(win: BrowserWindow, outDir: string): Promise<number> {
  const problems: string[] = [];
  const stepLog: string[] = [];

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const text = String(message);
    if (level >= 2 || /error|Error|Uncaught/i.test(text)) {
      problems.push(`[console L${level}] ${text} (${path.basename(String(sourceId))}:${line})`);
    } else {
      stepLog.push(`${text}`);
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    problems.push(`渲染进程崩溃：${JSON.stringify(details)}`);
  });

  fs.mkdirSync(outDir, { recursive: true });

  const shot = async (name: string): Promise<void> => {
    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    fs.writeFileSync(path.join(outDir, `${name}.png`), png);
    stepLog.push(`截图 ${name}.png (${png.length} 字节)`);
  };

  const clickCard = (name: string): Promise<boolean> =>
    win.webContents.executeJavaScript(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.card'));
        const card = cards.find((c) => c.querySelector('.card-name')?.textContent === ${JSON.stringify(name)});
        if (!card) return false;
        card.click();
        return true;
      })()
    `);

  const historyLength = (): Promise<number> =>
    win.webContents.executeJavaScript('window.__cubeApp.puzzle ? window.__cubeApp.puzzle.history.length : -1');

  /**
   * 用真实鼠标输入事件在画面中心拖一把，返回本次新增的转动步数。
   *
   * 之所以要模拟真实输入而不是直接调 `apply()`：拾取（`camera.ray` → 射线求交）和
   * 「按拖动方向选转法」这两段逻辑只有走 pointer 事件才会被覆盖。曾出现过射线方向
   * 取反（`+zc` 写成 `-zc`）导致点哪都拾取不到、魔方完全拖不动，而之前的冒烟测试
   * 只调 API，所以毫无察觉。
   */
  const dragTurn = async (): Promise<number> => {
    const before = await historyLength();
    const size = await win.webContents.executeJavaScript(
      `(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`,
    );
    const cx = Math.round(size.w / 2);
    const cy = Math.round(size.h / 2);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: cx, y: cy });
    await wait(60);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 10; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: cx + i * 12, y: cy });
      await wait(16);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: cx + 120, y: cy, button: 'left', clickCount: 1 });
    await wait(700);
    return (await historyLength()) - before;
  };

  try {
    await wait(1400);
    await shot('app-01-menu');

    for (const [index, card] of ['普通三阶魔方', '镜面三阶魔方', '普通五阶魔方'].entries()) {
      const ok = await clickCard(card);
      if (!ok) problems.push(`找不到卡片：${card}`);
      await wait(700);
      await shot(`app-0${index + 2}-${card}`);
      if (index === 0) {
        // 回归检查：手动拖动的完整链路（拾取 → 方向判定 → 动画）
        const turned = await dragTurn();
        if (turned === 1) {
          stepLog.push('拖动测试：拖动贴纸成功转过一层');
        } else {
          problems.push(`拖动贴纸没有产生转动（历史新增 ${turned} 步）`);
        }
      }
      await win.webContents.executeJavaScript('window.__cubeApp.scramble()');
      await wait(2600);
      await shot(`app-0${index + 2}b-${card}-scrambled`);
    }

    await win.webContents.executeJavaScript(`window.__cubeApp.updateSettings({ themeId: 'macaron' })`);
    await wait(500);
    await shot('app-06-macaron');

    await win.webContents.executeJavaScript('window.__cubeApp.undo()');
    await win.webContents.executeJavaScript('window.__cubeApp.reset()');
    await clickCard('普通二阶魔方');
    await wait(600);
    await win.webContents.executeJavaScript('window.__cubeApp.scramble()');
    await wait(2200);
    await shot('app-07-cube2');

    await win.webContents.executeJavaScript('window.__cubeApp.openSettings ? 0 : 0');
    await win.webContents.executeJavaScript(
      `document.getElementById('btn-settings-2')?.click(); document.getElementById('btn-back')?.click(); document.getElementById('btn-settings')?.click();`,
    );
    await wait(500);
    await shot('app-08-settings');
  } catch (error) {
    problems.push(`执行异常：${String(error)}`);
  }

  console.log('--- 冒烟测试步骤 ---');
  for (const line of stepLog) console.log(line);
  if (problems.length) {
    console.log('--- 发现问题 ---');
    for (const p of problems) console.log(p);
  } else {
    console.log('--- 未发现问题 ---');
  }
  return problems.length ? 1 : 0;
}
