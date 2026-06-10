# 源界 SourceRealm

> **每个仓库,都是一个待探索的世界。**
>
> 像素风源码闯关阅读器 —— 把任意本地代码仓库变成一座可以闯关的「源码世界」:AI 测绘出世界地图,你以像素勇者的身份,在答题、寻宝、调用链追踪和打字临摹中一关关读懂它。灵感来自那个年代的「金山打字通」:寓教于乐,过关上瘾。

为什么叫「源界」?导入仓库的那一刻,屏幕上写着「**世界生成中…**」;仓库有了新提交,地图会弹出「**⚡ 世界发生了变化!**」。源码之「源」,世界之「界」——游戏里的台词,就是它的名字。

---

## 🗺 它是怎么玩的

```
导入仓库 → 世界生成中(边生成边点亮章节)→ 闯关地图 → 进入关卡 → 完成任务 → 结算 → 徽章/证书
```

AI 会为你的仓库测绘出一条由浅入深的学习路径:

| 章节 | 你将学会 |
|---|---|
| 第一章 · 初入江湖 | 项目定位、目录全景、技术栈、启动入口 |
| 第二章 · 架构探秘 | 分层与模块划分、核心抽象、依赖关系 |
| 第三章 · 业务征途 | 主业务流程逐条走通 |
| 第四章 · 设计之道 | 关键设计决策、模式运用、为什么这么写 |

每关由数个任务组成,五种玩法:

- `quiz` **剧情答题** —— 像素 NPC 讲解背景,阅读指定代码片段后做单选/多选/判断
- `treasure-hunt` **代码寻宝** —— 「找到处理登录的函数」,在代码浏览器里点中目标行
- `call-chain` **调用链追踪** —— 拖拽乱序卡片,排出真实的执行顺序
- `code-fill` **代码填空** —— 补全挖空的关键代码
- `code-type` **打字临摹** —— 金山打字通式逐字临摹,实时对错高亮 + WPM/准确率

---

## ✨ 特性

- **AI 自动生成关卡**:导入仓库后 AI 测绘大纲并逐关出题,落盘即玩,无需等待全部生成。
- **全套复古游戏感**:NES 像素风 + 可开关的 CRT 扫描线、8-bit 实时合成音效(无音频素材)、心/连击/XP、S/A/B/C 评级、徽章墙、称号晋升(见习读者 → 代码学徒 → 架构行者 → 源码宗师)、章节烟花、可打印通关证书。
- **世界会演化**:仓库出现新 commit 时,基于 git diff 做影响分析,**只重生成受影响的关卡**——修订过时的、作废删除的、追加新增的;未受影响关卡与全部进度原样保留。
- **代码是活的**:关卡不内嵌代码副本,只存 `{file, 行号区间, contentHash}` 引用,游玩时实时从仓库读取;源码变化会被自动检测并降级提示。
- **纯文件存储**:所有数据是 `~/.code-quest` 下的 JSON,可读、可手工修正、可整目录拷贝分享,无数据库。

---

## 🚀 快速开始

### 前置要求

- **Node.js >= 18.19**
- **git**(增量更新依赖 git;非 git 仓库可降级导入,但失去增量更新)
- **AI Provider**(二选一):
  - 本机已安装 [Claude Code CLI](https://claude.com/claude-code)(`claude` 命令可用),**优先使用**;或
  - 设置环境变量 `ANTHROPIC_API_KEY`

### 启动

```bash
npm install        # 安装依赖
npm run build      # 构建前端到 packages/web/dist
npm start          # 启动本地服务(默认端口 4977)并自动打开浏览器
```

浏览器打开 <http://localhost:4977>,在导入向导中**输入本地仓库的绝对路径**,世界生成完毕即可闯关。

> 修改端口:`PORT=8080 npm start`。

---

## 🔌 AI Provider 配置

启动时自动探测可用 Provider,导入向导会显示当前使用的是哪一种:

1. **Claude Code CLI(优先)** —— 检测到 `claude` 命令即使用,以 headless 模式(`claude -p --output-format json`)让 Claude 自行探索仓库,无需手动配置 key。
2. **Anthropic API(回退)** —— 设置 `ANTHROPIC_API_KEY` 后使用 SDK 调用,后端负责拼装文件上下文并以 tool-use 强制 schema。
   - 可选:`CODE_QUEST_MODEL` 覆盖默认模型(默认 `claude-opus-4-8`)。

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export CODE_QUEST_MODEL=claude-opus-4-8   # 可选
```

两者都没有时,导入前置检查会给出上述两种配置方式的引导。

---

## 🎮 规则细节

- **闯关地图**:横向卷轴,章节是不同配色的像素场景区域;关卡节点顺序解锁(已通关点亮 ✓ + 评级 / 当前关闪烁 ▶ / 未解锁 🔒)。顶栏显示等级称号、XP 条、徽章栏。
- **关卡页(左右分栏)**:左侧代码浏览器(文件树 + Shiki 语法高亮,寻宝任务在此点击作答);右侧任务面板(像素 NPC 对话式讲解 → 任务交互 → 即时判定反馈)。
- **心 / 连击 / 评级**:
  - 答对 +XP,连击系数 = `min(1 + 连击数 × 0.1, 2)`(最高 2 倍)。
  - 答错扣一颗心并给提示;心用完本关重来(任务顺序不变)。
  - 通关评级:**S** = 全对且满连击,**A** = 准确率 ≥ 0.9,**B** = ≥ 0.7,否则 **C**。重复挑战只补发更高成绩的 XP 差额,刷不了分。
- **成就**:徽章墙(「初窥门径」首关、「一气呵成」满连击、「考古学家」累计阅读 50 个文件…);全课程通关解锁可打印的**通关证书**。

> 若本地有未提交修改导致源码 hash 不匹配,相关任务降级为只读展示并提示「源码已变化」,关卡仍可通过。

---

## 🔄 世界演化:增量更新机制

每关记录了它引用的文件集合。打开地图时,对比仓库 HEAD 与课程的**锚点 commit**:

1. **检测**:不同则地图顶部弹出「⚡ 世界发生了变化!」公告,显示修改/删除/新增的文件数。点「更新关卡」启动更新管线。
2. **影响分析**(`git diff --name-status <锚点>..HEAD`):
   - 引用文件被**修改** → 关卡标记 `stale`,送 LLM「修订」(输入旧关卡 JSON + 相关 diff,要求最小改动:仍有效的任务原样保留,只更新失效引用)。
   - 引用文件全部被**删除** → 关卡 `obsolete`(地图上变灰墓碑 🪦,不可点;已通关的历史 ✓ 保留)。
   - **新增**文件达到阈值(≥ 3 个)→ 轻量重新测绘,只允许「追加」新关卡,不改动旧大纲。
3. **原子切换**:所有新/修订关卡先写临时目录 `levels-next/`,全部成功后原子替换到 `levels/` 并把锚点前进到 HEAD。中断则临时目录残留无害,下次更新前清空 —— 不存在半更新状态。

未受影响的关卡与**全部已有进度原样保留**(不触碰 `progress.json`)。

---

## 🏗 架构

```
┌────────────────────── 浏览器 (React + Vite + TS) ──────────────────────┐
│  导入向导    闯关地图(像素风)    关卡页(代码浏览器+任务面板)    成就/证书  │
└────────────────────────────┬──────────────────────────────────────────┘
                    HTTP + SSE(生成进度实时推送)
┌────────────────────────────┴──────────────────────────────────────────┐
│                     本地 Node 服务 (Fastify + TS)                      │
│                                                                        │
│  RepoScanner        LevelGenerator       LLMProvider      ProgressStore│
│  目录树/git信息       生成管线/增量更新      claude CLI⇄API    进度/XP/徽章 │
└────────────────────────────┬───────────────────────────────────────────┘
                             ▼
              ~/.code-quest/<projectId>/
                ├─ project.json   仓库路径、commit 锚点、元信息
                ├─ course.json    课程大纲:章节 → 关卡
                ├─ levels/*.json  每关的任务、题目、代码引用
                └─ progress.json  闯关进度、XP、徽章
```

> 「源界 SourceRealm」是产品名;代码内部的包名/数据目录沿用工程标识 `code-quest`(`@code-quest/*`、`~/.code-quest`)。

### 目录结构

```
sourcerealm/
├─ packages/
│  ├─ shared/   共享 TS 类型 + zod schema、判定与计分纯函数(judge / scoring)
│  ├─ server/   Fastify 后端
│  │  ├─ src/
│  │  │  ├─ app.ts        HTTP/SSE API
│  │  │  ├─ cli.ts        启动入口(npm start)
│  │  │  ├─ scanner.ts    仓库扫描 / git 信息 / 文件读取
│  │  │  ├─ generator.ts  AI 生成管线(测绘 + 出题 + 校验)
│  │  │  ├─ updater.ts    增量更新(diff 影响分析 + 修订 + 原子切换)
│  │  │  ├─ providers.ts  LLMProvider(claude CLI / Anthropic API / Mock)
│  │  │  └─ store.ts      ~/.code-quest JSON 读写
│  │  └─ scripts/         smoke.ts(真实 Provider 冒烟)、dev-mock.ts(Mock 全流程)
│  └─ web/      React + Vite 前端
│     └─ src/
│        ├─ screens/      Home / Generating / Map / Level / Badges / Cert
│        ├─ components/   CodeBrowser、TaskPanel、Hud、UpdateBanner …
│        └─ game/         音效合成(audio.ts)、闯关运行时(run.ts)
└─ docs/        设计文档与实现计划
```

---

## 🛠 开发

数据目录默认在 `~/.code-quest`(可用环境变量 `CODE_QUEST_HOME` 覆盖,便于隔离测试)。

### 开发模式

需要真实 AI Provider(claude CLI 或 API key)时,开两个终端:

```bash
# 终端 1:后端
npm run dev -w @code-quest/server

# 终端 2:前端(vite dev,自动代理 /api 到后端)
npm run dev -w @code-quest/web
```

无需真实 LLM 时,用 Mock 全流程开发服务器(内置 fixture 仓库 + 预设 JSON,跑通导入→生成→玩→增量更新):

```bash
PORT=4977 npm run dev-mock -w @code-quest/server
# 控制台会打印 fixture 仓库路径,在前端导入向导中填入即可
```

### 测试与冒烟

```bash
npm test                              # Vitest 全量单元/集成测试
npm run smoke -w @code-quest/server   # 用真实 Provider 做一次最小冒烟,验证可产出合法 JSON
```

测试覆盖:四类任务判定纯函数、XP/连击/评级计算、diff → 关卡影响分析、代码引用校验、schema 校验,以及内置 fixture git 仓库 + Mock Provider 跑通「导入 → 生成 → 游玩 → commit 变更 → 增量更新」全链路。真实 LLM 调用不进 CI,保留为手动冒烟脚本。

---

## 📦 范围边界(第一版不做)

公网部署 / 多用户 / 鉴权、Git URL 克隆或 zip 上传(仅本地路径)、关卡包导出分享、移动端适配。
