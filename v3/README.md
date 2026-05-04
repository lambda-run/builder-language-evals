# v3 — Agent-to-Agent Wire Format

This eval tests the actual hypothesis behind `builder-language`: **is it a better wire format for agent-to-agent communication than JSON or Markdown?**

v1 tested parseability (real but only useful if downstream tooling exists).
v2 tested single-shot Python codegen (null result — formats tied at 87% pass).

v2 had two confounds:
1. The English versions were reverse-translated from the gold builder, baking in pre-decomposed logic.
2. The executor was a single-shot codegen call with no tools and no agent loop. The most builder-favorable scenario (an agent that uses `.parallelize(...)` to dispatch tools concurrently) was never tested.

## v3 design

```
fuzzy user goal
       │
       ▼
┌──────────────────┐
│ Agent A: Planner │   produces a plan in {builder | json | markdown}
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Agent B: Executor│   reads plan, has access to dummy tools (NO Python codegen)
└──────────────────┘    multi-turn loop, can emit parallel tool_calls per response
       │
       ▼
   Trace of tool calls (with parallelism captured)
       │
       ▼
┌──────────────────┐
│ Score            │   - tool coverage vs gold
└──────────────────┘   - parallelism captured (% of parallelizable groups
                          actually emitted in a single response)
                       - end-to-end tokens (planner + executor)
```

5 tasks × 3 conditions × Sonnet 4.6 = 15 cells.

The fuzzy goal is the SAME English ask in every condition. Only the planner's output format differs. The executor is format-blind — it just reads "here is a plan" in whatever shape arrives.

## Decision criteria

If builder doesn't beat the others on tool execution accuracy OR parallelism captured, the skill is dead.

## Tasks

Each task has multiple parallelizable steps + at least one conditional branch — exactly the shape where builder's `.parallelize(...)` and `.if(...)` should help if they help anywhere.
