# CodeQuest 游戏化前端 Implementation Plan (计划 2/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 构建复古像素风游戏前端(packages/web),消费计划 1 的 HTTP API,实现导入向导 → 闯关地图 → 关卡游玩(四种任务)→ 计分/徽章/证书 全流程。

**Architecture:** Vite + React 18 + TypeScript SPA;Zustand 全局状态;NES.css + Press Start 2P/Zpix 像素风(代码浏览器例外用现代等宽 + Shiki 高亮);dnd-kit 拖拽;Web Audio 实时合成 8-bit 音效;SSE 接生成进度。生产构建由 Fastify @fastify/static 托管,开发时 Vite proxy /api → 4977。

**Tech Stack:** vite, react, react-dom, zustand, shiki, @dnd-kit/core + sortable, nes.css, @fastify/static, @fastify/cors

**后端 API 契约(已实现,勿改):**
- POST /api/projects {path} → {id,name};GET /api/projects → {projects};GET /api/projects/:id → {meta,course,progress}
- POST /api/projects/:id/generate;GET /api/projects/:id/events (SSE GenEvent)
- GET /api/projects/:id/levels/:levelId → {level,freshness};GET /api/projects/:id/file?path= → {content};GET /api/projects/:id/tree → {files}
- POST /api/projects/:id/progress/level {levelId,result:{rating,accuracy,maxCombo,xp},taskCount} → {progress,newBadges}
- POST /api/projects/:id/progress/file-read {file} → {progress}
- meta.generation.status: idle|mapping|generating|done|error 是权威状态;SSE 仅作实时优化(可能错过事件,完成后连入只会收到 done)
- 任务判定与计分全部用 @code-quest/shared 纯函数(judgeQuiz/judgeTreasureHunt/judgeCallChain/judgeCodeFill/judgeCodeType/taskXp/rateLevel/levelInfo/BADGE_INFO)

---

### Task W1: web 脚手架 + API client + 状态层
**Files:** packages/web/{package.json,tsconfig.json,vite.config.ts,index.html,src/main.tsx,src/App.tsx,src/api.ts,src/store.ts,src/styles.css}
- Vite React-TS 模板手工搭(workspace 包 @code-quest/web,依赖 @code-quest/shared)
- vite.config.ts: server.proxy['/api'] → http://localhost:4977
- api.ts: 类型化 fetch 封装(用 shared 类型),subscribeEvents(id, onEvent) 封装 EventSource
- store.ts: Zustand — projectId、course、progress、当前屏幕路由(home|map|level|badges|cert)、hearts/combo 等关卡运行态
- styles.css: 引入 nes.css、Google Fonts Press Start 2P、CRT 扫描线滤镜 class(可开关)、像素风主题变量
- App.tsx: 按 store.screen 渲染对应屏幕的壳(屏幕组件后续任务填充,先放占位)
- 验证: `npm run dev -w @code-quest/web` 启动、显示占位首页;`npx tsc -p packages/web --noEmit` clean
- Commit: `feat(web): vite scaffold with api client, store, retro theme`

### Task W2: 导入向导 + 生成进度屏
**Files:** packages/web/src/screens/Home.tsx, Generating.tsx
- Home:像素风「新游戏」界面;项目列表(GET /api/projects,可继续已有进度);路径输入框 + 「开始冒险」;400 错误展示
- Generating:「世界生成中…」;SSE 点亮章节/关卡列表;level-failed 显示重试按钮(POST /generate);以轮询 GET /api/projects/:id 为兜底(2s);status done → 进入地图
- Commit: `feat(web): import wizard and generation progress screens`

### Task W3: 闯关地图 + 顶栏数值
**Files:** packages/web/src/screens/MapScreen.tsx, src/components/Hud.tsx
- 横向卷轴地图:章节分区(不同配色),关卡节点按钮:✓已通关(点亮)/ 当前可玩(闪烁动画)/ 🔒未解锁(前一关未通)/ ⚠生成失败(可重试)
- 顺序解锁规则:全课程线性顺序,第一未通关卡为「当前关」
- Hud:等级称号(levelInfo)、XP 条(nextAt 进度)、徽章数、CRT 开关
- 点击可玩节点 → store 切换到 level 屏
- Commit: `feat(web): scrolling level map with hud`

### Task W4: 关卡页 — 代码浏览器 + quiz/treasure-hunt
**Files:** packages/web/src/screens/LevelScreen.tsx, src/components/CodeBrowser.tsx, TaskPanel.tsx, tasks/QuizTask.tsx, tasks/TreasureHuntTask.tsx
- 左右分栏。左:CodeBrowser — 文件树(GET /tree 过滤本关 files 优先)+ Shiki 高亮源码、行号、点击行回调、滚动定位 API;打开文件时 POST file-read
- 右:TaskPanel — NPC 向导对话框逐字打出 narrative → 任务交互区 → 判定反馈(对/错 + explanation)
- QuizTask:选项按钮(多选 answer.length>1 时用 checkbox),judgeQuiz 判定
- TreasureHuntTask:提示 instruction/hint,玩家在 CodeBrowser 点击行 → judgeTreasureHunt;答错扣心,hint 在第一次错后显示
- freshness[taskId]===false 的任务降级为只读展示「⚠ 源码已变化」并自动视为通过(不计分)
- Commit: `feat(web): level screen with code browser, quiz and treasure-hunt tasks`

### Task W5: call-chain 拖拽 + code-fill + code-type 打字
**Files:** packages/web/src/components/tasks/CallChainTask.tsx, CodeFillTask.tsx, CodeTypeTask.tsx
- CallChain:dnd-kit sortable 卡片排序 → judgeCallChain
- CodeFill:渲染 ref 片段,blankLines 行替换为输入框 → judgeCodeFill
- CodeType:金山打字通式临摹 — 目标代码逐字符渲染,输入实时 diff 高亮(对绿错红),统计 WPM 与准确率(judgeCodeType),complete 才过
- 片段文本来源:GET /file 取全文后按 ref 行号截取(hash 已在 freshness 校验)
- Commit: `feat(web): call-chain drag, code-fill and typing tasks`

### Task W6: 计分循环 + 音效 + 徽章/证书
**Files:** packages/web/src/game/audio.ts, src/game/levelRun.ts, src/screens/BadgesScreen.tsx, CertScreen.tsx
- levelRun(store 内或独立 slice):任务顺序推进;答对 taskXp(type,combo) 累计 + combo++;答错 combo=0、hearts-1、给 hint;hearts 用尽本关重来;全部完成 → rateLevel → POST progress/level → 弹结算(评级 S/A/B/C、XP、newBadges 用 BADGE_INFO 展示)→ 回地图
- audio.ts:Web Audio 方波/三角波合成:答对叮、答错噗、升级号角、通关小调;全局静音开关
- BadgesScreen:徽章墙(已获点亮);CertScreen:graduate 后可进入,展示项目名/完成度/总评级,window.print 友好
- 章节全通过弹像素烟花(CSS animation)
- Commit: `feat(web): scoring loop, 8-bit audio, badges and certificate`

### Task W7: 生产托管 + CORS + 收尾
**Files:** packages/server/src/app.ts (modify), src/cli.ts (modify), package.json scripts
- app.ts:注册 @fastify/cors(仅 dev 宽松);若存在 packages/web/dist 则 @fastify/static 托管 + SPA fallback(非 /api 路由回 index.html)
- cli.ts 更新提示语;根 package.json 加 `build`(vite build)与 `start` 脚本
- 全量验证:`npx vitest run` 全绿;`npm run build` 成功;启动后浏览器访问完整流程可走通(用 fixture 仓库 + mock 不可行,真实跑通至少到地图屏)
- Commit: `feat(server): serve web build with spa fallback and cors`

## 完成标准
- 全部测试绿;`npm run build` 成功;`npx code-quest`(npm run dev)打开浏览器可完成:导入 → 生成 → 地图 → 玩完一关 → 结算回地图
