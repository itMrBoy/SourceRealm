# Reflection: 寻宝智能容差判定 + 通关只读回顾 + shared 源码消费热更新坑

## Task

三件事一起落地（SourceRealm，packages/shared + packages/web）：

1. 寻宝题（treasure-hunt）从「单击即判」改为「多选行 + 提交 + 智能容差判定」。
2. 通关后持久化答题历史，并提供只读「走查回顾」（review phase）。
3. 排查并记录一个由 shared 源码消费 + tsx 无 watch 导致的运行环境坑。

## What mattered

### 1. 容差判定（核心教训）

- `packages/shared/src/judge.ts:judgeTreasureHunt` 签名改为
  `(target, selected:{file,lines:number[]}, targetText:string[]) => {correct, overlap}`。
- 语义：同文件；忽略空行；**仅 .md 文件**里 `#` 标题行（正则 `/^\s*#{1,6}\s/`，允许前导空白）
  视为可选；核心内容行（非空非标题）必须全选且不越界；required 为空回退非空行；
  targetText 为空时退化为严格全区间匹配。`overlap` = 选中行与 `[startLine,endLine]` 是否有交集。
- 第一版用「逐行精确匹配」（所选须正好等于 `[startLine,endLine]` 每一行）实测失败：真实关卡
  target=`README.zh-CN.md 28-36` 把标题（28 `## 公开接口`）和空行（29）也圈进区间，玩家自然只选
  30-36 的清单 7 行，严格匹配判错、3 次耗尽心。根因是 **AI 生成的 target 边界把标题/空行包进区间，
  且与它自己 hint（清单从 Core skill 开始）矛盾**——对 AI 生成的位置型答案做逐行精确匹配过于脆弱，
  必须容差（忽略空行 + md 标题可选）。

### 2. 通关历史与 review 回顾

- `packages/shared/src/schema.ts`：`SavedAnswerSchema` 上移到 `LevelResultSchema` 之前
  （避免 use-before-declaration）；`LevelResultSchema` 加 `answeredHistory?: SavedAnswer[]`
  （**optional 向后兼容旧存档**；注意 `SavedRunSchema.answeredHistory` 仍为必填，两者语义不同，勿合并）。
- `packages/web/src/screens/run.ts`：`RunPhase` 加 `'review'`；`finishLevel` 提交 result 带 history；
  `loadLevel` 在「无 levelRuns 断点但 completedLevels 命中」时进入 `phase:'review'`；
  `reviewGoTo` 纯 clamp；`canPersistPhase` 不含 review。
- `packages/web/src/screens/TaskPanel.tsx`：`phase==='review'` 早返回 `ReviewWalkthrough`。
  **它与答题途中的 `PreviousReview` 弹窗是两套不同 UI，勿混淆**。
- `MapScreen.tsx` done 节点 tooltip 改「点击回顾」。

### 3. 多选 UI

- `LevelScreen.tsx`：`selectedLines` 多选（scoped 到当前 `activeFile`）；新增 `treasureTargetText`
  + prefetch effect（`api.getFile` 取目标区间逐行文本供判定）；`onSubmitTreasure` 三分支——
  答对推进；**答错且 overlap：仅 toast 提示、不扣心、停留 answering 保留选区**；
  答错且无交集：toast + 扣心。交集敏感的惩罚是这道题手感的关键。
- `CodeBrowser.tsx` 新增 `selectedLines` prop + `.cb-line--selected`；
  `TreasureHuntTask.tsx` 加「提交（已选 N 行）」按钮。

### 4. 运行环境坑（务必记牢）

`@sourcerealm/shared` 的 package.json `exports` 指向 `./src/index.ts`（**源码消费，无 dist**），
server dev 脚本是 `tsx src/cli.ts`（**无 watch**）。改了 shared 的 zod schema 后，
**正在运行的后端进程不会热更新**；旧 `LevelResultSchema`（无 `answeredHistory`）会把 POST body 的
新字段当未知键 strip 掉（Zod 默认 strip，无 `.passthrough()`），导致「代码已改但通关历史存不进去」的
假象——表现为回顾显示「无作答记录」。**改 shared schema 后必须重启后端**。这是真实复现过的坑，
排查时极易误判为代码逻辑错误。

## Validation note

- `node node_modules/vitest/vitest.mjs run`：102 passed（judge 12）。注意 `pnpm test` 因 pnpm 的
  cmd shim 找不到 node 而失败，需直接用 `node node_modules/vitest/vitest.mjs run`
  （此条已在 `2026-06-15-codebrowser-tree-and-pnpm.md` / commands 记过）。
- web `tsc --noEmit`：零新增类型错误（仅既有 7 个 CodeBrowser/react-accessible-treeview 泛型告警）。
  `vite build` 成功。

## Promotion candidates

- `llmdoc/reference/data-model.md`：treasure-hunt 判定语义改为「容差精确集合 + overlap」
  （忽略空行、仅 md 标题可选、targetText 为空退化严格区间）；新增 `LevelResult.answeredHistory?`
  （optional，向后兼容）、completedLevels 携带历史、重复通关仅补 xp 正差额。
- `llmdoc/architecture/frontend-runtime.md`：`RunPhase` 加 `review`；寻宝多选/提交/容差/交集敏感惩罚
  三分支；review 走查（`ReviewWalkthrough`）vs 答题途中 `PreviousReview` 弹窗的区分；
  `CodeBrowser` 新增 `selectedLines`。
- `llmdoc/must/working-agreement.md`（或 `reference/commands.md`）：shared 为源码消费（exports 指向
  src）+ tsx 无 watch → **改 shared schema 必须重启后端**，否则 Zod 默认 strip 会静默吞掉新字段。
