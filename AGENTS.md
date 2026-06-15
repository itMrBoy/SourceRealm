# Load The `llmdoc` Skill First

Always answer and response in "简体中文"

Before broad source-code exploration, planning, or documentation work, load the `llmdoc` skill.

The main assistant should align with the user before non-trivial plans or edits.

At the end of a non-trivial task, when the work produced durable knowledge, workflow lessons, or useful reflections, the main assistant should proactively use the `llmdoc-update` skill in Codex.

Keep detailed workflow rules, templates, hook behavior, and doc-structure guidance in the `llmdoc` skill.

In any mode, do not start coding with unresolved questions. Before beginning work, ask clarifying questions repeatedly until the requirements are fully understood, then proceed.
