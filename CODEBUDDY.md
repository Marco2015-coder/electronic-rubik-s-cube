# CODEBUDDY.md

给 AI 助手的项目指南。项目放在 U 盘里、对话容易丢失，因此**每次任务完成后都要更新本文件**：至少在 §8 变更日志末尾追加一条记录（重要改动或技术决策还要改前面的正文），并同步 `.codebuddy/memory/` 下的日志。更新后一并提交推送。

---

## 1. 这是什么

电子魔方：Electron + TypeScript 的三维魔方游戏。纯自研渲染与几何，运行时**零第三方依赖**（只有 electron / esbuild / typescript 三个开发依赖）。

- 界面：Canvas 2D + 背面剔除 + 画家算法排序渲染（`src/ui/scene.ts`），不是 WebGL。
- 几何：每个块都是「若干半空间的交集」自动求出的凸多面体（`src/shared/solid.ts`），所以立方体、正十二面体、正四面体可以共用一套代码。
- 已实现：2~5 阶普通/镜面魔方共 8 种；另有 5 种占位未实现（见 §7）。

## 2. 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run start` | 构建 + 启动（`start:only` 跳过构建直接启动） |
| `npm run dev` | 构建 + 启动并打开 DevTools |
| `npm run build` | `build:main`(tsc) → `build:renderer`(esbuild) → `build:assets`(拷贝 html/css) |
| `npm run typecheck` | `tsc --noEmit` 检查 main/shared 与 ui 两套配置 |
| `npm run selftest` | 模型自测 `scripts/selftest.mjs`（依赖 `dist/shared`，会先跑 `build:main`） |
| `npm run smoke` | 真实 Electron 窗口跑一遍流程并截图到 `preview-out/` |
| `npm run preview` | 离线把 8 种魔方渲染成一张 PNG（`preview-out/sheet.png`），不需要 Electron |

调试技巧：`window.__cubeApp` 暴露了 App 实例，可在 DevTools 里直接调 `scramble()` / `updateSettings({...})` / `undo()`。

## 3. 目录结构

```
src/main/        Electron 主进程
  main.ts        窗口、IPC（设置持久化 / 全屏）、菜单栏屏蔽、--smoke 入口
  preload.ts     通过 contextBridge 暴露 window.cubeBridge
  smoke.ts       冒烟测试脚本：点卡片 → 打乱 → 截图
src/shared/      主进程与界面共用的纯逻辑（不碰 DOM）
  math.ts        Vec3 / Mat3 / 旋转 / 吸附（mSnap）
  solid.ts       半空间交集 → 凸多面体（buildConvex）+ 缩放
  themes.ts      主题、颜色语义键、十六进制解析
  puzzle/types.ts     Piece / Move / Puzzle 接口与姿态工具
  puzzle/cubic.ts     立方体系魔方（正阶 + 镜面）唯一实现
src/ui/          渲染进程
  index.ts       入口，创建 App
  app.ts         应用状态机、计时、成绩、设置、按钮/键盘绑定
  viewport.ts    输入 → 转动、动画队列、渲染调度
  scene.ts       Canvas 2D 渲染器 + 射线拾取
  camera.ts      轨道相机
  menu.ts        魔方选择菜单
  puzzles.ts     13 种魔方的清单（未实现的 create 为 null）
  settings.ts    设置读写（Electron 存储 / localStorage 回退）
  styles/*.css   样式（构建时拷到 dist/ui）
scripts/         node 工具脚本（不参与打包）
  selftest.mjs   模型自测
  preview.mjs + raster.mjs + png.mjs   离线光栅化出图
  copy-assets.mjs
```

构建产物：`dist/`（tsc 输出 main/shared 的 CommonJS，esbuild 输出 `dist/ui/bundle.js`）。**改完源码必须重新构建**，否则自测/预览读的还是旧的 `dist/shared`。

tsconfig：`base`（strict）→ `main`（CommonJS，输出到 dist）/ `renderer`、`ui`（ESNext + bundler，`noEmit`，仅用于类型检查）。注意 `tsconfig.renderer.json` 与 `tsconfig.ui.json` 目前内容完全重复，可以合并。

## 4. 核心数据模型

- **Piece**：`home`（归位重心）+ `solid`（归位几何）+ `faceColors`（与面一一对应）+ `stickers` + `orientationMatters` + 当前姿态 `pos`/`rot`。
- **Move**：`axis` + `angle`（有符号弧度，绕**过原点**的轴）+ `label`（"U"、"R'"、"Uw2"）+ `pieceIds`（参与转动的块）+ `face`/`layers`（立方体系用）。
- **Puzzle**：`moveFromHit` / `candidateMoves` / `apply` / `applySilent` / `reset` / `isSolved` / `scramble` / `undo`。
- 姿态更新一律走 `applyRotationToPiece()`（内部 `mSnap` + 位置取整），所以转四圈能精确回到原位，不存在浮点累积。

## 5. 必须遵守的约束（都是踩过的坑）

### 5.1 打乱：生成与播放必须分开
`CubicPuzzle.scramble()` 内部会**按逐条演化的方式静默推进状态**，才能算出每一步要转哪些块（`pieceIds` 依赖上一步的状态），返回时魔方已处于打乱态、历史为空。

界面播放动画时必须：
```ts
const moves = this.puzzle.scramble();
this.puzzle.reset();                    // 退回还原态
this.viewport.requestScramble(moves, 55); // 内部 applySilent 按原顺序重放
```
**绝不能再让这串转动走 `apply()` / `requestMove()`**：那等于把打乱执行两遍，第二次执行时状态已变、旧的 `pieceIds` 不再是合法的一层，方块会被拧进同一格（视觉重叠）。同理，打乱动画要用 `applySilent` 以免污染撤销历史。

### 5.2 镜面魔方的切分必须「关于 0 对称」且「三轴共用」
块绕某根轴转 90° 时，它在另外两轴上的跨度会被搬到另一根轴上。只有切分关于原点对称（`-A = A`）且三个轴用同一套位置，旋转后的块才仍然精确落在格子里。否则块会横跨两层，之后按「位置所在层」挑块时就会带上不该转的块 → 重叠。见 `mirrorCutPositions()`。

代价（已接受）：段长必然成对相等，会出现「正方体块」，打乱后外形仍保持立方体，不像真实镜面魔方那样凹凸（真实产品靠内部圆盘机构才敢用不对称切分）。因此 `isSolved()` 对镜面魔方放宽为「正方体块位置归位即算归位」（`isCubeShaped`）。

### 5.3 动画策略：先改模型，再反向渲染
`viewport.tick()` 取出队列项时立即执行 `action()`（改模型），随后按进度用 `RenderOverride` 把参与块**反向旋转**回去，动画结束时刚好落到最终状态。不要改成「动画结束才改模型」，那样状态会不一致。

### 5.4 还原判定
- 普通魔方：按贴纸世界法向与颜色比对。
- 镜面魔方：按 `isPieceHome`（位置 + 朝向），并忽略正方体块的朝向。

### 5.5 拾取射线方向（`OrbitCamera.ray`）
`project()` 里 `vz = (p - eye)·zc`，只有 `vz < 0`（点在相机前方）才可见；而 `zc` 是「原点 → 相机」的**外向**轴（`eye = target + zc·distance`）。所以 `ray()` 的方向必须是 **`-zc`** 再加横向偏移。写成 `+zc` 射线会打到相机背后，`pick()` 恒返回 `null` —— 现象是**点哪都拾取不到、魔方完全拖不动，但渲染一切正常**（渲染不经过射线）。2026-09-13 修的就是这个。

### 5.6 其他
- **每次任务结束都要更新本文件**（§8 追加日志 + 必要时改正文）并提交推送，用户明确要求的。
- 不要删除 `.codebuddy/` 目录（项目记忆）。
- 大文件优先用局部替换，改前先读最新内容。
- 回答与代码注释用中文；注释解释「为什么」而不是「做了什么」。

## 6. 验证方式（改完务必跑）

1. `npm run typecheck` — 两套 tsconfig 都要过。
2. `npm run selftest` — 目前 **157 项**，覆盖：转动/撤销/复原、打乱后无块重叠、重放打乱序列能复现同一状态、贴纸始终贴在表面且每面贴纸数 = 6N²、正方体块朝向不判定失误等。
3. `npm run smoke` — Electron 真机流程 + `preview-out/*.png` 截图，人工看一眼有没有穿插、错位、控制台报错。其中包含一次**真实鼠标拖动**回归（用 `sendInputEvent` 拖画面中心，断言历史新增 1 步）：拾取或方向判定坏掉时这里会报错，**不要删掉它**。
4. `npm run preview -- --scramble` — 离线出图，快速检查 8 种魔方的外形与配色。

新增「打乱后无重叠」这类几何不变量检查时，可复用 `selftest.mjs` 里的 `aabb()` / `countOverlap()` / `poseKey()` 辅助函数（判断依据：两块的轴对齐包围盒交集体积 > 1e-4 视为重叠）。

## 7. 待办 / 未来方向

- 未实现的 5 种魔方：二阶五魔方、五魔方、金字塔、枫叶、斜转（`src/ui/puzzles.ts` 中 `create: null`）。实现思路是复用 `solid.ts` 的半空间切割 + 新的 `Puzzle` 实现。
- 镜面魔方若想还原「打乱后凹凸不平」的真实观感，需要把块的内部改成圆柱/球面机构（工程量大）。
- `tsconfig.renderer.json` / `tsconfig.ui.json` 重复，可合并。

## 8. 变更日志（每次任务做完都要在末尾追加一条）

格式：`- YYYY-MM-DD：做了什么 + 为什么 + 验证/结果`。

- 2026-09-13：修复「打乱后方块重叠」。两个根因——① 界面把打乱序列执行了两遍（引入 `Puzzle.applySilent` + `Viewport.requestScramble`，App 先 `reset()` 再重放）；② 镜面魔方三轴切分不一致（改为对称 + 三轴共用）。新增重叠回归自测，selftest 122 → 157 项。
- 2026-09-13：建立 GitHub 仓库并首次推送，地址 https://github.com/Marco2015-coder/electronic-rubik-s-cube （public，主分支 main）。新增 `README.md`、`.gitattributes`（统一 LF）；补 `.gitignore`；README 用的图片复制到 `docs/`；仓库级 `core.autocrlf=false`、`core.filemode=false`。
- 2026-09-13：排查「GitHub Desktop 双击无反应」。真因不是权限：**C 盘只剩 40 MB**，自动更新时解压不完整，`app-3.6.5` 缺 `v8_context_snapshot.bin` 等文件，启动即 `FATAL: Error loading V8 startup snapshot file`；随后 Squirrel 回滚清空安装目录，只能重装。清理缓存后 C 盘恢复约 4 GB，用户卸载重装后恢复正常。
- 2026-09-13：解决 U 盘（FAT32）上的 `detected dubious ownership`——经用户确认执行 `git config --global --add safe.directory F:/electronic-rubik-s-cube`；**换电脑或盘符变化需按新路径重新添加**。
- 2026-09-13：应要求把「每次任务都更新 `CODEBUDDY.md`」定为固定协作约定（见 §5.6）。
- 2026-09-13：修复「魔方完全拖不动」。根因是 `OrbitCamera.ray()` 的射线方向取了 `+zc`（应为 `-zc`）：射线打到相机背后，`pick()` 恒返回 `null`，任何拖动都不产生转动，而渲染完全正常所以肉眼看不出来。修好后把「左键点空白」从 `idle`（什么都不做）改成转视角，与界面文案一致。`smoke.ts` 新增**真实鼠标拖动**回归（`sendInputEvent`），此前冒烟测试只调 API，所以漏掉了这个 bug。验证：拖魔方转出 `U'`、步数 1；拖空白视角 yaw 0.620 → -0.341；typecheck 通过、selftest 157 项通过。
