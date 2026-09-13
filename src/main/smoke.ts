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

  try {
    await wait(1400);
    await shot('app-01-menu');

    for (const [index, card] of ['普通三阶魔方', '镜面三阶魔方', '普通五阶魔方'].entries()) {
      const ok = await clickCard(card);
      if (!ok) problems.push(`找不到卡片：${card}`);
      await wait(700);
      await shot(`app-0${index + 2}-${card}`);
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
