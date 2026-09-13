/**
 * 游戏主控：串联界面、魔方模型与视口。
 */

import { Puzzle } from '../shared/puzzle/types';
import { Theme } from '../shared/themes';
import { findPuzzle, PuzzleDef } from './puzzles';
import { Settings, loadSettings, resolveTheme, saveSettings } from './settings';
import { renderMenu } from './menu';
import { renderSettingsPanel } from './settings-panel';
import { Viewport } from './viewport';

type Phase = 'idle' | 'scrambling' | 'ready' | 'solving' | 'solved';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(2);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}

export class App {
  private settings: Settings;
  private theme: Theme;
  private viewport: Viewport;

  private current: PuzzleDef | null = null;
  private puzzle: Puzzle | null = null;
  private phase: Phase = 'idle';

  private startedAt = 0;
  private elapsed = 0;
  private moves = 0;
  private timerHandle = 0;

  private els = {
    gameUi: $('game-ui'),
    menu: $('menu'),
    menuGroups: $('menu-groups'),
    menuCount: $('menu-count'),
    settings: $('settings'),
    settingsBody: $('settings-body'),
    scrim: $('scrim'),
    toast: $('toast'),
    celebrate: $('celebrate'),
    celebrateStats: $('celebrate-stats'),
    puzzleName: $('puzzle-name'),
    puzzleSub: $('puzzle-sub'),
    statTime: $('stat-time'),
    statMoves: $('stat-moves'),
    statBest: $('stat-best'),
    btnUndo: $<HTMLButtonElement>('btn-undo'),
    btnTheme: $('btn-theme'),
  };

  constructor(settings: Settings) {
    this.settings = settings;
    this.theme = resolveTheme(settings);

    this.viewport = new Viewport($<HTMLCanvasElement>('stage'), this.theme, {
      onMoveCommitted: (move) => this.handleMoveCommitted(move.label),
      onSolved: () => this.handleSolved(),
      onIdle: () => {
        if (this.phase === 'scrambling') {
          this.phase = 'ready';
          this.els.puzzleSub.textContent = '随时可以开始，拧动即计时';
        }
      },
    });
    this.viewport.speed = settings.speed;
    this.viewport.start();

    this.bindButtons();
    this.bindKeyboard();
    this.applyTheme();
    this.renderMenu();
    this.refreshSettingsPanel();
  }

  // ------------------------------------------------------------------ 界面

  private renderMenu(): void {
    renderMenu(this.els.menuGroups, (def) => this.openPuzzle(def));
    this.els.menuCount.textContent = String(13);
    this.els.btnTheme.textContent = `配色：${this.themeName()}`;
  }

  private themeName(): string {
    if (this.settings.themeId === 'custom') return '自定义';
    if (this.settings.themeId === 'macaron') return '马卡龙';
    return '普通';
  }

  private refreshSettingsPanel(): void {
    renderSettingsPanel(this.els.settingsBody, this.settings, (patch) => this.updateSettings(patch));
  }

  private updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.theme = resolveTheme(this.settings);
    this.viewport.setTheme(this.theme);
    this.viewport.speed = this.settings.speed;
    this.applyTheme();
    this.refreshSettingsPanel();
    this.els.btnTheme.textContent = `配色：${this.themeName()}`;
    this.updateBestDisplay();
  }

  private applyTheme(): void {
    document.body.style.background = this.theme.background;
    const root = document.documentElement;
    root.style.setProperty('--accent', accentOf(this.theme));
  }

  private bindButtons(): void {
    $('btn-scramble').addEventListener('click', () => this.scramble());
    $('btn-undo').addEventListener('click', () => this.undo());
    $('btn-reset').addEventListener('click', () => this.reset());
    $('btn-hint').addEventListener('click', () => this.showHint());
    $('btn-back').addEventListener('click', () => this.backToMenu());
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-settings-2').addEventListener('click', () => this.openSettings());
    $('btn-settings-close').addEventListener('click', () => this.closeSettings());
    this.els.scrim.addEventListener('click', () => this.closeSettings());
    this.els.btnTheme.addEventListener('click', () => this.cycleTheme());
    $('btn-again').addEventListener('click', () => {
      this.closeCelebrate();
      this.scramble();
    });
    $('btn-celebrate-close').addEventListener('click', () => this.closeCelebrate());
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (this.els.settings.classList.contains('hidden') === false && e.key === 'Escape') {
        this.closeSettings();
        return;
      }
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (this.phase !== 'idle') this.scramble();
          break;
        case 'z':
        case 'Z':
          this.undo();
          break;
        case 'r':
        case 'R':
          this.reset();
          break;
        case 'Escape':
          this.backToMenu();
          break;
        case 'f':
        case 'F':
          void window.cubeBridge?.toggleFullscreen();
          break;
        default:
          break;
      }
    });
  }

  private openSettings(): void {
    this.refreshSettingsPanel();
    this.els.settings.classList.remove('hidden');
    this.els.scrim.classList.remove('hidden');
  }

  private closeSettings(): void {
    this.els.settings.classList.add('hidden');
    this.els.scrim.classList.add('hidden');
  }

  private cycleTheme(): void {
    const order = ['standard', 'macaron', 'custom'];
    const next = order[(order.indexOf(this.settings.themeId) + 1) % order.length];
    this.updateSettings({ themeId: next });
  }

  // ------------------------------------------------------------------ 游戏

  private openPuzzle(def: PuzzleDef): void {
    if (!def.create) {
      this.toast('这个魔方还在开发中');
      return;
    }
    const puzzle = def.create();
    this.current = def;
    this.puzzle = puzzle;
    this.viewport.setPuzzle(puzzle);
    this.phase = 'ready';
    this.moves = 0;
    this.elapsed = 0;
    this.els.puzzleName.textContent = def.name;
    this.els.puzzleSub.textContent = def.desc;
    this.els.gameUi.classList.remove('hidden');
    this.els.menu.classList.add('hidden');
    this.updateStatsDisplay();
    this.updateBestDisplay();
    this.updateUndoButton();
    this.toast('拖动贴纸开始转动');
  }

  private backToMenu(): void {
    this.phase = 'idle';
    this.puzzle = null;
    this.current = null;
    this.els.gameUi.classList.add('hidden');
    this.els.menu.classList.remove('hidden');
    this.stopTimer();
    this.renderMenu();
  }

  private scramble(): void {
    if (!this.puzzle) return;
    this.viewport.flush();
    // scramble() 会在内部按「逐条演化」推进状态来确定每一步要转哪些块，并把手里的
    // 魔方留在打乱后的状态（同时清空历史）。这里必须把它退回还原态，再让视口按原
    // 顺序重放这串转动；否则同一串转动会被施加两次，第二次的 pieceIds 已经不是合法
    // 的一层，方块就会被拧到同一格（视觉重叠）。
    const moves = this.puzzle.scramble();
    this.puzzle.reset();
    this.phase = 'scrambling';
    this.moves = 0;
    this.elapsed = 0;
    this.stopTimer();
    this.updateStatsDisplay();
    this.updateUndoButton();
    this.viewport.requestScramble(moves, 55);
  }

  private reset(): void {
    if (!this.puzzle) return;
    this.viewport.flush();
    this.puzzle.reset();
    this.phase = 'ready';
    this.moves = 0;
    this.elapsed = 0;
    this.stopTimer();
    this.updateStatsDisplay();
    this.updateUndoButton();
    this.viewport.requestRender();
    this.toast('已重置');
  }

  private undo(): void {
    if (!this.puzzle || this.phase === 'scrambling') return;
    if (this.puzzle.history.length === 0) {
      this.toast('没有可撤销的操作');
      return;
    }
    this.viewport.requestUndo();
    this.moves = Math.max(0, this.moves - 1);
    this.updateStatsDisplay();
    window.setTimeout(() => this.updateUndoButton(), 220);
  }

  private showHint(): void {
    if (!this.puzzle) return;
    const last = this.puzzle.history[this.puzzle.history.length - 1];
    this.toast(last ? `上一步：${last.label}` : '还没有拧动过，按空格打乱试试');
  }

  private handleMoveCommitted(label: string): void {
    if (!this.puzzle) return;
    if (this.phase === 'scrambling') {
      return;
    }
    if (this.phase === 'ready') {
      this.phase = 'solving';
      this.startTimer();
      this.els.puzzleSub.textContent = '计时中…';
    }
    if (this.phase === 'solving' || this.phase === 'solved') {
      this.moves++;
      this.updateStatsDisplay();
    }
    this.updateUndoButton();
    void label;
  }

  private handleSolved(): void {
    if (!this.puzzle) return;
    if (this.phase !== 'solving') return;
    this.stopTimer();
    this.phase = 'solved';

    const time = this.elapsed;
    const id = this.current?.id ?? '';
    const best = this.settings.bestTimes[id];
    const isBest = !best || time < best;
    if (isBest && id) {
      this.updateSettings({ bestTimes: { ...this.settings.bestTimes, [id]: time } });
    }
    this.els.puzzleSub.textContent = '已复原';

    this.els.celebrateStats.innerHTML = [
      `用时 <b>${formatTime(time)}</b>`,
      `步数 <b>${this.moves}</b>`,
      isBest ? '<b>新纪录！</b>' : `最佳 <b>${formatTime(best ?? time)}</b>`,
    ].join('<br />');
    this.els.celebrate.classList.remove('hidden');
  }

  private closeCelebrate(): void {
    this.els.celebrate.classList.add('hidden');
  }

  private startTimer(): void {
    this.startedAt = performance.now() - this.elapsed;
    this.stopTimer();
    this.timerHandle = window.setInterval(() => {
      this.elapsed = performance.now() - this.startedAt;
      this.els.statTime.textContent = formatTime(this.elapsed);
    }, 43);
  }

  private stopTimer(): void {
    if (this.timerHandle) window.clearInterval(this.timerHandle);
    this.timerHandle = 0;
    this.els.statTime.textContent = formatTime(this.elapsed);
  }

  private updateStatsDisplay(): void {
    this.els.statTime.textContent = formatTime(this.elapsed);
    this.els.statMoves.textContent = String(this.moves);
  }

  private updateBestDisplay(): void {
    const id = this.current?.id ?? '';
    const best = this.settings.bestTimes[id];
    this.els.statBest.textContent = best ? formatTime(best) : '—';
  }

  private updateUndoButton(): void {
    const canUndo = !!this.puzzle && this.puzzle.history.length > 0 && this.phase !== 'scrambling';
    this.els.btnUndo.disabled = !canUndo;
  }

  private toast(message: string): void {
    const el = this.els.toast;
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.add('show');
    window.clearTimeout((el as unknown as { _t?: number })._t);
    (el as unknown as { _t?: number })._t = window.setTimeout(() => {
      el.classList.remove('show');
      window.setTimeout(() => el.classList.add('hidden'), 240);
    }, 1700);
  }
}

/** 从配色推导界面强调色。 */
function accentOf(theme: Theme): string {
  if (theme.id === 'macaron') return '#f2a1a8';
  if (theme.id === 'custom') return theme.face.F;
  return '#5aa9ff';
}

export { formatTime, findPuzzle };
