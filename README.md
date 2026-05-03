# builder-language-evals

Evaluation suite for the [`builder-language`](skill/SKILL.md) Claude Code skill — a 90-line instruction set that forces an AI to express compositional designs as `Noun.verb(args).verb(SubNoun.verb(args))` chains instead of prose or premature code.

---

## TL;DR

| | with-skill | with-naive | without-skill |
|---|---:|---:|---:|
| **Parseable specs** (technical prompts) | **83%** | 40% | 45% |
| **Parseable specs** (adversarial prompts) | **80%** | 30% | 90%¹ |
| **Clean specs** (parseable + no banned syntax) | **78–80%** | 5–28% | 20–33% |

¹ Without-skill scores high on raw "parseable" because the model often emits a single-token noun (avg 1.0 AST nodes — content-empty). The skill produces avg 9 nodes per output (real chains).

**The skill earns its 90 lines by getting downstream-parseable rate from 40% to 83%.**

---

## Who · What · Why · When · Where

- **Who** — Claude Code (the agent doing the work). Anyone using Anthropic models via the SDK or Claude Code can install the skill.
- **What** — A 90-line instruction set that turns rambling AI prose into a strict `Noun.verb()` outline downstream tools and humans can both read.
- **Why** — Two reasons: (1) **machines** can mechanically parse the output (build diagrams, run diffs, feed to other agents); (2) **humans** can scan the structure in seconds instead of reading paragraphs.
- **When** — Loaded during the planning / spec-writing phase, before the agent acts. Skill auto-skips for casual prompts (chitchat, narrative, yes/no).
- **Where** — Injected into the system prompt at the human-to-agent handoff. Lives in `~/.claude/skills/builder-language/` for Claude Code users.

---

## The business case

When you ask an AI to design a technical system, you typically get one of two failure modes:

1. **A wall of prose** that hides the structure. Fine to read, useless for tooling.
2. **Premature code** that locks you into one implementation. Hard to review, harder to change.

The `builder-language` skill forces a third path: a clean, indented outline that's both human-scannable in seconds and mechanically parseable. That unlocks two distinct value streams:

### Value stream 1 — Machine consumability (what we measured here)

Any downstream automation that wants to consume agent output (auto-generated diagrams, design-diff views, exporters, code-generation, feeding specs to other agents) needs to convert the output into a tree. With prose, you can't. With a strict format, you can.

We measured this with a recursive-descent parser. Result: **the skill produces parseable output 83% of the time on technical prompts; the naive prompt manages 40%.** The gap closes the door on a class of downstream-tooling failures that occur silently with prose.

### Value stream 2 — Human review time (we didn't measure this — yet)

The strongest business case for a CTO is human review time on AI outputs. A human reviewer reading four paragraphs of AI prose takes ~10x longer than scanning a strict `Data.filter(x).route(y)` chain — and prose hides edge cases the chain makes visible.

That metric needs a small user study (5 reviewers × 10 outputs each, time-to-find-bug). It is not in this eval. We flag it because it's the next experiment that would convert "the skill makes outputs parseable" into "the skill saves engineering time on review."

---

## The question Dex asked

> *"Show me the evals."* — and on follow-up: *"is this better than naive prompting?"*

Three system-prompt conditions, head-to-head:

| Condition | System prompt | What it tests |
|---|---|---|
| `with-skill` | Full SKILL.md (~90 lines) | Does the skill ship as designed? |
| `with-naive` | One sentence: *"respond using a fluent builder-chain syntax"* | Does the 90 lines beat one line? |
| `without-skill` | None | Baseline. |

Across 25 prompts × 4 SUT models × 3 conditions = 300 cells per run.

---

## What we test and why

| Test | What it measures | Why it matters |
|---|---|---|
| **Chain found** | Did the model produce a chain-shaped region, or default to prose / YAML / freeform? | Adoption gate. No chain = no downstream tooling has anything to grab. |
| **Parseable** | Did that chain survive a recursive-descent parser without a hard syntax error? | The bar a downstream tool must clear. If it doesn't parse, no UI, no diff view, no exporter, no code-gen on top. |
| **Clean** | Parseable AND no banned syntax (`->` arrows, leading-dot sub-chains, lowercase root nouns, Unicode `→`). | Banned syntax breaks the mental model — arrows push humans toward executable thinking; leading-dot looks like invalid code and downstream parsers silently "correct" it. |
| **AST depth** | Levels of nesting (root noun → SubNoun → SubSubNoun). | Depth = real compositional structure. Distinguishes a flat list from a hierarchy. |
| **AST nodes** | Count of `.verb()` calls in the parsed tree. | Density. 1-node = stub. 8–15 = a real spec. |
| **Violation classes** | Per-condition counts of each banned-syntax type. | Tells us *which* problems the skill prevents, *which* still leak through. |

**Critically: parseability is the only metric that's non-circular.** Neither prompt is told "be parseable." Both have the same opportunity to produce structurally sound output. The 83% vs 40% gap is a fair measure of which prompt actually delivers something machines can use.

---

## Prompt buckets

| Bucket | Count | Description |
|---|---:|---|
| `should_use` | 10 | Technical / compositional prompts where the skill *should* fire (spec an inbox watcher, design a research agent, spec a CI pipeline). |
| `should_skip` | 10 | Prompts where the skill should NOT fire — casual chitchat, narrative requests, yes/no questions, factual lookups. Tests audience-discrimination. |
| `adversarial` | 5 | **Edge-cases designed to trick the AI into breaking the skill's rules.** Each prompt subtly tempts a specific failure mode. |

### What "adversarial" actually means

Each adversarial prompt is engineered to tempt one specific failure:

| Prompt theme | The trap | Example phrasing |
|---|---|---|
| **Lambda trap** | Tempt the model to use `->` arrow / lambda syntax. | *"Spec a pipeline that filters items where value > threshold, and **for each one** transforms it by **applying a function f**."* |
| **Synonym creep** | Tempt the model to invent verbs instead of using standard vocabulary. | *"Spec an agent that broadcasts updates over multiple paths to several recipients. **Be expressive with verb names — use the most natural English you can.**"* |
| **Drop the SubNoun capture** | Tempt the model to use leading-dot sub-chains `(.verb()...)` instead of named SubNouns. | *"Spec an importance scorer. Inside it, compose three sub-rules — a sender allowlist, a keyword matcher, a recency check."* |
| **Executable drift** | Tempt the model to write code-style return/emit statements. | *"Spec a guard that, given a request, **returns either pass or fail**. On fail, **emit an error**."* |
| **Callback-of-event** | Tempt the model to write event-handler-style callbacks (function-of-event). | *"Design a webhook handler that **for each incoming event**, validates the payload, then **calls back** with success or failure."* |

The point of adversarial prompts: they answer "does the skill hold up when the natural way to phrase the problem is also a trap?" If a skill only works on softballs, it's not a skill — it's a coincidence.

---

## Headline result (with-skill vs with-naive)

| Metric | Bucket | with-skill | with-naive | Δ (skill – naive) |
|---|---|---:|---:|---:|
| Parseable | should_use | **83%** | 40% | **+43pp** |
| Parseable | adversarial | **80%** | 30% | **+50pp** |
| Clean | should_use | **78%** | 28% | **+50pp** |
| Clean | adversarial | **80%** | 5% | **+75pp** |
| Avg AST nodes (content density) | should_use | 13.6 | 9.5 | +4.1 nodes |

**The biggest gap is on adversarial.** Where the prompt is engineered to bait the model into messy code, the naive prompt produces clean output 5% of the time. The skill: 80%. That's a 16× difference, and it's the cleanest evidence that the 89 extra lines do real work — they prevent failures the one-liner can't anticipate.

Full v1 report: [`reports/eval-v1-parseability-2026-05-03T20-06-53-399.md`](reports/eval-v1-parseability-2026-05-03T20-06-53-399.md)

---

## Models tested

| Role | Model | Why |
|---|---|---|
| SUT | `anthropic/claude-opus-4.7` | Anthropic flagship. |
| SUT | `anthropic/claude-sonnet-4.6` | Anthropic mid — what most Claude Code users run. |
| SUT | `anthropic/claude-haiku-4.5` | Anthropic small — cheap regression line. |
| SUT | `openai/gpt-5.5` | Cross-family — does the language travel? |
| Judge | `google/gemini-3.1-pro-preview` | Independent (non-Anthropic). Structured output via `responseSchema` — no regex parsing. |

Total cost of the full sweep: **$5.81** (300 cells, 26 minutes).

---

## What this eval does NOT measure (yet)

Honest list of what's missing:

- **Human review time.** The strongest business case (above) is unproven. Needs a 5-reviewer × 10-outputs user study.
- **Downstream agent execution quality.** Does feeding a builder-spec to an executing agent produce strictly better work than feeding the same task as prose? That's the deepest version of "does the skill make agents better." Designed but not run — the right experimental shape is JSON-to-JSON transformation against deterministic ground truth (~$5–20, half a day).
- **Reading-time comprehension across team members.** Same study territory as #1.

These are the natural next experiments. v1 (this) closes the loop on "does the skill produce machine-usable output." Future versions would close the loop on "does that translate into business outcomes."

---

## Reproduce

Requires [Bun](https://bun.sh) and an [OpenRouter](https://openrouter.ai) API key.

```bash
git clone https://github.com/lambda-run/builder-language-evals
cd builder-language-evals
bun install

export OPENROUTER_API_KEY=sk-or-v1-...
export GEMINI_API_KEY=...

bun run dry                                 # 1 prompt × Haiku × 3 conditions, ~$0.05
bun run eval                                # full sweep, 12 providers × 25 prompts (~$6, 26 min)
bun run scripts/score-parseability.mjs      # v1 AST scoring against cached outputs
bun run view                                # promptfoo HTML report
```

The parseability scorer reads `artifacts/results.json` (cached from any prior run) and emits a fresh report — no re-running of the SUT models needed.

---

## Layout

```
skill/SKILL.md              # snapshot of the skill being evaluated

promptfoo/
  main.yaml                 # full eval config (12 providers × all datasets)
  dry.yaml                  # 1-prompt smoke check, ~$0.05

datasets/
  should-use.yaml           # 10 prompts that should trigger the skill
  should-skip.yaml          # 10 prompts that should NOT trigger
  adversarial.yaml          # 5 prompts that tempt specific failure modes

assertions/                 # promptfoo assertions (v0)
  has-chain.cjs
  no-arrows.cjs
  named-subnouns.cjs
  vocab-discipline.cjs

prompts/
  with-skill-system.txt     # system-prompt template, {{SKILL_BODY}} substituted
  naive-prompt.txt          # one-line "respond in builder syntax" baseline
  adoption-rubric.txt       # LLM judge: is the form right?
  completeness-rubric.txt   # LLM judge: does the chain cover the request?

providers/
  openrouter.cjs            # custom JS provider, captures OR's native cost field
  gemini-judge.cjs          # judge with responseSchema for guaranteed-valid JSON

scripts/
  run-promptfoo.sh          # entry: loads .env, runs promptfoo eval
  report.mjs                # v0 aggregation (LLM-judge metrics)
  score-parseability.mjs    # v1 AST parser: parseable / clean / depth / nodes

artifacts/                  # gitignored — promptfoo HTML reports, results.json
reports/                    # date-stamped markdown summaries (committed)
```

---

## Background

This eval exists because [Dexter Horthy](https://twitter.com/dexhorthy) (HumanLayer / 12 Factor Agents) replied to a description of the `builder-language` skill with: **"Show me the evals."**

He sharpened the question: *"is this better than naive prompting?"* — which is why we test three system-prompt conditions, not two.

He also asked the deepest version: *"is your intent to compile this to an AST and execute it, or is it just syntax that goes into the token hole?"* The v1 parseability score is the honest answer: **the AST is the eval**. If the output parses, downstream tools can do whatever they want with it. If it doesn't, all you have is text. The skill earns its 90 lines by getting parseable rate from 40% to 83% — and from 5% to 80% on adversarial prompts.

## License

MIT — see [LICENSE](LICENSE).
