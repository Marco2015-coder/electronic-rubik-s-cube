/**
 * 三维视口：负责输入、动画与渲染调度。
 *
 * 交互约定：
 *  - 左键在贴纸上拖动 → 转动该块所在层（拖动方向决定转轴与方向）
 *  - 右键（或中键 / Alt + 左键）拖动 → 旋转视角
 *  - 滚轮 → 缩放
 *  - 拖动时按住 Shift → 宽层转
 *
 * 动画策略：转动先立即作用于模型（保证状态始终自洽），渲染时再按进度
 * 「反向旋转」回去，于是动画结束时刚好落到最终状态，不会有浮点漂移。
 */

import { Move, Puzzle } from '../shared/puzzle/types';
import { Theme } from '../shared/themes';
import { OrbitCamera } from './camera';
import { RenderOverride, CubeRenderer, pick, computeBoundingSpheres, puzzleRadius } from './scene';
import { vCross, vScale } from '../shared/math';

export interface ViewportEvents {
  /** 视角或状态变化后通知外部刷新界面。 */
  onMoveCommitted(move: Move): void;
  onSolved(): void;
  onTurnStart?(): void;
  /** 动画队列全部播完时触发一次。 */
  onIdle?(): void;
}

interface QueueItem {
  action: () => Move | null;
  duration: number;
}

const DRAG_THRESHOLD = 9;

export class Viewport {
  readonly canvas: HTMLCanvasElement;
  private renderer: CubeRenderer;
  private camera = new OrbitCamera();
  private puzzle: Puzzle | null = null;
  private theme: Theme;
  private events: ViewportEvents;
  private spheres: ReturnType<typeof computeBoundingSpheres> = [];

  private raf = 0;
  private lastTime = 0;
  private dirty = true;
  private wasBusy = false;
  private queue: QueueItem[] = [];
  private anim: { move: Move; t: number; duration: number } | null = null;
  private animIds = new Set<number>();

  /** 动画速度倍率（1 = 标准）。 */
  speed = 1;

  private pointer: {
    id: number;
    mode: 'idle' | 'turn' | 'orbit';
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    hit: ReturnType<typeof pick>;
    wide: boolean;
  } | null = null;

  constructor(canvas: HTMLCanvasElement, theme: Theme, events: ViewportEvents) {
    this.canvas = canvas;
    this.theme = theme;
    this.events = events;
    this.renderer = new CubeRenderer(canvas);
    this.bindEvents();
  }

  setPuzzle(puzzle: Puzzle): void {
    this.puzzle = puzzle;
    this.spheres = computeBoundingSpheres(puzzle.pieces);
    this.camera.frame(puzzleRadius(puzzle));
    this.queue.length = 0;
    this.anim = null;
    this.requestRender();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.requestRender();
  }

  getCamera(): OrbitCamera {
    return this.camera;
  }

  requestRender(): void {
    this.dirty = true;
  }

  start(): void {
    if (this.raf) return;
    const loop = (time: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.05) : 0.016;
      this.lastTime = time;
      this.tick(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** 把一次转动加入动画队列。 */
  requestMove(move: Move, duration = 170): void {
    this.queue.push({
      action: () => {
        this.puzzle?.apply(move);
        return move;
      },
      duration,
    });
    this.requestRender();
  }

  /**
   * 播放打乱序列（间隔更短）。
   *
   * 打乱序列在 `puzzle.scramble()` 里已经按「逐条演化」的方式算好：每条转动的
   * pieceIds 都依赖它之前那一步的状态。所以这里必须从还原态起步、按原顺序重放，
   * 并且只能静默施加——如果交给 `requestMove`（内部是 `apply()`），就等于把打乱
   * 又执行了一遍，第二次执行时 pieceIds 早已不是合法的一层，块会被打散到同一格。
   */
  requestScramble(moves: Move[], duration = 55): void {
    for (const m of moves) {
      this.queue.push({
        action: () => {
          this.puzzle?.applySilent(m);
          return m;
        },
        duration,
      });
    }
    this.requestRender();
  }

  /** 撤销一步。 */
  requestUndo(duration = 160): void {
    this.queue.push({
      action: () => this.puzzle?.undo() ?? null,
      duration,
    });
    this.requestRender();
  }

  /** 立即完成队列中的全部动画。 */
  flush(): void {
    this.queue.length = 0;
    this.anim = null;
    this.requestRender();
  }

  get busy(): boolean {
    return this.anim !== null || this.queue.length > 0;
  }

  private tick(dt: number): void {
    const moving = this.camera.step(dt);

    if (this.anim) {
      this.anim.t += (dt * 1000 * this.speed) / Math.max(1, this.anim.duration);
      if (this.anim.t >= 1) {
        const finished = this.anim.move;
        this.anim = null;
        this.animIds.clear();
        this.events.onMoveCommitted(finished);
        if (this.puzzle?.isSolved()) this.events.onSolved();
        this.dirty = true;
      }
    }

    if (!this.anim && this.queue.length > 0) {
      const item = this.queue.shift()!;
      const move = item.action();
      if (move && item.duration > 0) {
        this.anim = { move, t: 0, duration: item.duration };
        this.animIds = new Set(move.pieceIds);
      } else if (move) {
        this.events.onMoveCommitted(move);
        if (this.puzzle?.isSolved()) this.events.onSolved();
      }
      this.dirty = true;
    }

    if (this.dirty || moving || this.anim) {
      this.dirty = false;
      this.draw();
    }

    const isBusy = this.anim !== null || this.queue.length > 0;
    if (this.wasBusy && !isBusy) this.events.onIdle?.();
    this.wasBusy = isBusy;
  }

  private draw(): void {
    if (!this.puzzle) return;
    let override: RenderOverride | undefined;
    if (this.anim) {
      override = {
        axis: this.anim.move.axis,
        angle: -this.anim.move.angle * (1 - this.anim.t),
        ids: this.animIds,
      };
    }
    this.renderer.render(this.puzzle, this.theme, this.camera, override);
  }

  // -------------------------------------------------------------------------
  // 输入
  // -------------------------------------------------------------------------

  private bindEvents(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';

    c.addEventListener('pointerdown', (e) => {
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      c.setPointerCapture(e.pointerId);

      const wantsOrbit = e.button !== 0 || e.altKey || !this.puzzle;
      const hit = wantsOrbit ? null : this.hitTest(x, y);

      this.pointer = {
        id: e.pointerId,
        mode: hit ? 'turn' : wantsOrbit ? 'orbit' : 'idle',
        startX: x,
        startY: y,
        lastX: x,
        lastY: y,
        hit,
        wide: e.shiftKey,
      };
      if (hit) this.events.onTurnStart?.();
    });

    c.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = x - p.lastX;
      const dy = y - p.lastY;

      if (p.mode === 'orbit') {
        this.camera.orbit(dx, dy);
        this.dirty = true;
      } else if (p.mode === 'turn') {
        const totalX = x - p.startX;
        const totalY = y - p.startY;
        if (Math.hypot(totalX, totalY) >= DRAG_THRESHOLD && p.hit) {
          const move = this.resolveMove(p.hit, totalX, totalY, p.wide || e.shiftKey);
          if (move) this.requestMove(move);
          // 一次拖动只转一层，避免连续触发
          p.mode = 'idle';
          p.hit = null;
        }
      }
      p.lastX = x;
      p.lastY = y;
    });

    const endPointer = (e: PointerEvent): void => {
      if (this.pointer && this.pointer.id === e.pointerId) this.pointer = null;
    };
    c.addEventListener('pointerup', endPointer);
    c.addEventListener('pointercancel', endPointer);

    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camera.zoom(e.deltaY);
        this.dirty = true;
      },
      { passive: false },
    );

    window.addEventListener('resize', () => {
      this.dirty = true;
    });

    // 键盘：方向键旋转视角，方便无鼠标操作
    window.addEventListener('keydown', (e) => {
      const step = 0.12;
      if (e.key === 'ArrowLeft') this.camera.orbit(-30, 0);
      else if (e.key === 'ArrowRight') this.camera.orbit(30, 0);
      else if (e.key === 'ArrowUp') this.camera.orbit(0, -30);
      else if (e.key === 'ArrowDown') this.camera.orbit(0, 30);
      else return;
      e.preventDefault();
      void step;
      this.dirty = true;
    });
  }

  private hitTest(x: number, y: number) {
    if (!this.puzzle) return null;
    return pick(this.puzzle, this.camera, this.spheres, x, y);
  }

  /**
   * 由拖动方向推断该转哪一层、往哪转。
   * 对每个候选转动预测命中点的屏幕位移方向，取与拖动方向最贴合的那个。
   */
  private resolveMove(
    hit: NonNullable<ReturnType<typeof pick>>,
    dx: number,
    dy: number,
    wide: boolean,
  ): Move | null {
    if (!this.puzzle) return null;
    const candidates = this.puzzle.candidateMoves(hit, { wide });
    const dragLen = Math.hypot(dx, dy);
    if (dragLen < 1e-3) return null;

    let best: Move | null = null;
    let bestScore = 0.35;
    const point = hit.point;

    for (const move of candidates) {
      // 绕 axis 旋转时，点 point 的瞬时速度方向 ∝ axis × point
      const velocity = vCross(move.axis, point);
      const dir = vScale(velocity, Math.sign(move.angle) || 1);
      const screen = this.camera.screenDirection(point, dir);
      if (!screen) continue;
      const len = Math.hypot(screen.x, screen.y);
      if (len < 1e-6) continue;
      const score = (screen.x * dx + screen.y * dy) / (len * dragLen);
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  }
}
