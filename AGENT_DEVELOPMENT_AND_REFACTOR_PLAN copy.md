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

Agentic RAG 适合：

- 代码仓库理解；
- 多步探索；
- 需要 grep / read file / git diff / verify 的任务；
- 需要根据中间结果继续决定下一步的任务。

SourceRealm 的核心任务是让 Agent 按需探索仓库、生成课程和关卡，因此更接近 Agentic RAG，而不是传统“先 embedding 全仓库，再一次性检索”的 2-step RAG。

### 1.9 设计评估与测试

Agent 测试不能只依赖真实模型。建议分层：

- 工具单测：验证工具输入输出、权限、错误处理。
- schema 单测：验证结构化输出和错误提示。
- mock model 测试：稳定回归，不依赖真实模型。
- fixture repo e2e：用小型测试仓库跑完整流程。
- trace replay：把历史失败输入回放，验证修复是否有效。
- smoke test：真实模型手动冒烟，不进 CI。
- 质量评估：统计引用校验失败率、生成成功率、任务类型分布、重复题比例。

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

### 5.8 MCP

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

### 5.9 RAG

第一阶段不做 vector RAG。

先用：

- file tree；
- grep；
- read file；
- README 摘要；
- package metadata；
- git diff；
- llmdoc；
- framework conventions。

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

### 5.10 Observability

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
- token / cost；
- compact summaries；
- final status。

建议初期用本地 `trace.jsonl`，后续再考虑 LangSmith、OpenTelemetry 或框架自带 observability。

### 5.11 Testing

测试策略：

- 保留现有 `MockProvider`。
- 新增工具单测。
- 新增权限策略单测。
- 新增 compact 单测。
- 新增 AgentProvider mock 回放。
- 新增 fixture repo e2e。
- 真实模型只跑 smoke。

核心指标：

- 课程生成成功率；
- 关卡生成成功率；
- 引用校验通过率；
- schema retry 次数；
- stale 修订成功率；
- 重复任务比例；
- 平均生成耗时；
- 平均工具调用次数。

## 6. 推荐落地路线

### 阶段 0：学习型 PoC

目标：

- 先不改主流程；
- 用 Deep Agents 或 LangChain createAgent 跑通一个最小 Agent；
- 只读一个 fixture repo；
- 输出一个课程草稿和一个关卡草稿；
- 走 zod schema 校验；
- 记录 trace。

验收：

- Agent 能调用 `list_files`、`read_file`、`grep_code`；
- Agent 输出符合 schema；
- 系统能验证引用；
- 过程可追踪。

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
- 真实模型 smoke 可跑通。

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
- 权限违规有明确错误。

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
- run 失败后能看到失败阶段和关键工具结果。

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
- 可插入 human-in-the-loop。

### 阶段 6：RAG / MCP

目标：

- 如果大仓库质量瓶颈明显，引入 RAG；
- 如果工具复用需求明显，封装 MCP server。

验收：

- 候选文件召回质量提升；
- 多客户端可复用 SourceRealm 工具；
- 权限边界仍然清晰。

## 7. 最终建议

当前最适合 SourceRealm 的路线是：

1. **先用 Deep Agents 做学习型 PoC**；
2. **用兼容 Provider 接入现有生成流程**；
3. **优先建设 typed tools、文件系统边界、permission control、compact 和 trace**；
4. **保留 zod schema、引用校验、ProjectStore 原子写这些确定性边界**；
5. **等工具和权限稳定后，再引入 skills、长期 memory、LangGraph、RAG、MCP**。

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

