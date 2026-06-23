# SourceRealm Agent 开发学习与重构方案

> 本文档用于系统性学习 Agent 开发，并作为 SourceRealm 从“内嵌 Claude Code CLI”演进到“可控 Agent 系统”的调研与实施草案。它不是最终架构决策记录，后续应在 PoC、验证和 review 后再沉淀到 `llmdoc/`。

## 0. 文档目标

SourceRealm 当前是一个本地源码闯关游戏：用户导入本地仓库，服务端扫描仓库并调用 AI 生成课程大纲和关卡，前端以地图和任务形式引导用户阅读源码。

当前 AI 接入方式主要有两种：

- `ClaudeCliProvider`：通过 `claude -p --input-format text --output-format json` 子进程调用 Claude Code CLI，让 Claude 自主读取仓库。
- `AnthropicApiProvider`：通过 Anthropic SDK 调用模型，由服务端把源码片段、diff 等上下文内嵌到 prompt。

这套实现已经能工作，但 Agent 能力主要隐藏在 Claude Code CLI 内部，不利于系统性学习 Agent 开发，也不利于后续扩展 memory、tools、MCP、skills、compact、permission control、RAG 和可观测性。

本文档分成两个主部分：

1. 标准 Agent 开发工作流程：用于系统性学习 Agent 应该如何设计。
2. SourceRealm Agent 化方案：用于把当前项目重构成受控、可观测、可扩展的 Agent 系统。

> 补充说明：本文档在初版基础上补充了 9 个关键工程专题——prompt caching、Agent loop 终止控制、memory 增长治理与存储介质、每轮 loop 的 context 装配、性能评估、延迟/TTFT 优化、Model Gateway、MCP Gateway、单/多 Agent 架构。这些专题分别落在「第 1 部分 标准流程」（通用方法论）和「第 2 部分起 的 SourceRealm 落地方案」（结合项目）。其中涉及具体数值、阈值与外部实践的部分附了来源链接。本文档仍属调研草案，不是最终架构决策记录。

## 1. 标准 Agent 开发工作流程

### 1.1 定义 Agent 的任务边界

开发 Agent 前，先不要急着接模型或框架，而要明确：

- Agent 的用户目标是什么。
- 输入是什么，输出是什么。
- 哪些事情由 Agent 决定，哪些事情由确定性程序决定。
- Agent 可以调用哪些工具。
- Agent 不能做什么。
- 失败时如何降级、重试或交给人工确认。

一个好的 Agent 不应该是“模型随便想办法完成任务”，而应该是：

- 目标明确；
- 工具明确；
- 权限明确；
- 输出可校验；
- 过程可追踪；
- 失败可恢复。

### 1.2 区分确定性逻辑和 Agent 逻辑

Agent 适合处理：

- 理解意图；
- 分析代码；
- 规划阅读路径；
- 生成解释；
- 生成候选结构化内容；
- 根据错误反馈修正输出；
- 在多个工具之间选择下一步行动。

确定性程序应该负责：

- schema 校验；
- 权限检查；
- 文件写入；
- 原子切换；
- 引用校验；
- hash 回填；
- 进度合并；
- 数据持久化；
- 可恢复状态管理。

对于 SourceRealm，这意味着 Agent 可以生成课程大纲草稿、关卡草稿和修订草稿，但最终能不能写入 `course.json`、`levels/*.json`，必须由 zod schema、引用校验、`ProjectStore` 和确定性流程决定。

### 1.3 设计 Agent Harness

Agent Harness 是承载 Agent 的运行环境，通常包含：

- **Model**：底层模型和 provider 选择。
- **Prompt / System Instruction**：任务说明、行为边界、输出要求。
- **Tools**：可调用工具，例如读文件、搜索代码、读取 git diff。
- **Memory**：短期上下文、长期记忆、项目知识、用户偏好。
- **Context Management**：上下文裁剪、摘要、compact、大结果 offload。
- **Permission Control**：工具权限、文件权限、命令白名单、人工确认。
- **Structured Output**：schema、校验、重试、修复。
- **Observability**：trace、日志、工具调用、token、耗时、成本、失败原因。
- **Evaluation**：fixture、mock、回放测试、真实模型 smoke。

Agent 开发的重点不是“把 prompt 写长”，而是把这些模块设计清楚。

> Harness 中与“运行时控制”强相关的两块——loop 终止控制（§1.9）和单/多 Agent 架构选择（§1.13）——单独展开，见后文对应小节。

### 1.4 建立 typed tools

工具是 Agent 和外部世界交互的边界。工具应该具备：

- 明确名称；
- 明确输入 schema；
- 明确输出 schema；
- 超时；
- 错误类型；
- 权限检查；
- 审计日志；
- 可测试性；
- 最小权限。

常见错误是直接把 shell、文件系统、数据库、网络完全暴露给模型。更好的做法是把能力封装成小工具，例如：

- `list_files`
- `read_file`
- `grep_code`
- `read_ref`
- `git_diff_since`
- `verify_task_refs`
- `summarize_file`
- `emit_course_draft`
- `emit_level_draft`

Agent 通过工具获得信息和产出候选结果，但不能绕过系统直接修改业务真相源。

### 1.5 设计 memory

Memory 不是单一概念，至少要拆成几类：

- **短期 memory**：单次任务内的消息、工具结果、摘要、当前进度。
- **运行态 checkpoint**：任务执行到哪一步，服务重启后能否恢复。
- **长期 memory**：跨任务保存的用户偏好、项目经验、失败模式。
- **程序性 memory / skills**：如何完成某类任务的流程说明。
- **语义 memory**：通过检索找到相关历史经验或项目知识。

Memory 的关键设计问题：

- 什么可以写入长期 memory；
- 什么必须只保留在本次 run；
- 是否允许保存用户源码；
- memory 写入是否需要人工确认；
- memory 如何过期、压缩、删除；
- memory 如何被检索和加载。

#### memory 越存越长怎么办（增长治理）

memory 不做治理一定会膨胀，最终拖慢检索、撑爆上下文、增加成本。常见治理策略：

- **分层冷热**：hot（本次 run 活跃上下文）、warm（近期可复用摘要）、cold（归档，按需检索）。只有 hot 默认进 prompt。
- **TTL / 过期**：run-level trace 设保留期，过期归档或清理；长期 memory 定期复审。
- **摘要压缩**：阶段结束后把长历史摘要成关键事实，丢弃原始消息（与 §1.6 compact 协同）。
- **重要性打分 + 上限**：给每条 memory 打分，超过条目上限时淘汰低分项，避免无限增长。
- **去重**：写入前与已有 memory 比对，重复/近似的合并，不重复堆叠。
- **按需检索而非全量加载**：长期 memory 用检索（关键词/语义）挑相关条目注入，而不是每轮把全部 memory 塞进 prompt。

#### 存储介质如何选（选型原则）

不要一上来就引入重型数据库，按"是否需要查询 / 并发 / 恢复 / 语义检索"逐级升级：

- **本地文件（JSON / JSONL）**：单机、低并发、可人工检查时的默认选择，也是 SourceRealm 当前业务真相源的形态。
- **嵌入式数据库（如 SQLite）**：当需要按条件查询、聚合统计（如评估指标、trace 分析）、单机持久化时再引入。
- **内存 / 内存数据库（如 Redis）**：仅在多进程共享短期状态、限流、跨进程 checkpoint 等场景需要；不适合作长期可审计存储。
- **向量数据库**：只为语义检索（RAG）服务，不应承载结构化状态或业务真相源。

SourceRealm 的具体介质决策矩阵见 §3.4 与 §5.5。

### 1.6 设计 compact / context compression

长任务会遇到上下文膨胀：

- 文件树很大；
- 源码文件很长；
- git diff 很大；
- 工具结果很多；
- 多关卡生成历史很长；
- schema 重试会不断拼接错误信息。

Compact 要解决的是：

- 降低 token 成本；
- 降低延迟；
- 避免模型被旧上下文干扰；
- 保留关键事实；
- 让长任务可持续运行。

常见策略：

- 大工具结果写入 scratch 文件；
- prompt 中只保留摘要和路径；
- 按需再读取具体片段；
- 每个阶段结束后摘要历史；
- 对失败重试只保留最近、最关键的错误；
- 对文件内容只保留相关片段和行号。

### 1.7 设计 permission control

Agent 权限应该默认收紧：

- 默认只读；
- 写文件需要明确范围；
- shell 命令必须白名单；
- 网络访问必须明确；
- 删除、覆盖、批量修改需要人工确认；
- 外部 MCP server 需要信任边界；
- 用户源码不应默认进入长期 memory 或外部服务。

权限控制最好不只写在 prompt 里，而要在工具层和文件系统层强制执行。

可参考 Claude Code 的公开机制：`CLAUDE.md` / 项目 memory 负责提供上下文，不是强制策略；工具权限、确认、hook、sandbox 和 managed settings 才是强制边界。换句话说，LLM 和仓库文档只能提出意图，Agent harness 才能决定权限。

具体原则：

- deny 优先于 allow；
- 仓库内配置只能收紧或提供上下文，不能提升权限；
- 用户请求“忽略上文”时，最多只忽略之前的用户层输入，不能忽略 system、tool policy、schema、全局指导文件和权限边界；
- 工具执行前必须有类似 `PreToolUse` 的策略检查点：校验工具名、参数、虚拟路径、capability、预算和人工确认状态；
- 模型 API key、外部工具 token、MCP 凭证只能由 harness / provider / tool adapter 持有，不进 prompt，不交给模型。

### 1.8 设计 RAG 和 Agentic RAG

RAG 是 Retrieval-Augmented Generation，即检索增强生成。它不是 memory 的全部，也不是 Agent 的全部。

常见形态：

- **2-step RAG**：系统先检索相关文档，再把结果交给模型生成。
- **Agentic RAG**：Agent 自己决定何时检索、检索什么、是否继续追问和验证。
- **Hybrid RAG**：固定检索和 Agent 自主检索结合，并加入验证、自纠错步骤。

普通 RAG 适合：

- FAQ；
- 文档问答；
- 固定知识库；
- 用户问题和答案资料之间有稳定匹配关系的场景。

Hybrid RAG 适合：

- 既有稳定知识库，又需要继续探索和验证的任务；
- 文档、规范、历史 incident 可以提供起点，但仍要读取真实代码、日志、diff 或运行态证据的问题；
- 企业知识库问答、复杂排障、代码仓库理解、报告生成等需要“固定检索 + 按需追查”的场景；
- 需要先加载高价值参考资料，再让 Agent 根据中间结果决定是否继续 grep / read file / git diff / verify 的任务。

Agentic RAG 适合：

- 代码仓库理解；
- 多步探索；
- 需要 grep / read file / git diff / verify 的任务；
- 需要根据中间结果继续决定下一步的任务。

SourceRealm 不适合只做传统“先 embedding 全仓库，再一次性检索”的 2-step RAG。更合理的是 Hybrid RAG：先加载 `llmdoc`、README、项目结构摘要、课程生成规则等稳定参考资料，再让 Agent 按需调用 grep / read file / git diff / verify 继续探索真实仓库；其中自主决定下一步检索和验证的部分，体现 Agentic RAG。

### 1.9 设计 Agent Loop 与终止条件

一旦 Agent 从“线性脚本”变成“自主决定下一步”的 loop（如 ReAct：思考 → 调用工具 → 观察结果 → 再思考），就必须解决一个核心风险：**死循环 / 失控消耗**。这不是边界情况，而是生产常见问题——业界有真实案例：Agent 对同一个 `read_file` 连续调用 47 次、零进度，烧掉 \$12。[来源: StuckLoopDetection - https://dev.to/deenuu1/stuckloopdetection-how-we-stopped-an-agent-burning-12-on-47-identical-calls-52ac]

根本原因是 Agent 无法自行判断“我们在进展吗”，容易用相同参数重复调用同一工具而不自知。因此终止控制要做**多层防御**，任何一层触发都强制停止：

1. **硬迭代上限（max iterations / step cap）**：即使 Agent 声称“还要继续”也强制停。常见默认：LangChain AgentExecutor 15、多 Agent 系统常见 30；经验推荐 10–20，成本敏感场景取 5–10。注意：过多迭代反而会让模型“过思考”而退化——有基准观察到任务成功率在 15–20 步附近见顶。
2. **token / cost 预算**：为每个任务设固定预算，每次工具调用后累计，超预算立即停。经验区间：简单任务 5K–10K、中等 20K–50K、复杂 50K–100K+ tokens；用 cost 上限（如 \$0.5–\$5/任务）更精确，因为 token 单价随模型变化。Anthropic 提供 `task_budget`（beta，Fable5/Opus4.7/4.8），让模型看到剩余预算倒计时并自我节制——这与 `max_tokens`（模型无感知的强制上限）是两回事。
3. **无进度检测 / stall detection（必须“结果感知”）**：识别三种停滞——① 同工具 + 同参数 + **同输出哈希**重复；② A→B→A→B 的 ping-pong；③ 同一工具连续失败 streak。关键：单纯计数重复调用会误杀合法轮询，必须用输出哈希区分——同输入但**输出变了**＝有进度，输出不变＝停滞。建议追踪最近 5–10 步滚动窗口，连续 2–3 次重复即退出，连续失败 3 次即停。
4. **目标达成判定（goal satisfaction）**：定义清晰的 success criteria（如“引用全部校验通过”“task status=completed”），每 N 步检查一次，满足即提前停。显式判定优于让 Agent 自我反思“我完成了吗”（后者可能幻觉）。
5. **超时（wall-clock timeout）**：独立于步数和 token 的绝对时间限制，防止僵尸 Agent 运行数小时。经验：简单 10–30s、中等 30–120s、复杂 2–5min。
6. **人工中断 + 预警**：长任务提供可中断接口；预算到 80% 时告警但不停。

一个可直接套用的综合默认配置：

```txt
max iterations : 15
token budget   : 50,000 tokens（或 cost 上限 $2）
stall window   : 最近 5 步；连续重复 2–3 次即停
failure streak : 连续失败 3 次即停
timeout        : 120s
alert          : 预算/时间到 80% 告警
```

[来源: Agentic Loops: From ReAct to Loop Engineering 2026 - https://datasciencedojo.com/blog/agentic-loops-explained-from-react-to-loop-engineering-2026-guide/ ；How to Prevent AI Agent Reasoning Loops - https://dev.to/aws/how-to-prevent-ai-agent-reasoning-loops-from-wasting-tokens-2652]

### 1.10 设计每轮 Loop 的 Context 装配

Agent loop 的每一轮都要重新组装一份发给模型的上下文。装配什么、按什么顺序排，直接决定**正确率、token 成本和缓存命中率**。建议把每轮 context 拆成“稳定前缀”和“volatile 后缀”两段，并严格按此顺序排列（理由见 §1.11，前缀稳定才能命中 prompt cache）：

同时要参考 Claude Code 这类 Agent runtime 的安全分层思路：**tool definitions / tool policy → system prompt → user/content prompt**。工具定义、权限、可写范围、schema 输出约束等必须由工具层和 system 层定义，用户输入、仓库 README、CLAUDE.md、AGENTS.md、源码注释、diff 和工具结果只能作为待分析内容进入 user/content 层，不能覆盖前面的规则。若仓库内容里出现“忽略上文”“调用某工具”“泄露隐藏提示词”“放宽 schema”等指令，应视为 prompt injection 内容，而不是新的系统规则。

**稳定前缀（几乎每轮不变，放最前、打缓存断点）**

- 工具定义（名称、输入输出 schema）——保持确定性顺序，不要每轮重排；
- system / 角色与行为边界 / 输出格式约束；
- skills / 程序性说明；
- 任务无关的环境快照（如项目结构、全局指导文件摘要、README 摘要）。

**volatile 后缀（每轮变化，放最后）**

- 当前目标 / 子任务描述；
- 当前阶段与进度状态；
- **预算余量**（剩余步数 / 剩余 token）——让模型知道还能做多少；
- 压缩后的历史摘要（不是原始全历史）；
- 最近 N 步的工具结果（大结果 offload 到 scratch 文件，prompt 里只留摘要 + 路径，见 §1.6）；
- 上一次的错误反馈（如 schema 校验失败信息）；
- 输出 schema 要求。

核心原则：**工具和系统边界先于用户内容，稳定的放前面以命中缓存，volatile 的放后面；大结果不进 prompt**。漏带预算余量、把全量历史塞进去、每轮重排工具定义、把仓库文档当成高优先级系统指令，是常见反模式。

### 1.11 设计 Prompt Caching 与 Token 成本控制

在 Agent loop 里，**input token 往往主导成本**——每一轮都要把系统指令、工具定义、历史重新发给模型。Prompt caching 是降本和降延迟最有效的手段之一。

**原理（前缀匹配）**：缓存按前缀匹配，渲染顺序是 `tools` → `system` → `messages`。前缀中**任意字节变化**都会让其后的缓存全部失效。因此设计上要：把稳定内容（冻结的 system、确定性的工具列表、仓库快照）放前面并打 `cache_control` 断点；把 volatile 内容（具体问题、错误反馈、时间戳、每请求 ID）放在最后一个断点之后。[来源: Anthropic Prompt Caching - https://platform.claude.com/docs/en/build-with-claude/prompt-caching]

**约束**：每请求最多 4 个断点；最小可缓存前缀约 1024 tokens（更短不会缓存）；缓存写入成本 1.25x（5min TTL）/ 2.0x（1h TTL），命中读取仅 0.1x，高频场景很快回本。

**验证**：用响应里的 `usage.cache_read_input_tokens` 确认命中。若多次请求它一直是 0，说明有“静默失效源”——常见元凶：system 里的 `Date.now()`、未排序的 JSON、每轮变化的工具集。

**TypeScript 示例（`@anthropic-ai/sdk`）**：

```ts
const message = await client.messages.create({
  model,
  max_tokens,
  // 稳定前缀打断点：角色/风格冻结在前，仓库快照打 cache_control
  system: [
    { type: 'text', text: SYSTEM_PROMPT },
    { type: 'text', text: repoTreeAndReadme, cache_control: { type: 'ephemeral' } },
  ],
  tools,                                   // 工具定义保持确定性顺序
  // volatile 内容放断点之后，不破坏前缀
  messages: [{ role: 'user', content: [{ type: 'text', text: levelGoalAndEmbeddedCode }] }],
})
```

**与重试 / compact 的关系**：schema 校验失败后重试时，应把错误反馈作为**追加的新消息**，而不是重写整段 prompt——后者会改变前缀、让缓存全失效。compact（§1.6）负责压缩历史降总量，caching 负责降重复前缀的成本，两者互补。

**收益参考**：Claude Code 实测约 92% 命中、约 81% 成本下降；动态环境典型命中 30%–70%，高度优化的固定任务可达 90%+。[来源: How We Cut LLM Costs with Prompt Caching - https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching]

### 1.12 设计延迟与吞吐优化（TTFT / E2E）

先区分几个指标，否则会优化错方向：[来源: Redis - TTFT Meaning - https://redis.io/blog/ttft-meaning/ ；Anyscale LLM serving metrics - https://docs.anyscale.com/llm/serving/benchmarking/metrics]

- **TTFT（Time To First Token）**：从请求到第一个输出 token 的时间，= 排队 + prefill（处理输入）；主导交互式应用的“感知响应速度”。
- **TPOT / ITL**：生成每个后续 token 的平均时间，影响流式输出的平顺度。
- **E2E latency**：拿到完整结果的总时间 = TTFT + 生成时间；主导**后台批量任务**的体验。
- **吞吐（TPS / RPS）**：单位时间生成的 token / 处理的请求数。

**降低延迟的工程手段**：

- **streaming**：本身不降低 TTFT（prefill 工作量不变），但让用户更早看到输出、改善感知；长输入/长输出或大 `max_tokens` 时**必须用流式**以避免 HTTP 超时。
- **prompt caching 预热**：用 `max_tokens: 0` + `cache_control` 预热缓存可消除冷启动未命中，显著降 TTFT（官方示例 100K token：11.5s → 2.4s，约降 85%）。[来源: Anthropic Prompt Caching]
- **减少输入 token**：TTFT 与输入长度近似线性，经验上每多 500 输入 token，TTFT 增加约 20–30ms。
- **不启用 extended thinking**（非推理类任务）：thinking 会显著增加延迟（经验：5K thinking token 约增 5–15s）。
- **模型选择**：小模型更快——Haiku 类 TTFT 常 <500ms、约比大模型快 4–5×、成本约 1/10，质量够用时可换。
- **连接复用**：HTTP keepalive 省掉重复 TLS 握手。

**交互式 vs 后台任务的优化重点不同**：交互式聊天以 TTFT 为先；而“后台生成 + 进度反馈（如 SSE）”类应用，用户等的是完整结果，应**优先优化 E2E 和吞吐**——鼓励并发/批处理、cache 预热价值最大、可接受较长生成、避免 thinking。流式/SSE 连接要配 15–30s 的 heartbeat（`:ping`）防止中间件断连。

**监控**：用 P50 / P95 / P99 而非均值；分解监控 TTFT（排队 + prefill）与 E2E（TTFT + TPOT×输出 token）。所有百分位同时上升＝资源不足；仅 P99 上升＝排队竞争，需负载均衡。[来源: LLM Inference SLO Engineering - https://www.spheron.network/blog/llm-inference-slo-ttft-itl-latency-budget-guide-2026/]

### 1.13 设计单 Agent 与多 Agent 架构

不要默认“多 Agent 更高级”。Anthropic 的官方建议很明确：**从最简单的方案开始，只有当更简单的方案力不从心时，才升级到多步骤 / 多 Agent 系统**。[来源: Anthropic - Building effective agents - https://www.anthropic.com/news/building-effective-agents]

**常见架构模式**：

- **单 Agent + 工具**：一个 LLM 通过工具调用循环完成任务。开销最低，适合线性、单领域、上下文放得下、状态一致性要求高的任务。
- **Orchestrator–Workers / Lead–Subagents**：编排者拆分任务、分派给多个子 Agent，每个子 Agent 在**隔离的上下文窗口**里独立执行、只回传压缩摘要。适合可并行分解、且子任务需要上下文隔离以省 token 的场景。
- **Supervisor / Hierarchical**：监督者用 LLM 推理动态路由到最合适的专家 Agent；路由更精确但每次多一次 LLM 调用，适合任务类型运行时才确定的情况。
- **Swarm / Handoff（OpenAI Agents SDK 风格）**：对等专家 Agent 之间自行交接、转移完整历史；无中央协调、更快但缺全局视角，适合对话式、开放式工作流。
- **Workflow（确定性编排）vs Autonomous Agent（自主循环）**：前者每步预定义、可预测可审计、易容错；后者灵活自适应但难调试。多数生产系统用“Agentic Workflow”——在确定性 workflow 的步骤内嵌入 Agent 推理。

**多 Agent 的真实代价（决定要不要上的关键）**：

- **token 开销大**：Anthropic 多 Agent research 系统经验，token 用量约为单 Agent chat 的 **15×**（不同设计整体范围 4–220×）。[来源: Anthropic - Building a multi-agent research system - https://www.anthropic.com/engineering/multi-agent-research-system]
- **协调容易失败**：对 1642 条多 Agent 执行轨迹的研究显示故障率 41%–86.7%，**最大类是协调故障（约 36.9%）**——子 Agent 误解模糊指令、重复劳动、分工失效。[来源: Augment Code - Single-Agent vs Multi-Agent - https://www.augmentcode.com/guides/single-agent-vs-multi-agent-ai]
- **顺序任务会退化**：多 Agent 在可并行任务上有收益（研究报告 +81%），但在强顺序依赖任务上性能可下降 39–70%。

**何时真正值得用多 Agent**：任务可并行分解 + 子任务需隔离上下文窗口 + 需要不同专长/角色 + 探索空间超出单一上下文（如深度研究）。

**关键澄清：并行 ≠ 多 Agent**。并发跑“同一种逻辑”（如对 100 个独立分片用同一 prompt）只是**并行执行**，用简单的并发控制即可，不需要异质 Agent 协作。同质子任务的并行，用“编排者 + 并行同质 worker / subagent”这种轻量形态就够，避免异质 agent team 的协调复杂度。SourceRealm 自身的判断见 §5.12。

### 1.14 设计接入治理层：Model Gateway 与 MCP Gateway

随着 provider、模型、工具变多，需要在应用和外部能力之间加一层“接入治理”。它有两种互补的形态：

**Model Gateway（LLM / AI Gateway）**——治理“调用哪个模型”。职责：多 provider/model 统一接入与路由、failover/重试、限流配额、成本追踪与预算、缓存（含语义缓存）、API key 集中托管、可观测与审计。主流方案：

- **LiteLLM**：开源自托管，100+ provider 的 OpenAI 兼容接口，成本追踪/虚拟 key 强；核心是 Python，Node 通过 REST 调用。[https://github.com/BerriAI/litellm]
- **Portkey**：SaaS（可自托管），TS SDK 一级支持、语义缓存、提示版本管理，并自带 MCP Gateway。[https://portkey.ai]
- **Cloudflare AI Gateway**：边缘缓存，适合已在 Cloudflare 生态者。
- **OpenRouter**：400+ 模型聚合器，适合原型/多模型快速试。
- **Kong AI Gateway**：企业级 API 网关扩展 AI 能力，偏大型生态。
- （Helicone 已被收购、不再迭代，不建议新项目采用。）

**MCP Gateway**——治理“调用哪个工具”。MCP（Model Context Protocol）是 Anthropic 提出的工具/资源接入开放标准；MCP Gateway 是它的聚合与控制平面，职责：聚合多个 MCP server、统一工具发现、命名空间/工具名冲突处理、认证与凭证集中、RBAC 权限与审计、限流、以及安全边界（防 prompt injection / 工具投毒）。主流：Docker MCP Gateway（官方、Compose 编排、容器隔离）、MetaMCP、Portkey MCP Gateway。[来源: Docker MCP Gateway - https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway/ ；OWASP MCP Security Cheat Sheet]

**两者关系**：不是竞争，而是分层——Model Gateway 优化 LLM 接入层，MCP Gateway 优化工具接入层，可共存：

```txt
应用 → Model Gateway → LLM → (tool calling) → MCP Gateway → MCP servers
```

**通用取舍原则**：单 provider、单应用、单机场景，自建轻量代理（甚至只是一个 base URL 中转）即可，**不必引入完整 gateway**；当出现“多 provider 路由 / 团队级成本预算 / 跨应用共享工具 / 多租户权限隔离 / 生产审计”等信号时，再分别升级 Model Gateway 与 MCP Gateway。SourceRealm 的具体判断见 §5.1 与 §5.13。

### 1.15 设计评估与测试

Agent 测试不能只依赖真实模型。建议分层：

- 工具单测：验证工具输入输出、权限、错误处理。
- schema 单测：验证结构化输出和错误提示。
- mock model 测试：稳定回归，不依赖真实模型。
- fixture repo e2e：用小型测试仓库跑完整流程。
- trace replay：把历史失败输入回放，验证修复是否有效。
- smoke test：真实模型手动冒烟，不进 CI。
- 质量评估：统计引用校验失败率、生成成功率、任务类型分布、重复题比例。

#### 指标体系（怎么算 + 经验阈值）

评估 Agent 不能只看“最后对不对”，要分维度量化。以下阈值多为业界经验值，已标注来源：

- **任务成功率 TSR** = 成功任务数 / 总任务数。Anthropic 建议**关注最终结果而非中间路径**，允许多种有效解法，评估才不会因 Agent 重构而脆裂。[来源: Anthropic - Writing Tools for Agents - https://www.anthropic.com/engineering/writing-tools-for-agents]
- **工具调用质量**：工具选择准确率（选对工具 / 总调用）、参数正确性（schema 合规 + 语义合理）、Precision / Recall / F1、无效与冗余调用率。大量重复调用通常意味着分页/上限配置不当；大量参数错误通常意味着工具描述不清。
- **轨迹评估（trajectory）**：评估中间步骤而非只看终点——工具调用顺序正确性、轨迹效率（实际步数 vs 最短必需步数、是否有冗余绕路）、与 golden trajectory 对比。[来源: TRAJECT-Bench - https://arxiv.org/pdf/2510.04550]
- **输出有效性**：结构化输出 schema **一次通过率**（未优化基线约 70%–85%，优化后可 >90%）、引用/grounding 校验通过率、幻觉率 / faithfulness（输出是否被上下文支持）。
- **效率与成本**：input/output token 分别统计、cost per task、**cost per successful task（更关键的财务指标）**、prompt cache 命中率（动态 30%–70%、优化 90%+）、平均工具调用次数、平均迭代步数、延迟 P50/P95/P99。“过量 token”告警经验阈值：超过 baseline 的 150%。注意 agentic 方法通常比零样本多消耗 5–10× token。[来源: How Do AI Agents Spend Your Money? - https://arxiv.org/pdf/2604.22750]
- **稳定性**：对同一任务跑 N≥20 次，算成功率/步数的变异系数；稳定 Agent 经验上成功率 std <5%、步数 std <10%。回归 gate：成功率下降 >5% 或 cost/task 上升 >15% 即告警。

#### 评估方法论

- **离线 golden set**：精选标注集，相当于单元测试，部署前抓回归。规模：快速迭代最小 100–200、充分评估 500–2000。
- **LLM-as-a-judge**：用模型当裁判评主观维度（语气、忠实度、完成度）。**pairwise 比较比绝对打分更可靠**；与人评一致性目标 ≥80%（GPT-4 级 judge 约 85%，人类彼此基线约 81%）；用 balanced permutation 消位置偏差，用 50–200 条人标校准 judge 偏好。[来源: LangChain - Calibrate LLM-as-Judge - https://www.langchain.com/resources/llm-as-a-judge]
- **其他手段分工**：人评（关键流程/合规）、A/B（生产对比版本）、回归测试（每次改动）、mock replay / trace replay（无副作用复现）、smoke（部署前健康检查）。因 LLM 非确定性，回归不能断言精确字符串，要用自然语言“行为契约”。
- **在线 vs 离线**：离线抓已知 edge case、成本低；在线（生产采样）抓未预见场景与 drift，配阈值告警。

#### 评估工具（TS/Node 适配）

- **LangSmith**（LangChain）：framework-agnostic，支持离线/在线 evals 与 Agent 轨迹评估（开源 AgentEvals 包）。[https://docs.langchain.com/langsmith/evaluation]
- **Braintrust**：2026 推出 agent eval 套件 + regression gates。
- **DeepEval**：开源，已发布 TypeScript 版；偏 component-level 诊断。
- **Mastra evals**：TypeScript 原生，model-graded / rule-based / statistical 三类评分。
- **Ragas**：偏 RAG faithfulness。
- **OpenAI Evals**：注意官方计划于 2026-11-30 关停，不建议新项目采用。

## 2. 框架调研与选型

### 2.1 LangChain

LangChain 是通用 LLM / Agent 应用框架。它提供模型适配、tool calling、structured output、middleware、memory、retrieval、MCP 等能力。

适合场景：

- 想快速搭建一个通用 Agent；
- 需要模型和工具的统一抽象；
- 需要 structured output；
- 需要和 retrieval、MCP、middleware 组合；
- 复杂状态机需求还不强。

对 SourceRealm 的意义：

- 可以作为最小替换方案，把当前 `LLMProvider` 后面换成 LangChain `createAgent`。
- 改动相对小。
- 但如果要完整学习长任务、文件系统、compact、skills、权限等 Agent 工程能力，LangChain 本身还需要配合更多自定义代码或 LangGraph / Deep Agents。

参考：

- https://docs.langchain.com/oss/javascript/langchain/overview
- https://docs.langchain.com/oss/javascript/langchain/agents

### 2.2 LangGraph

LangGraph 是面向长任务、状态化 Agent 的底层编排框架，重点是：

- durable execution；
- persistence；
- streaming；
- human-in-the-loop；
- memory；
- 显式状态图；
- 多节点工作流；
- 可恢复执行。

适合场景：

- 多步骤流程；
- 长任务；
- 需要中断和恢复；
- 需要显式状态；
- 需要人工确认节点；
- 需要稳定生产运行。

对 SourceRealm 的意义：

- `mapping -> generate level -> verify -> retry -> write -> update -> promote` 很适合图化。
- `CourseUpdater` 的增量修订、stale/obsolete/append 也适合做成显式流程。
- 但如果一开始就引入 LangGraph，学习成本和重构面会比较大。

参考：

- https://docs.langchain.com/oss/javascript/langgraph/overview

### 2.3 Deep Agents

Deep Agents 是 LangChain 生态里更完整的 Agent Harness。它面向复杂多步 Agent，强调：

- planning；
- todo；
- filesystem；
- context compression；
- subagents；
- MCP；
- memory；
- skills；
- backend；
- sandbox / permission 设计。

适合场景：

- 想系统学习完整 Agent 开发流程；
- 任务需要长上下文；
- Agent 需要读写 scratch 文件；
- Agent 需要多步规划；
- Agent 需要 skills；
- Agent 需要 MCP 或受控工具生态；
- 想减少从零搭 Harness 的工作。

对 SourceRealm 的意义：

- 当前 Claude CLI 模式本质上已经在使用“Agent 自主读仓库”的能力，只是这个能力隐藏在 CLI 内。
- Deep Agents 的 filesystem、compact、skills、memory、tools、MCP 与 SourceRealm 要解决的问题高度匹配。
- 因此最适合作为学习型 PoC 的首选。

参考：

- https://docs.langchain.com/oss/javascript/deepagents/overview
- https://docs.langchain.com/oss/javascript/deepagents/backends
- https://docs.langchain.com/oss/javascript/deepagents/memory

### 2.4 当前项目推荐顺序

#### 1. Deep Agents（推荐）

推荐原因：

- 最符合“系统性学习 Agent 开发”的目标；
- 覆盖 filesystem、memory、skills、compact、tools、MCP 等核心议题；
- 与当前“Claude Code CLI 自主探索仓库”的产品形态最接近；
- 可以先做 PoC，不必一开始大改业务代码。

风险：

- 抽象较完整，初期需要理解其运行模型；
- 需要确认 TypeScript 生态成熟度和版本稳定性；
- 仍然需要自己设计 SourceRealm 的权限边界和业务校验。

#### 2. LangGraph

推荐原因：

- 适合后续生产化，把生成、校验、重试、更新、回滚做成可恢复状态图；
- 对长任务和 human-in-the-loop 更友好；
- 可以把 SourceRealm 的生成和增量更新流程显式化。

风险：

- 一开始就上 LangGraph 可能过重；
- 需要先把工具、状态和业务边界拆清楚。

#### 3. LangChain createAgent

推荐原因：

- 最小迁移路径；
- 容易把现有 `LLMProvider` 替换成通用 Agent；
- 适合先验证 typed tools 和 structured output。

风险：

- 文件系统、compact、skills、长期 memory、复杂权限仍需要大量自建；
- 对“完整走一遍 Agent 开发流程”的学习覆盖不如 Deep Agents。

### 2.5 额外建议工具 / 框架

#### 1. Mastra

Mastra 是 TypeScript Agent 应用框架，覆盖 agents、workflows、memory、RAG、MCP、observability、evals 等产品化能力。

适合：

- 想做 TypeScript-first Agent 产品；
- 想要 server、workflow、observability 和 evals 集成；
- 未来 SourceRealm 如果从本地工具演进成 Agent 服务，可以继续评估。

参考：

- https://mastra.ai/docs

#### 2. OpenAI Agents SDK for TypeScript

OpenAI Agents SDK 提供 Agent、tools、handoffs、sessions、guardrails、tracing、MCP 等标准概念。

适合：

- 学习 Agent 标准范式；
- 希望用 OpenAI 模型和工具生态；
- 需要 tracing、guardrails、handoffs；
- 想做另一套 PoC 对比 Deep Agents。

参考：

- https://openai.github.io/openai-agents-js/guides/agents/

#### 3. Vercel AI SDK

Vercel AI SDK 更偏 TypeScript / Node / 前端集成，适合 streaming UI、structured output、tool calling、多模型 provider。

适合：

- SourceRealm 前端展示生成过程；
- 多模型 provider 适配；
- 结构化对象生成；
- 轻量 tool calling。

不建议作为当前复杂 Agent 编排首选，但可以作为 Web 端 AI 交互和 streaming 的补充工具。

参考：

- https://ai-sdk.dev/docs/introduction

### 2.6 Flue（withastro/flue）

Flue 是 Astro 团队 2026 年推出的 **sandbox agent framework**，定位是“像 Claude Code，但 100% 无头、可编程”，自称 “Not another SDK.”。TypeScript-first、Apache-2.0，目前明确标注 **Experimental（实验阶段，API 可能变）**。

它和 LangChain / LangGraph 不在同一抽象层，对比时要先分清层级：

| 维度 | LangChain | LangGraph | Flue |
| --- | --- | --- | --- |
| 抽象层 | 通用 LLM/Agent 应用框架 | 底层状态图编排引擎 | 完整 Agent Harness（运行时） |
| 心智模型 | 模型/工具/链统一抽象 + `createAgent` | 显式 graph：节点+边+state+checkpoint | 给模型一个能自主干活的环境：session/tools/skills/sandbox/文件系统 |
| 控制风格 | 偏自主 agent | 偏确定性编排（你画图） | 偏自主（逻辑大量写在 Markdown：skills / AGENTS.md） |
| 内置 sandbox | 无 | 无 | 有（默认虚拟 just-bash 沙盒，可选 local/容器） |
| 内置 fs/skills/subagents | 需自建或配 Deep Agents | 需自建 | 原生 |
| durable execution | 弱 | 强（核心卖点） | 有 |
| 成熟度 | 成熟、生态大 | 成熟、生产可用 | 实验阶段，API 会变 |

简言之：LangChain 是“拼装零件的工具箱”，LangGraph 是“确定性、可恢复的流程图引擎”，**Flue 与 Deep Agents 同属一类——开箱即用的自主 Agent 运行时（harness）**，覆盖 filesystem / skills / subagents / sandbox / MCP / 可观测。

支持情况（据官方 README）：支持 Anthropic Claude 模型（示例用 `anthropic/claude-sonnet-4-6`）、自定义 typed tools、可纯本地 Node 进程运行（也可部署托管运行时）；其 structured output、prompt caching 在 README 未明确，需查官方文档确认。

对 SourceRealm 的意义：

- 契合点：TS-first（与现有 server 一致）、原生 sandbox + 文件系统 + skills + MCP、headless 可本地运行、支持 Claude + typed tools，能套进现有 `LLMProvider` 兼容层（§5.1）。
- 风险/冲突点：① 实验阶段、API 会变，不宜放进核心生成链（违背“确定性边界不可绕过”原则）；② 它的强项是“让 agent 在沙盒里自主改文件”，而 SourceRealm 恰恰只让 Agent 产出 draft、由确定性流程写盘（§5.12），沙盒写能力对“只读仓库”是过剩的；③ structured output / prompt caching 需先确认，而这两点是 §5.8 / §1.11 的硬需求。

结论：**可作为阶段 0 PoC 的并列对比候选（与 Deep Agents 同台），但不建议现在定为主选型**。它不改变本文档既定的核心结论（单 Agent + typed tools + 编程式并发、确定性 workflow、确定性边界不可绕过）；框架只是承载这些能力的壳，可后替换。

参考：

- https://github.com/withastro/flue
- https://www.flueframework.com

## 3. Memory / RAG / 文件系统 / 内存数据库 / Agentic RAG

### 3.1 它们分别解决什么问题

| 模块 | 解决的问题 | 数据形态 | 谁决定使用 | SourceRealm 是否需要 |
| --- | --- | --- | --- | --- |
| Memory | 记住历史、偏好、状态、经验 | 消息、摘要、偏好、失败经验、项目知识 | 系统或 Agent | 需要，但要分层 |
| RAG | 从外部知识库检索相关内容 | 文档 chunk、embedding、metadata | 通常由系统固定检索 | 后置需要 |
| 文件系统管理 | 给 Agent 受控读写空间 | 文件、scratch、工具结果、虚拟路径 | Agent 通过工具访问 | 必须优先解决 |
| 内存数据库存储 | 临时保存状态或文件 | in-memory store/checkpointer | 系统透明使用 | 只适合 PoC |
| Agentic RAG | Agent 自主决定何时检索、查什么、查几次 | 工具、搜索、文件、数据库、文档 | Agent 决定 | 当前最适合 |

### 3.2 Memory 不等于 RAG

Memory 解决的是“记住什么”。RAG 解决的是“从哪里检索相关材料”。

Memory 可以包含：

- 用户偏好；
- 项目规则；
- 生成失败经验；
- 当前 run 的状态；
- 历史摘要；
- skills；
- 工具结果索引。

RAG 通常包含：

- 文档切片；
- embedding；
- 向量数据库；
- keyword index；
- metadata filter；
- reranker；
- 检索结果注入 prompt。

二者可以结合，但不能混为一谈。

### 3.3 文件系统管理为什么重要

Agent 做代码任务时，文件系统就是它的工作台。没有受控文件系统，Agent 很容易出现几个问题：

- 直接读取过多文件，导致上下文爆炸；
- 把工具结果塞满 prompt；
- 不知道哪些路径可以写；
- 误写用户仓库；
- 把临时 scratch 和长期 memory 混在一起；
- 无法恢复长任务；
- 无法审计中间结果。

SourceRealm 应该设计虚拟文件系统：

```txt
/workspace/      -> 用户导入仓库，只读
/project-state/  -> SourceRealm 项目状态，只读或系统专用
/scratch/        -> 本次 Agent run 临时文件，可读写
/memories/       -> 长期 memory，默认只读，受控写入
/skills/         -> 程序性说明，只读
```

Agent 不应该直接写：

- 用户仓库；
- `course.json`；
- `levels/*.json`；
- `progress.json`；
- `project.json`。

Agent 只能生成 draft。系统校验通过后，由 `ProjectStore` 写入业务真相源。

### 3.4 内存数据库存储的定位

In-memory store 适合：

- PoC；
- 单次 dev 调试；
- mock 测试；
- fixture e2e；
- 短生命周期任务。

不适合：

- 长时间生成任务；
- 服务重启后恢复；
- 多项目并发；
- 用户 review 历史；
- 长期 memory；
- 可审计 trace。

SourceRealm 当前业务存储选择了本地 JSON 文件，这是合理的。Agent runtime store 第一阶段也可以继续本地文件化，例如：

```txt
~/.sourcerealm/
  agent-runs/
    <runId>/
      run.json
      trace.jsonl
      scratch/
      summaries/
      tool-results/
```

如果未来需要更强查询、并发或恢复能力，再评估 SQLite。暂时不建议一开始引入复杂数据库。

#### 存储介质决策矩阵

按“是否需要查询 / 并发 / 恢复 / 语义检索”逐级升级，不要一上来上重型数据库：

| 介质 | 适合 | 不适合 | SourceRealm 定位 |
| --- | --- | --- | --- |
| 本地 JSON / JSONL 文件 | 业务真相源、run trace、单机低并发、可人工检查 | 复杂查询、高并发写 | **第一阶段主力**（延续现状 + `agent-runs/<runId>`） |
| 嵌入式 DB（SQLite） | 按条件查询/聚合、评估指标与 trace 统计、单机持久 | 多机分布式 | 评估指标 / trace 量大后引入 |
| 内存数据库（Redis） | 跨进程共享短期态、限流、跨进程 checkpoint | 长期可审计存储 | 后置，仅多进程 / 服务化才需要 |
| 向量数据库 | 语义检索（RAG） | 结构化状态 / 业务真相源 | 大仓库召回质量出现瓶颈时才引入（见 §5.14） |

判据：trace/指标开始需要“按条件查询和聚合”时，从 JSON 升级到 SQLite；只有出现多进程并发或服务化时才考虑 Redis；向量库只服务语义检索，绝不承载真相源。memory 增长治理（TTL / 摘要 / 去重 / 上限）的 SourceRealm 落地见 §5.5。

### 3.5 RAG 和 Agentic RAG 的区别

#### 2-step RAG

固定流程：

1. 用户问题进入系统。
2. 系统检索相关文档。
3. 检索结果进入 prompt。
4. 模型回答或生成。

优点：

- 简单；
- 稳定；
- 成本可控；
- 适合文档问答。

缺点：

- 不适合复杂任务规划；
- 检索 query 错了，后续生成就会被误导；
- 不适合多轮查找、验证和修正。

#### Agentic RAG

动态流程：

1. Agent 理解目标。
2. Agent 自己决定是否检索。
3. Agent 调用 `list_files`、`grep_code`、`read_file`、`git_diff_since` 等工具。
4. Agent 根据中间结果继续决定下一步。
5. Agent 输出结构化 draft。
6. 系统校验并决定是否接受。

优点：

- 适合复杂代码仓库理解；
- 能按需读取文件；
- 能结合搜索、diff、引用校验；
- 更接近当前 Claude CLI 自主探索仓库的能力。

缺点：

- 延迟不稳定；
- 成本不稳定；
- 必须有权限控制；
- 必须有 compact；
- 必须有 trace 和回放能力。

### 3.6 SourceRealm 是否需要解决这些问题

#### 必须现在解决

- **文件系统管理**：必须。Agent 读写边界不清晰会直接影响安全性。
- **权限控制**：必须。当前 Claude CLI 已通过 `--allowedTools Read,Glob,Grep` 和 `--disallowedTools Write,Edit,Bash` 做了限制，重构后要保留并细化。
- **工具层**：必须。读文件、搜索代码、git diff、引用校验要显式工具化。
- **compact**：必须。大仓库、多关卡、增量修订都会导致上下文膨胀。
- **结构化输出校验**：必须。现有 zod schema、retry、hash 回填不能丢。
- **运行态 memory/checkpoint**：建议第一阶段做最小版，用于恢复和审计。

#### 第二阶段解决

- **长期 memory**：可以后置，但目录和边界应先设计。
- **skills**：可以第二阶段做，很适合沉淀课程测绘、关卡出题、增量修订流程。
- **MCP**：可以后置。先用本地 typed tools，稳定后再包装成 MCP server。
- **RAG/vector index**：可以后置。只有当大仓库候选文件选择质量不够时再做。
- **Agentic RAG 自纠错**：可以在 `verifyTask` 失败较多后引入。

#### 暂时不需要

- 完整向量数据库体系；
- 多租户 memory 隔离；
- 复杂知识图谱；
- 把所有源码 embedding 入库；
- 一开始就搭大型 MCP 生态。

### 3.7 推荐正常解法

SourceRealm 的 Agent 化不应从“向量数据库 RAG”开始，而应从：

1. 受控 Agentic 文件系统；
2. typed tools；
3. compact；
4. permission control；
5. 结构化输出校验；
6. 运行态 checkpoint；
7. 后置 memory / skills / RAG / MCP。

也就是说，先让 Agent 能安全、可观测、按需地读仓库，再考虑更复杂的检索和长期记忆。

## 4. SourceRealm 当前系统评估

### 4.1 当前实现形态

当前关键模块：

- `packages/server/src/providers.ts`
  - `LLMProvider`
  - `ClaudeCliProvider`
  - `AnthropicApiProvider`
  - `MockProvider`
  - `generateWithRetry`
- `packages/server/src/generator.ts`
  - `LevelGenerator`
  - `mapCourse`
  - `generateLevel`
  - `verifyTask`
- `packages/server/src/updater.ts`
  - `CourseUpdater`
  - `diffSince`
  - `analyzeImpact`
  - `reviseLevel`
  - `appendLevels`
- `packages/shared/src/schema.ts`
  - Course、Level、Task、CodeRef、Progress 等 zod schema。
- `ProjectStore`
  - JSON 文件读写、schema 校验、原子写。

### 4.2 当前优点

- 已经有 provider 抽象，方便替换底层 AI 实现。
- 已经有 MockProvider，适合测试。
- 已经有 zod schema，结构化输出边界清晰。
- 已经有 schema retry。
- 已经有引用校验和 contentHash 回填。
- 已经有 JSON 文件作为本地业务真相源。
- 已经有增量更新流程。
- 已经有 SSE 事件反馈生成进度。

这些都是 Agent 化的好基础。

### 4.3 当前问题

- Agent 能力隐藏在 Claude CLI 内部，不够显式。
- 工具没有被建模成 typed tools。
- CLI 模式和 API 模式上下文策略差异较大。
- memory、compact、skills、permission、trace 没有独立模块。
- `providers.ts` 容易继续膨胀。
- 无法清楚观察每一步 Agent 为什么读某个文件、为什么生成某个任务。
- 未来接 MCP、RAG、多模型、多 Agent 时缺少清晰扩展点。

### 4.4 关键设计原则

SourceRealm 重构时应坚持：

- Agent 只产出 draft；
- 业务真相源由系统写入；
- zod schema 不能绕过；
- 引用校验不能绕过；
- 用户仓库默认只读；
- 大上下文必须 compact；
- 真实模型调用不进 CI；
- mock 和 fixture 是回归测试核心。

## 5. SourceRealm 需要覆盖的实现点

### 5.1 AgentProvider 兼容层

建议新增 `AgentProvider` 或 `DeepAgentProvider`，但短期保持与现有 `LLMProvider` 兼容：

```ts
interface LLMProvider {
  readonly name: string
  generate<T>(opts: GenerateOptions<T>): Promise<T>
}
```

这样可以让 `LevelGenerator` 和 `CourseUpdater` 少改动。

第一阶段目标不是重写业务流程，而是把底层 provider 替换成可控 Agent。

#### Model Gateway 的演进（SourceRealm 判断）

> 通用概念见 §1.14。

SourceRealm 现有的 `ANTHROPIC_BASE_URL` 中转（`AnthropicApiProvider` 与 `buildCliEnv` 都会透传它）其实已经是**最轻量的 model gateway 雏形**——它把请求统一指向一个中转地址。现阶段是单 provider（Anthropic）、单机本地工具，**不需要引入完整 gateway**。务实的增量改造是在现有 provider 层补几项能力：

- 请求日志 + 按调用记录 token / cost（喂给 §5.15 Observability 与 §5.16 评估）；
- circuit breaker / fallback：主调用失败或超时时回退（例如降级到 Haiku 或换中转）；
- 统一 timeout 与重试边界（与 `generateWithRetry` 协同，但区分“schema 重试”与“网络重试”）。

**何时升级为完整 gateway（后置信号）**：需要支持 >2 个 provider、需要团队级成本预算、需要语义缓存或复杂路由时。届时优先 **Portkey**（TS SDK 友好、自带语义缓存与 MCP Gateway）或自托管 **LiteLLM**（成本低、功能够用）。

### 5.2 工具层

建议把仓库探索能力拆成工具：

- `list_files`
  - 输入：目录、glob、排除规则。
  - 输出：文件路径列表。
- `read_file`
  - 输入：文件路径、起止行、最大字符数。
  - 输出：带行号内容。
- `grep_code`
  - 输入：pattern、glob、大小写、最大结果。
  - 输出：匹配文件、行号、片段。
- `read_ref`
  - 输入：file、startLine、endLine。
  - 输出：源码片段、hash、是否存在。
- `git_diff_since`
  - 输入：anchor commit、文件过滤。
  - 输出：变更文件、diff 摘要、截断标记。
- `verify_task_refs`
  - 输入：task draft。
  - 输出：合法 task、失败原因、hash 回填。
- `summarize_file`
  - 输入：文件路径。
  - 输出：职责摘要、关键符号、可教学点。
- `emit_course_draft`
  - 输出课程草稿，但不写入文件。
- `emit_level_draft`
  - 输出关卡草稿，但不写入文件。

### 5.3 文件系统管理

建议用虚拟路径隔离真实路径：

```txt
/workspace/      用户导入仓库，只读
/project-state/  SourceRealm 项目状态，只读或系统专用
/scratch/        本次 run 可写
/memories/       长期 memory，默认只读
/skills/         程序性说明，只读
```

权限规则：

- `/workspace`：只读。
- `/project-state`：Agent 不直接写。
- `/scratch`：Agent 可写。
- `/memories`：默认只读，写入需 consolidation 或人工确认。
- `/skills`：只读。

### 5.4 Permission Control

需要实现策略层，而不是只靠 prompt。

建议权限分级：

- `read_workspace`
- `read_project_state`
- `write_scratch`
- `read_memory`
- `write_memory`
- `run_git_readonly`
- `network_access`
- `write_project_state`
- `write_workspace`

默认：

- 允许：`read_workspace`、`write_scratch`、`run_git_readonly`。
- 谨慎允许：`read_memory`。
- 默认禁止：`write_memory`、`network_access`、`write_project_state`、`write_workspace`。

权限不应来自客户端传参，例如 `level=admin` / `mode=write` / `capabilities=[...]` 都不能作为信任来源。客户端最多表达用户意图（启动生成、选择仓库、确认某个高风险动作），实际 capability set 必须由服务端根据 `runType`、`phase`、`projectId`、工具名和服务器配置派生：

- `mapCourse`：读仓库、读全局指导文件、写 scratch、只读 git。
- `generateLevel`：读本关相关文件、grep/read file、写 scratch、emit draft。
- `reviseLevel`：读旧关卡、读受影响文件、只读 git diff、emit revised draft。
- 写入 `course.json` / `levels/*.json` / `progress.json` 只允许确定性业务流程执行，Agent 只能输出 draft。

每次工具调用执行前都经过服务端 policy engine：

```txt
model tool call
  -> schema validate
  -> capability check(runId, toolName, input)
  -> virtual path / command / network policy check
  -> optional human approval check
  -> execute
  -> sanitize output
  -> trace
```

抓包伪造请求不能提权，因为前端请求体不决定 capability；服务端只接受少量业务动作，内部 run state 才决定当前可用工具。若未来开放远程多用户或共享部署，再叠加登录态、CSRF / Origin 校验、项目所有权校验和服务端 session 绑定；本地单用户版本先保证“不信任客户端传来的权限参数”。

### 5.4.1 Web 应用中的前后端分工

SourceRealm 是 Web UI + 本地服务的形态，Agent harness 应放在后端。前端负责交互和展示，不能持有模型凭证、工具权限或可执行 tool call。

前端职责：

- 选择本地仓库路径、发起导入 / 生成 / 更新 / 重试等业务动作；
- 展示生成进度、SSE 事件、关卡、错误、trace 摘要和人工确认弹窗；
- 提交玩家答题进度和用户确认结果；
- 不组装 system prompt，不传 capability，不直接调用模型，不直接执行工具。

后端职责：

- 维护 `runId`、`projectId`、phase、capability set、预算、trace 和 provider 配置；
- 读取全局指导文件、构建分层 prompt、执行 compact / offload / memory 检索；
- 持有 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / Claude CLI 环境变量；
- 执行 policy engine、typed tools、虚拟路径隔离、schema 校验和确定性写盘；
- 将可展示状态通过 API / SSE 返回前端。

### 5.5 Memory

建议分层：

#### run-level memory

路径示例：

```txt
~/.sourcerealm/agent-runs/<runId>/
  run.json
  trace.jsonl
  scratch/
  summaries/
  tool-results/
```

保存：

- 当前阶段；
- 已读文件摘要；
- 工具调用摘要；
- schema 错误；
- 引用校验失败；
- 生成结果草稿；
- compact 后的上下文摘要。

#### project-level memory

保存：

- 当前项目生成偏好；
- 哪些目录适合教学；
- 哪些文件不适合出题；
- 用户 review 反馈；
- 常见失败模式。

注意：

- 不默认保存源码原文。
- 不把临时 run 结果混进稳定文档。
- 重要长期结论 review 后再进入 `llmdoc/`。

#### 增长治理（避免越存越长）

> 通用原则见 §1.5；存储介质矩阵见 §3.4。

- **run-level**：按 `runId` 隔离，trace/tool-results 设保留期，过期归档或清理，不让 `agent-runs/` 无限堆积。
- **project-level**：设条目上限 + 重要性打分淘汰；写入前去重（近似项合并）；优先存“摘要 + 结论”而非原始消息。
- **加载策略**：长期 memory 按需检索注入，不每轮全量塞进 prompt（与 §5.10 context 装配一致）。
- **介质演进**：第一阶段沿用本地 JSON / JSONL；当评估指标与 trace 需要按条件查询/聚合时升级 SQLite。

### 5.6 Skills

SourceRealm 很适合引入 skills。建议先拆成：

- `course-mapping-skill`
  - 如何设计课程大纲；
  - 如何选择章节；
  - 如何控制关卡数量；
  - 如何避免重复。
- `level-authoring-skill`
  - 如何设计 quiz、treasure-hunt、call-chain、code-fill、code-type；
  - 如何写 narrative 和 explanation；
  - 如何选择引用范围。
- `incremental-update-skill`
  - 如何根据 diff 最小修订；
  - 如何保留仍有效任务；
  - 如何处理 stale / obsolete。
- `reference-verification-skill`
  - 行号规则；
  - hash 回填；
  - 失败后如何修正。
- `rpg-writing-style-skill`
  - 中文复古 RPG 语气；
  - 趣味但不牺牲技术准确性。

Skills 应按阶段加载，避免每次把所有规则塞进 prompt。

### 5.7 Compact

建议策略：

- 文件树超过阈值后摘要；
- 文件内容默认按行范围读取；
- 单次工具结果超过阈值写入 `/scratch/tool-results/`；
- git diff 截断并写入 scratch；
- 每生成一个 level 后压缩历史；
- retry prompt 只保留最近一次关键错误；
- trace 全量保存到文件，但不全量塞回模型。

### 5.8 Prompt Caching 与 Token 成本

> 通用原理见 §1.11。

**当前问题**：`AnthropicApiProvider` 现在是单条 user message、无 `system`、无 `cache_control`；`generateWithRetry` 每次重试都把错误拼回 `opts.prompt` 重建整段——前缀每轮都变，无法命中缓存。

**安全分层评估**：SourceRealm 当前不是聊天产品，没有用户自由输入的 prompt；但用户选择的本地仓库本身是用户可控输入源，README、CLAUDE.md、AGENTS.md、源码注释、diff 都可能包含 prompt injection 文本。因此仍然需要遵守 `tools → system → user/content` 的分层：工具权限和 schema 输出要求由工具层/system 层强制，仓库内容只作为待分析材料注入，不能放宽只读工具、写入权限、JSON schema、引用校验或持久化规则。

**改造方向**（缓存友好分层）：

- 稳定前缀打 `cache_control` 断点：工具定义（确定性顺序）、`system`（角色 + 中文复古 RPG 写作规范 + 输出约束 + prompt injection 边界）、当前仓库的文件树 + 全局指导文件/README 摘要快照；
- volatile 后缀不打断点：本关 outline / 学习目标、`buildEmbeddedContext` 产出的行号源码块、schema 重试反馈。

```ts
// AnthropicApiProvider.generate 改造示意
system: [
  { type: 'text', text: SYSTEM_PROMPT },                                  // 冻结角色/风格/输出约束
  { type: 'text', text: repoTreeAndGlobalDocs, cache_control: { type: 'ephemeral' } },
],
tools,                                                                     // 顺序固定
messages: [{ role: 'user', content: [{ type: 'text', text: embedded }] }], // 每关变化，不缓存
```

**重试改造**：把 schema 错误反馈作为追加的新 message，而非重写 `opts.prompt`，保留前缀命中（呼应 §5.16 的 cache hit 指标）。

**验证与目标**：用 `usage.cache_read_input_tokens` 观测命中率，记入 trace；目标对齐 §1.11（优化后可达 90%+）。`ClaudeCliProvider` 的缓存由 CLI 内部托管、服务端不可控，仅作回退。

### 5.9 Agent Loop 与终止控制

> 通用方法见 §1.9。

当前 `generator.ts` 是纯线性流程（`LevelGenerator.run` → `mapCourse` → 并发 `generateLevel`），没有 Agent 自主 loop。一旦把仓库探索变成 agentic（`list_files` / `grep_code` / `read_file` 由模型自主决定调哪个），就要在 **per-level** 粒度施加护栏：

```txt
生成单个 level 时：
while (!levelDone) {
  if (steps++ >= MAX_STEPS) return stop('max-steps')        // 默认 15
  if (usedTokens > TOKEN_BUDGET) return stop('budget')      // 默认 50K / level
  if (now - start > TIMEOUT) return stop('timeout')         // 默认 120s
  const call = await agent.nextToolCall(ctx)
  if (isRepeat(call, recentCalls)) return stop('stall')     // 同参 + 同输出哈希
  ...
}
```

SourceRealm 的重点防护：重复读同一文件（配合 §5.8 缓存）、对同一目标无限 `grep`、symbol 解析打转。护栏与现有的 `runWithConcurrency`（并发出多关）、`generateWithRetry`（schema 重试）协同——前者限并发、后者限 schema 重试次数、loop 护栏限单关的步数/预算/停滞。单关触发护栏即标记 `failed`（沿用现有失败处理），不阻塞其他关。

### 5.10 每轮 Loop 的 Context 装配

> 通用清单见 §1.10。

按调用类型分别规定该带的字段，并标注属“稳定前缀”还是“volatile 后缀”：

| 调用 | 稳定前缀 | volatile 后缀 |
| --- | --- | --- |
| `mapCourse` | 工具定义 + system + 仓库文件树/全局指导文件/README 快照 | 大纲设计要求、schema |
| `generateLevel` | 工具定义 + system + 仓库快照 | 整体课程大纲、本关目标、相关文件清单、已读摘要、引用规则、预算余量、上次错误、schema |
| `reviseLevel` | 工具定义 + system + 仓库快照 | 旧关卡 JSON、受影响文件、相关 git diff（截断）、修订要求、schema |

**现状改进点**：当前 prompt 在 `generator.ts` 里硬编码拼接、API 路径无 system。建议抽出统一的 system 模板并加 **prompt version**（记入 §5.15 Observability，便于评估对比不同 prompt 版本）；大工具结果 offload 到 `/scratch/tool-results/`，prompt 里只留摘要 + 路径。`ClaudeCliProvider` 当前不加 `--bare`，会让 Claude Code 按自身机制读取项目 `CLAUDE.md` / `AGENTS.md`，方向正确；SDK / 自建 Harness 路径也应显式读取这些全局指导文件，但把它们标记为仓库内容层，而不是系统层。

### 5.11 延迟与吞吐优化

> 通用概念见 §1.12。

SourceRealm 是“后台生成 + SSE 进度反馈”，用户等的是完整结果，因此**优化重点是 E2E 与吞吐，而非 TTFT**：

- 用好已有 `runWithConcurrency` 并发（默认 3，`SOURCEREALM_CONCURRENCY` 可调）提升整体吞吐；
- prompt caching 预热（§5.8）对“同一仓库连续生成多关”收益最大——仓库快照前缀复用；
- 控制每次调用的输入 token（文件树 `MAX_TREE_LINES`、README `MAX_README_CHARS`、diff `MAX_DIFF_CHARS` 已有截断，延续）；
- 生成类任务不启用 extended thinking；
- SSE 流（`GET /api/projects/:id/events`）配 15–30s heartbeat 防中间件断连。

**度量**：在 trace 与 SSE 事件里埋时间戳，记录每关的 E2E、平均 TPS、provider 往返；用 P50/P95/P99 观察退化（接入 §5.15）。

### 5.12 单 Agent vs 多 Agent 决策

> 通用模式与代价见 §1.13。

**明确结论：SourceRealm 当前不需要多 Agent，首选“单 Agent + typed tools + 编程式并发”。**

理由（结合当前事实）：

- 流程本质是**确定性 workflow**：`mapCourse`（全局测绘）→ `generateLevel`（逐关，彼此独立）→ `verifyTask`（校验）→ `CourseUpdater`（按 diff 修订/追加），步骤先后清晰。
- 并发出多关是**并行执行同一逻辑**（`runWithConcurrency`），不是异质 Agent 协作——属于“并行 ≠ 多 Agent”的典型。
- 成本敏感：多 Agent 经验上约 15× token、协调故障率高（最大类约 36.9%），对本项目得不偿失。
- 状态一致性关键：`verifyTask`、写盘、`levels-next/` 原子切换必须是确定性流程，不能交给自主 Agent。

**形态建议**：`mapCourse` / `verifyTask` / `CourseUpdater` 保持确定性编排；仅 `generateLevel` 的“出题”交给受约束的模型生成（强制 schema + 引用可校验）。

**引入多 Agent 的触发条件（后置，呼应阶段 5）**：

1. 关卡类型异质到需要不同 prompt / 工具（quiz vs 寻宝 vs 代码填空各自专门化）→ 引入轻量 **Supervisor** 按类型分派特化 Agent；
2. 实测证明 per-level 上下文隔离能显著省 token（如 15K→9K/关）→ 引入 **orchestrator + 隔离 subagent**。
   否则不升级——不追求“多 Agent”的架构光环。

### 5.13 MCP 与 MCP Gateway

> 通用概念见 §1.14。

第一阶段不建议自建 MCP。

原因：

- 当前工具都在本地服务内，直接 typed tools 更简单；
- MCP 会增加协议和调试成本；
- 还没确定工具边界前，过早 MCP 化容易返工。

第二阶段可以把稳定工具封装成 SourceRealm MCP server：

- repo tools；
- git diff tools；
- source ref tools；
- project state read tools；
- generation quality tools。

这样未来可以被 Claude、OpenAI Agents SDK、Deep Agents、Mastra 或其他客户端复用。

**MCP Gateway 是后置需求**：把工具封装成单个 MCP server、被本项目自己使用时，**不需要 gateway**。只有出现这些信号才考虑 Docker MCP Gateway——工具要跨多个应用/客户端共享、需要多租户权限隔离（RBAC）、需要生产级审计。届时再补 MCP 安全要点（消息签名、capability binding、输入校验、输出清理，防 prompt injection / 工具投毒）。本项目预计落在阶段 6 之后再评估。

### 5.14 RAG

第一阶段不做 vector RAG。

先用：

- 全局指导文件：`CLAUDE.md` / `AGENTS.md` / `README.md`，以及大小写变体 `claude.md` / `agents.md` / `readme.md`；
- file tree；
- package metadata；
- docs；
- grep；
- read file；
- git diff；
- llmdoc；
- framework conventions。

读取项目时的默认顺序应是：先读全局指导性文件和 package metadata，建立项目语义边界；再看 file tree 和 docs；最后按任务需要 grep / read file / git diff。全局指导文件可以影响“如何理解项目”，但仍属于仓库输入层，不能覆盖 SourceRealm 的 tool policy、system prompt、schema 输出和写入边界。

当出现以下问题时再引入 RAG：

- 大仓库候选文件选择质量差；
- grep 不足以找到相关概念；
- README / docs / source 分散；
- 多次生成重复读取同样上下文；
- 用户希望问答式探索项目知识。

RAG 可以先做 hybrid：

- keyword search；
- symbol index；
- file summary；
- embedding retrieval；
- rerank。

### 5.15 Observability

每个 Agent run 应记录：

- run id；
- project id；
- provider；
- model；
- prompt version；
- tool calls；
- tool duration；
- tool errors；
- schema validation errors；
- retry count；
- refs verified；
- refs rejected；
- generated levels；
- token / cost（input/output 分别）；
- cache hit（`cache_read_input_tokens`，呼应 §5.8）；
- 延迟（E2E / TTFT，P50/P95/P99，呼应 §5.11）；
- loop 终止原因（done / max-steps / budget / stall / timeout，呼应 §5.9）；
- compact summaries；
- final status。

建议初期用本地 `trace.jsonl`，后续再考虑 LangSmith、OpenTelemetry 或框架自带 observability。

### 5.16 Testing

测试策略：

- 保留现有 `MockProvider`。
- 新增工具单测。
- 新增权限策略单测。
- 新增 compact 单测。
- 新增 loop 护栏单测（max-steps / budget / stall / timeout 各自能正确触发，呼应 §5.9）。
- 新增 AgentProvider mock 回放 / trace replay。
- 新增 fixture repo e2e。
- 真实模型只跑 smoke，不进 CI。

> 评估指标体系与方法论见 §1.15。

核心指标：

- 课程生成成功率 / 关卡生成成功率（TSR）；
- 引用校验通过率（复用 `verifyTask`）；
- schema 一次通过率 / schema retry 次数；
- 幻觉率（凭空源码片段比例）；
- stale 修订成功率；
- 重复任务比例；
- 平均生成耗时（E2E）/ 平均工具调用次数 / 平均迭代步数；
- cache hit rate；
- token/level、cost per successful level。

**SourceRealm 评估落地方案**：

- 建 10–20 个代表性“关卡生成”任务作为 golden set（真实仓库样本），人标 gold trajectory 与 success criteria（schema 正确、引用在仓库中存在且正确、无幻觉）；
- 用 `MockProvider` 做确定性回归，真实模型只跑 smoke；
- 用 LLM-as-judge（直接用 Claude API 自建，或 Mastra evals / DeepEval-TS）评 narrative / explanation 质量与中文复古 RPG 语气；
- 阶段 0 PoC 即定 baseline，每次 Agent 改动前跑离线回归 gate（成功率降 >5% 或 cost/task 升 >15% 即拦截）；
- TS 技术栈：离线 eval 用 Mastra evals 或 DeepEval-TS，trace/observability 先用本地 `trace.jsonl`，后续接 LangSmith / Braintrust。

## 6. 推荐落地路线

### 阶段 0：学习型 PoC

目标：

- 先不改主流程；
- 用 Deep Agents 或 LangChain createAgent 跑通一个最小 Agent；
- 可同时用同一 fixture repo 横向试 Deep Agents 与 Flue（§2.6），用 §5.16 指标（schema 通过率、引用通过率、token/level、cache hit）对比，数据说话；
- 只读一个 fixture repo；
- 输出一个课程草稿和一个关卡草稿；
- 走 zod schema 校验；
- 记录 trace。

验收：

- Agent 能调用 `list_files`、`read_file`、`grep_code`；
- Agent 输出符合 schema；
- 系统能验证引用；
- 过程可追踪；
- 默认采用“单 Agent + 工具 + 编程式并发”形态（见 §5.12），不引入多 Agent；
- 产出 baseline 评估指标（TSR、token/level、schema 一次通过率、引用校验通过率），作为后续回归基准（见 §5.16）。

### 阶段 1：兼容 Provider 替换

目标：

- 新增 `AgentProvider` / `DeepAgentProvider`；
- 保持 `generateWithRetry` 不变；
- `LevelGenerator`、`CourseUpdater` 尽量不改；
- 保留 `ClaudeCliProvider` 和 `AnthropicApiProvider` 作为回退。

验收：

- `mapCourse` 可以走 AgentProvider；
- `generateLevel` 可以走 AgentProvider；
- Mock 测试不受影响；
- 真实模型 smoke 可跑通；
- 接入 prompt caching 并预热仓库快照前缀，记录 cache hit / token / cost / 延迟 P50-P99（见 §5.8、§5.11、§5.15）；
- Model Gateway 轻量增强：请求日志 + 成本统计 + circuit breaker / fallback（见 §5.1）。

### 阶段 2：工具与权限固化

目标：

- 把文件读取、搜索、git diff、引用校验全部工具化；
- 建立虚拟路径；
- 建立 permission policy；
- Agent 不再直接依赖 Claude CLI 的工具权限。

验收：

- 用户仓库只读；
- Agent 不能写业务 JSON；
- 工具调用全部有 trace；
- 权限违规有明确错误；
- loop 护栏生效（max steps / token budget / stall / timeout 各能正确触发，见 §5.9）；
- 统一 context 装配规范，区分稳定前缀与 volatile 后缀（见 §5.10）。

### 阶段 3：Memory 与 Compact

目标：

- 加 `agent-runs/<runId>`；
- 加 scratch；
- 加 tool result offload；
- 加阶段性摘要；
- 加最小 checkpoint。

验收：

- 大文件不会直接撑爆 prompt；
- 每个 level 结束后可以压缩上下文；
- run 失败后能看到失败阶段和关键工具结果；
- memory 增长治理生效（run-level 按 `runId` 隔离 + 保留期、project-level 上限 + 去重，见 §5.5）；
- 明确存储介质演进判据（trace/指标需查询聚合时由 JSON 升级 SQLite，见 §3.4）。

### 阶段 4：Skills

目标：

- 把 prompt 拆成可维护 skills；
- 按任务阶段加载对应 skill；
- 减少重复 prompt；
- 方便后续优化生成质量。

验收：

- 课程测绘、关卡出题、增量修订有独立 skill；
- 修改风格或规则不需要改核心代码；
- 输出质量不低于当前实现。

### 阶段 5：LangGraph 化

目标：

- 当流程复杂度上升后，把关键步骤图化：
  - mapping；
  - generate level；
  - verify；
  - retry；
  - write；
  - update；
  - append；
  - promote。

验收：

- 长任务可恢复；
- 状态可观察；
- 失败节点可单独重试；
- 可插入 human-in-the-loop；
- 多 Agent 触发判断：仅当流程复杂度上升、或关卡类型异质化到需要不同 prompt/工具时，才评估引入轻量 Supervisor / 隔离 subagent（判据见 §5.12），否则保持单 Agent。

### 阶段 6：RAG / MCP

目标：

- 如果大仓库质量瓶颈明显，引入 RAG；
- 如果工具复用需求明显，封装 MCP server。

验收：

- 候选文件召回质量提升；
- 多客户端可复用 SourceRealm 工具；
- 权限边界仍然清晰；
- MCP Gateway 仅在工具需跨应用共享 / 多租户隔离 / 生产审计时引入（如 Docker MCP Gateway），并补齐 MCP 安全要点（见 §5.13）。

## 7. 最终建议

当前最适合 SourceRealm 的路线是：

1. **先用 Deep Agents 做学习型 PoC**；
2. **用兼容 Provider 接入现有生成流程**；
3. **优先建设 typed tools、文件系统边界、permission control、compact 和 trace**；
4. **保留 zod schema、引用校验、ProjectStore 原子写这些确定性边界**；
5. **等工具和权限稳定后，再引入 skills、长期 memory、LangGraph、RAG、MCP**；
6. **默认采用“单 Agent + typed tools + 编程式并发”**：流程是确定性 workflow、关卡是同质独立子任务，多 Agent 约 15× token 且协调易失败，只有任务异质化或实测证明上下文隔离有显著收益时才升级（见 §5.12），不追求架构光环；
7. **接入治理按需后置**：单 provider/单机阶段只需轻量 model gateway（成本日志 + fallback，见 §5.1），MCP Gateway 留到工具跨应用共享时再上（见 §5.13）；
8. **运行时控制先行**：prompt caching（§5.8）+ loop 护栏（§5.9）+ 统一 context 装配（§5.10）应在 Provider 替换与工具固化阶段就落地，并用评估指标（§5.16）持续把关。

不建议一开始就做：

- 完整向量数据库；
- 大型 MCP server；
- 复杂多 Agent 系统；
- 全量数据库迁移；
- 让 Agent 直接写业务 JSON；
- 让 Agent 写用户仓库。

SourceRealm 是一个非常适合学习 Agent 开发的项目，因为它天然包含：

- 本地代码仓库理解；
- 工具调用；
- 长上下文；
- 结构化输出；
- 引用校验；
- 权限控制；
- 增量更新；
- 质量评估；
- 前端可视化反馈。

把这个项目做好，关键不是简单“换一个 Agent 框架”，而是逐步把当前隐式的 Claude Code 能力拆成显式、可控、可测试、可恢复、可观察的 Agent 工程体系。
