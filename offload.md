# 大结果 Offload

## 结论

大结果 offload 是指：工具调用产生的大块原始结果，不直接塞进下一轮模型 prompt，而是写到本次 Agent run 的 scratch 文件里；prompt 中只保留摘要、关键片段和可再次读取的路径。

它不是丢弃结果，而是把结果从“模型上下文”转移到“可寻址的运行时文件系统”。

## 为什么需要

Agent loop 每一轮都会重新装配上下文。如果把大文件树、大源码文件、大 git diff、长 grep 结果、完整 trace 或大量工具结果反复塞进 prompt，会带来几个问题：

- token 成本和延迟上升；
- 上下文窗口更容易被撑满；
- 旧信息和噪声干扰当前决策；
- prompt caching 更难命中；
- 模型更容易被无关细节带偏。

offload 的目标是让“大结果可追溯，但不常驻 prompt”。

## 放到哪里

建议按 run 隔离，把工具结果写入本次运行目录，例如：

```txt
~/.sourcerealm/agent-runs/<runId>/
  trace.jsonl
  scratch/
    tool-results/
      grep-001.json
      git-diff-002.patch
      file-tree-003.json
```

其中：

- `trace.jsonl` 保存完整运行过程，方便审计和回放；
- `scratch/tool-results/` 保存大工具结果；
- prompt 只引用这些文件的摘要和路径；
- 过期 run 可以按保留期归档或清理，避免无限增长。

## Prompt 中保留什么

prompt 里不要放完整大结果，而应保留：

- 工具名和调用目的；
- 命中数量、文件数量、结果大小等概览；
- 与当前任务最相关的少量关键片段；
- 已知结论或待验证假设；
- 完整结果路径；
- 需要时下一步应该读取的具体文件或行号范围。

示例：

```txt
grep_code 结果摘要：
- 搜索 pattern: ProjectStore
- 命中 18 个文件，主要集中在 packages/server/src/store.ts、generator.ts、updater.ts
- 与 JSON 持久化、生成流程、增量更新有关
- 完整结果见 scratch/tool-results/grep-001.json
- 下一步优先读取 packages/server/src/store.ts 的 writeJson 相关实现
```

## 什么时候 offload

适合 offload 的结果包括：

- 很大的 `grep` / `rg` 搜索结果；
- 大型文件树；
- 大型 `git diff`；
- 长源码文件全文；
- 大量测试日志；
- 大型 JSON / trace / 运行报告；
- 多轮工具调用积累出的历史结果。

可以用阈值触发，例如：

- 单次工具结果超过固定字符数或 token 估算；
- 命中文件数超过上限；
- diff 超过最大行数；
- 工具结果不再是当前推理必须全文阅读的材料。

## 和 Compact 的关系

offload 和 compact 是配套机制：

- offload 负责把大块原始材料移出 prompt，保存到 scratch；
- compact 负责把历史消息、阶段进展、工具观察压缩成短摘要；
- 需要精查时，再通过路径读取 offload 文件中的具体片段。

一句话：offload 保存原始证据，compact 保存当前可用结论。

## SourceRealm 中的落地含义

对 SourceRealm 的 Agent Harness 来说，大结果 offload 可以作为 context management 的基础能力：

- `grep_code`、`git_diff_since`、`list_files` 等 typed tools 返回过大时写入 `scratch/tool-results/`；
- 每轮 context 装配只放摘要和路径；
- `read_ref` / `read_file` / 专门的 `read_tool_result` 可以按需读取具体片段；
- trace 全量写文件，但不全量塞回模型；
- prompt caching 的稳定前缀不应被大结果破坏，大结果摘要应放在 volatile 后缀。

这样可以同时保留可追溯性、降低 token 成本，并减少长任务上下文膨胀。
