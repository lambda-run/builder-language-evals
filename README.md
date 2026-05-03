# builder-language-evals

Evaluation suite for the [`builder-language`](skill/SKILL.md) Claude Code skill.

Built with [`promptfoo`](https://promptfoo.dev), using OpenRouter for SUT calls, Google Gemini (with structured output) as the judge for soft metrics, and a recursive-descent AST parser for the hard metric.

---

## Headline (v1 — parseability)

| Bucket | with-skill | with-naive | without-skill | Δ skill–naive |
|---|---:|---:|---:|---:|
| **Parseable** (should_use) | **83%** | 40% | 45% | **+43pp** |
| **Parseable** (adversarial) | **80%** | 30% | 90%¹ | **+50pp** |
| **Clean** (should_use) | **78%** | 28% | 33% | **+50pp** |
| **Clean** (adversarial) | **80%** | 5% | 20% | **+75pp** |

¹ Without-skill scores higher on raw "parseable" in adversarial because the model often emits a single-token noun (avg 1.0 AST nodes) — technically parseable, but content-empty. The skill produces avg 9.1 nodes per output (real chains).

Full v1 report: [`reports/eval-v1-parseability-2026-05-03T20-06-53-399.md`](reports/eval-v1-parseability-2026-05-03T20-06-53-399.md)

---

## The problem in plain English

When you ask an AI to design a technical system (a spec, a pipeline, an architecture), you usually get one of two failure modes:

1. A **wall of prose** that hides the structure.
2. **Premature code** that locks you into one implementation.

The `builder-language` skill tries to force a third path: a clean, indented `Noun.verb(args).verb(args)` outline that a human can scan in 5 seconds and a downstream tool can mechanically parse into a tree.

**The question:** is the 90-line skill worth keeping vs a one-line prompt?

**The business advantage we're validating:** if the skill produces strictly more parseable, structurally consistent output, then any downstream automation — auto-generated diagrams, feeding specs to a coding agent, side-by-side design diffs, machine-extracted decisions — can rely on the format. With the naive prompt, downstream automation breaks ~60% of the time on technical prompts. With the skill, ~17%. **That gap is the business case.**

---

## What we test and why

| Test | What it measures | Why it matters (business advantage) |
|---|---|---|
| **Chain found** | Did the model produce a chain-shaped region, or did it default to prose / YAML / freeform? | Adoption gate. If no chain, no downstream tooling has anything to grab. |
| **Parseable** | Did that chain survive a recursive-descent parser without a hard syntax error (balanced brackets, valid identifiers, well-formed args)? | The bar a downstream tool must clear. If it doesn't parse, you can't build a UI, diff view, exporter, or code-generator on top. |
| **Clean** | Parseable AND no banned syntax (`->` arrows, leading-dot sub-chains `(.verb()...)`, lowercase root nouns, Unicode `→`). | Banned syntax breaks the mental model: arrows push humans toward executable thinking; leading-dot looks like invalid code and downstream parsers silently "correct" it. |
| **AST depth** | Levels of nesting (root noun → SubNoun → SubSubNoun). | Depth = expressed compositional structure. Distinguishes flat lists from real hierarchies. |
| **AST nodes** | Count of `.verb()` calls in the parsed tree. | Density of expressed content. 1-node = just the root (junk). 8–15 = a real spec. |
| **Violation classes** | Per-condition counts of each banned-syntax type. | Tells us *which* problems the skill prevents and *which* still leak through. |

**Critically: parseability is the only metric that's non-circular.** Neither the skill nor the naive prompt is told "be parseable." Both have the same opportunity to produce structurally sound output. The parseable rate is a fair measure of which prompt actually delivers something machines can use.

The banned-syntax counts (arrow / leading-dot / vocab discipline) are *partly* circular — the skill bans them explicitly, the naive doesn't. We report them because they're real downstream pain points, but the headline number to trust is **parseable**.

---

## Three system-prompt conditions

| Condition | System prompt | Tests |
|---|---|---|
| `with-skill` | Full SKILL.md (~90 lines) | Does the skill ship as designed? |
| `with-naive` | One sentence: *"respond using a fluent builder-chain syntax"* | Is the skill better than naive prompting? *(Dex's question.)* |
| `without-skill` | None | Baseline. |

Across 25 prompts (10 should-use, 10 should-skip, 5 adversarial) × 4 SUT models × 3 conditions = 300 cells per run.

---

## Models tested

| Role | Model | Why |
|---|---|---|
| SUT | `anthropic/claude-opus-4.7` | Anthropic flagship |
| SUT | `anthropic/claude-sonnet-4.6` | Anthropic mid — what most Claude Code users run |
| SUT | `anthropic/claude-haiku-4.5` | Anthropic small — cheap regression line |
| SUT | `openai/gpt-5.5` | Cross-family — does the language travel? |
| Judge | `google/gemini-3.1-pro-preview` | Independent (non-Anthropic). Structured output via `responseSchema` — no regex parsing. |

---

## v0 metrics (still in the suite, less load-bearing)

These were the original promptfoo metrics. They tell us the skill works *as designed*, but several are partly tautological — the skill defines a vocabulary, then we measure adherence to that vocabulary, etc. Useful for regression detection; not useful for "is the skill worth its 90 lines."

- **adoption** (LLM-judged 1–5): is the form right for the prompt?
- **completeness** (LLM-judged 1–5): does the chain capture the prompt's major aspects?
- **vocab discipline** (deterministic ratio): standard verbs / total verbs.
- **no-arrows** (deterministic): no `->`.
- **named-subnouns** (deterministic): no leading-dot sub-chains.
- **has-chain** (deterministic regex): chain shape detected.

Full v0 report: [`reports/eval-2026-05-03T17-15-34-258.md`](reports/eval-2026-05-03T17-15-34-258.md)

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
bun run eval                                # full sweep — 12 providers × 25 prompts (~$6, 26 min)
bun run scripts/score-parseability.mjs      # v1 parseability scoring against cached outputs
bun run view                                # open promptfoo HTML report
```

The parseability scorer reads `artifacts/results.json` (cached from any prior `eval` run) and emits a fresh report — no re-running of the SUT models needed.

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

assertions/
  has-chain.cjs             # detect chain shape (uses test metadata.expect_chain)
  no-arrows.cjs             # ban `->` lambda syntax
  named-subnouns.cjs        # ban leading-dot sub-chains
  vocab-discipline.cjs      # measurement: standard verb ratio

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

He also asked the deepest version: *"is your intent to compile this to an AST and execute it, or is it just syntax that goes into the token hole?"* The v1 parseability score is the honest answer: **the AST is the eval**. If the output parses, downstream tools can do whatever they want with it (diagrams, code-gen, diff). If it doesn't, all you have is text. The skill earns its 90 lines by getting parseable rate from 40% to 83%.

## License

MIT — see [LICENSE](LICENSE).
