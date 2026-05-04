# v4 — Cross-Domain Declarative Comprehension

The actual claim being tested for the first time:

> Across many different declarative tasks — projects, intents, agents, ops pipelines, audits — builder is a more compact and uniform grammar than markdown or prose, because it composes nouns + named verbs into a single chained expression. Other formats can't *be* declarative composition — they have to *describe* it.

## What v4 measures

For each (task, format) cell:
1. **Compression** — chars to declare the same content
2. **Comprehension** — when the executor reads the declaration and is asked to produce a manifest of "every concrete component, action, or output that should result," what % of the gold elements are present?

Both metrics together answer:
- If builder wins compression AND comprehension → real win, kept
- If builder wins compression but loses comprehension → terseness without clarity
- If builder loses compression → skill is dead

## Why this is different from v1–v3.5

| Eval | Tested |
|---|---|
| v1 | parseability of structure (no downstream consumer) |
| v2 | Python codegen from a spec (one domain) |
| v3 | ops-plan → execution (one shape — sequential/parallel) |
| v3.5 | executor parsing of ops plans (same shape) |
| **v4** | **declaration → comprehension across 5 different domains** |

## 5 domains

1. **Project spec** — declare a system to build (e.g. websocket game)
2. **Email intent** — declare a triage rule over an inbox
3. **Agent definition** — declare an agent's frame, tools, and outputs
4. **Ops pipeline** — declare a CI/CD pipeline (different from v3 tasks)
5. **Audit / multi-criteria evaluation** — declare what gets evaluated against what

## Scoring

For each task, gold_elements is a list of strings that should appear (case-insensitive substring) in the executor's manifest. Score = matched / total.

Hallucinated extras (not in gold) are noted but don't penalise.
