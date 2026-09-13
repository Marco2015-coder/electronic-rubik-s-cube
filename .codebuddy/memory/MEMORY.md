# 电子魔方 项目长期记忆

## 项目概览
- Electron + TypeScript 三维魔方游戏。构建：`npm run build`（tsc 编译 main/shared → dist，esbuild 打包 ui → dist/ui/bundle.js）。
- 目录：`src/main`（Electron 主进程/冒烟测试）、`src/ui`（界面、视口、Canvas 2D 渲染）、`src/shared`（math/solid/themes + `puzzle/`）。
- 魔方模型：每个块是凸多面体 + 贴纸；姿态 = 平移 + 3x3 旋转矩阵；转动 = 绕原点某轴旋转固定角。
- 脚本：`npm run selftest`（模型自测，`scripts/selftest.mjs`）、`npm run smoke`（真实窗口截图到 `preview-out/`）。

## 关键设计约束（重要，勿破坏）
1. **打乱序列的生成与播放必须分开**：`CubicPuzzle.scramble()` 内部按「逐条演化」静默推进状态来确定每一步转哪些块（pieceIds 依赖前一步状态），返回时留在打乱态且历史为空。
   界面播放动画前必须 `puzzle.reset()`，再用 `viewport.requestScramble()`（内部 `applySilent`）按原顺序重放。**绝不能再走 `apply()`/`requestMove()`**，否则等于打乱两遍，第二次的 pieceIds 已不是合法一层 → 方块被拧进同一格（重叠）。
2. **镜面魔方的切分必须「关于 0 对称」且「三轴共用同一套」**：块绕轴转 90° 时跨度会被搬到另一根轴上，只有对称 + 三轴一致才能保证旋转后仍精确落格。见 `mirrorCutPositions()`。
   代价：段长成对相等，出现「正方体块」，因此 `isSolved()` 对镜面魔方放宽为「位置归位即算归位」（`isCubeShaped`）。
3. `Puzzle` 接口新增了 `applySilent(move)`（不写历史），打乱动画专用。

## 项目文档
- 仓库根目录有 `CODEBUDDY.md`（项目指南：命令、目录、数据模型、设计约束、验证流程、待办）。**改动重要逻辑或定下新决策后要同步更新它**，因为用户项目在 U 盘、对话记录经常丢失。

## 用户偏好
- 用中文交流，回答简洁直接。
- 代码注释用中文，说明「为什么这么做」而不是「做了什么」。
