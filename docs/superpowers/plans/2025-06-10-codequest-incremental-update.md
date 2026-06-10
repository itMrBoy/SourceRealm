# CodeQuest 增量更新引擎 Implementation Plan (计划 3/3)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** 仓库出现新 commit 时,不全量重建:基于 git diff 做影响分析,修订受影响关卡、作废删除关卡、按需追加新关卡,原子切换锚点;前端弹「世界发生了变化!」公告。

**Architecture:** server 新增 updater.ts(diff 影响分析 + 更新管线,复用 LevelGenerator 的出题校验);API 增加 GET /update-check 与 POST /update;前端地图屏检测 + 公告弹窗 + 更新进度。未受影响关卡与全部进度原样保留。

**设计要点(来自设计文档 §5):**
- `git diff --name-status <锚点>..HEAD` → 文件级变更集
- 关卡引用文件被修改 → stale → LLM「修订」(输入旧关卡 JSON + 相关 diff,要求最小改动)
- 引用文件被删除 → 关卡 obsolete,进度保留(completedLevels 不删)
- 新增文件达到阈值(≥3 个新文件)→ 轻量补测绘,只允许「追加」关卡
- 新/修订关卡先写临时,全部成功后原子替换 + 更新 anchorCommit

---

### Task U1: server — diff 影响分析(纯逻辑 + git)
**Files:** packages/server/src/updater.ts(新), packages/server/test/updater.test.ts(新), test/helpers.ts(增强:fixture 仓库提交变更的辅助函数)
- helpers.ts 加 `commitChange(dir, files: Record<string,string|null>, msg)`:写/删文件 + git add -A + commit。
- updater.ts 第一部分(本任务只做分析,不做 LLM):
  - `diffSince(scanner, anchor): Promise<{modified:string[];deleted:string[];added:string[]}>` — execa git diff --name-status anchor..HEAD,解析 M/D/A/R(R 视为 删+增)。
  - `analyzeImpact(course, levelFiles: Map<levelId,string[]>, diff): {staleLevels:string[];obsoleteLevels:string[];needsNewLevels:boolean}` — 纯函数:关卡引用文件 ∩ modified → stale;引用文件全被删 → obsolete(部分删除算 stale);added.length>=3 → needsNewLevels。levelFiles 来自每个 level JSON 的 files 字段。
- TDD:fixture 仓库 commit 修改 src/auth.js / 删除文件 / 新增 3 文件,断言分析结果。
- Commit: `feat(server): git diff impact analysis for incremental updates`

### Task U2: server — 更新管线(LLM 修订 + 原子切换)
**Files:** packages/server/src/updater.ts(扩展), packages/server/src/generator.ts(small refactor:把 generateLevel/verifyTask 提为可复用 — generator 已有,export 一个 `generateLevelForOutline` 或将 LevelGenerator 的方法改 public/protected 最小化), test/updater.test.ts(扩展)
- `CourseUpdater` 类(store, scanner, provider):
  - `check(): Promise<{changed:boolean;anchor:string|null;head:string|null;summary?:{modified,deleted,added 数量}}>`
  - `run(): Promise<void>`(EventEmitter 同 GenEvent 风格 + 'revise' 事件):
    1. diffSince + analyzeImpact(读取所有 level JSON 的 files)
    2. obsolete:level JSON status='obsolete' + course outline 同步(写临时见下)
    3. stale:LLM 修订 prompt = 旧 level JSON + 受影响文件的新内容(行号格式同 generator)+ 该文件相关 diff 文本(git diff anchor..HEAD -- file,截 4000 字)→ LevelDraftSchema 校验 → verifyTask 重校验引用 + 回填 hash → status 'ready'。要求 prompt 中明确「最小改动:仍然有效的任务原样保留,只更新失效的引用与内容」。失败 → 该关 status='stale' 保留旧版(可玩但任务标记源码已变化),不阻塞。
    4. needsNewLevels:轻量测绘 prompt(只给 added 文件清单 + 现有大纲)→ AppendDraftSchema(新 chapter 或挂到已有 chapter 的新 levels,只允许追加)→ 为新 outline 逐个出题(复用 generator 逻辑)。
    5. 原子切换:整个过程中新写的 level JSON 先写到 `levels-next/`,course 草稿在内存;全部成功后:把 levels-next/*.json 覆盖移动到 levels/、写 course.json、meta.anchorCommit = head。中断则 levels-next 残留无害(下次更新前清空)。
  - 进度保留:不触碰 progress.json。
- TDD(MockProvider):修改文件→关卡被修订且 hash 更新且未受影响关卡文件未动(mtime 或内容比对)、删除→obsolete、新增 3 文件→追加新关卡、anchor 前进、progress 原样、修订失败→stale 不阻塞。
- Commit: `feat(server): incremental course updater with atomic anchor switch`

### Task U3: server — 更新 API
**Files:** packages/server/src/app.ts(modify), test/app.test.ts(扩展)
- GET /api/projects/:id/update-check → CourseUpdater.check() 结果(非 git 项目 → {changed:false,reason:'not-git'})
- POST /api/projects/:id/update → 启动 updater(同 generators Map 防重复;SSE 复用 /events,updater 也 emit 'event')→ {ok}
- 测试:fixture commit 变更后 update-check changed=true;POST update 后(Mock)关卡修订完成、anchor 更新、再 check changed=false。
- Commit: `feat(server): update-check and update endpoints`

### Task U4: web — 更新公告 + 更新进度
**Files:** packages/web/src/api.ts(+updateCheck/runUpdate), screens/MapScreen.tsx(modify), components/UpdateBanner.tsx(新), screens/Generating.tsx(复用为更新进度;或 Generating 已支持 status mapping/generating —— updater 把 meta.generation.status 置 generating 即可复用), styles.css
- 地图屏 mount 时 api.updateCheck;changed → 顶部像素公告条「⚡ 世界发生了变化!仓库有 N 个文件更新」+ 「更新关卡」按钮(POST update → setScreen('generating') 复用进度屏)+「稍后再说」。
- stale 关卡节点显示「!」角标(course outline status==='stale');obsolete 节点变灰墓碑 🪦(不可点,但已通关的保留 ✓ 历史)。
- Commit: `feat(web): world-changed banner and update flow`

### Task U5: 文档 + 全量验证
**Files:** README.md(新:快速开始、架构图、玩法说明、更新机制), docs 修订
- README:npx 启动、claude CLI/API key 两种配置、游玩流程截图位、增量更新说明。
- 全量验证:vitest 全绿、两个 tsc clean、npm run build 成功、dev-mock 全流程(导入→生成→玩→commit 变更→update-check→update→地图)。
- Commit: `docs: readme with quickstart and architecture`

## 完成标准
- 仓库变更后:update-check 检出、更新只重生成受影响关卡、进度保留、锚点前进、前端公告可用
