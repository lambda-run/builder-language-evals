# builder-language-evals

Does forcing Claude to write plans in a custom, chainable syntax actually improve its performance?

We ran five escalating evaluations to find out. **The short answer: mostly no — with one preliminary positive at depth that's worth more testing.**

The [`builder-language`](skill/SKILL.md) skill does not improve downstream code generation, is not a better wire format between agents, and ties markdown/prose at one-screen scale. v5 (added after the original four nulls) tested whether depth changes the picture and found that on a single ~35-element, 4-level-deep spec, builder won both compression (-10% vs markdown) and comprehension (+3-11pp on both Sonnet 4.6 and GPT-5.5). One task isn't a finding, but it's the first non-null in the suite and it points at the only axis we hadn't stressed.

---

## What the skill does

It teaches Claude to take a plan that would normally come out like this:

> *"I need to answer a research question by a given deadline. Run two subagents in parallel — one to dig into the market angle, one to dig into the legal angle — each with its own task description and context. Combine the outputs into a single markdown synthesis doc, have Lyndon review it, then kick it off."*

…and instead express it as a strict noun + named-verb chain:

```ts
ResearchTask
  .frame(question: "...", decision_by: "...")
  .parallelize(market_agent, legal_agent)
  .transform(into: "synthesis_doc", format: "markdown")
  .approve(lyndon)
```

`market_agent`, `legal_agent`, and `lyndon` are named bindings defined elsewhere. The chain composes named values rather than restating each one's arguments inline, and invents a domain verb (`.approve()`) instead of a generic `human_in_loop(reviewer:)` wrapper.

Same plan. The hypothesis was that the second form is easier for downstream tools and for the next agent in the loop to consume. It isn't — see below.

When [Dexter Horthy](https://twitter.com/dexhorthy) (HumanLayer / 12-Factor Agents) replied to a description of the skill with **"show me the evals"** and sharpened it to *"is this better than naive prompting?"* — this repo is the answer.

---

## The results

| Claim | Eval | Reality |
|---|---|---|
| The output is parseable as a strict AST. | [v1](reports/eval-v1-parseability-2026-05-03T20-06-53-399.md) | **True but irrelevant.** 83% parseable vs 40% naive on technical prompts; 80% vs 5% adversarial. We have no downstream tool that consumes the AST. Generating an orphaned data structure is not a win. |
| It improves downstream code generation. | [v2](reports/eval-v2-execution-2026-05-03T21-23-02-720.md) | **False.** All formats tied at 33/38 (87%). Builder produced ~30% longer code for the same correctness. |
| It's a better agent-to-agent wire format. | [v3](reports/eval-v3-wire-format-2026-05-04T10-51-44-825.md) | **False.** All formats hit 100% coverage and 100% gold parallelism. Markdown won total tokens. |
| The win above survives executor isolation. | [v3.5](reports/eval-v3.5-executor-isolation-2026-05-04T10-59-56-246.md) · [cross-model](reports/eval-v3.5-cross-model-2026-05-04T12-13-46-235.md) | **Confirmed null.** All five formats — builder, two markdown variants, json, terse — hit 100/100 on Sonnet 4.6 and GPT-5.5. |
| Across many domains, builder is more compact AND more comprehension-friendly. | [v4](reports/eval-v4-cross-domain-2026-05-04T12-44-19-739.md) | **False at one-screen scale.** 5 domains × 2 models: comprehension within ~2pp; markdown wins compression by 4%. The two models disagree on the comprehension winner — the differences are noise. |
| At depth (30+ elements, 4+ levels nested) builder pays off. | [v5](reports/eval-v5-depth-2026-05-04T13-56-32-992.md) | **Preliminary positive.** N=1 task: builder wins compression by 10% AND comprehension by 3pp (Sonnet) / 11pp (GPT-5.5) — GPT-5.5 hit 100% on builder. Scorer was patched mid-eval to fix a snake_case ↔ space substring bug; same patch leaves v4's null result unchanged, so the fix isn't biased. Still N=1 — needs 2-3 more deep tasks before "finding." |

For the first four evals, the skill produced a parseable syntax that no system consumes, and on every other axis the differences were within noise. v5 is the first sign that depth might be the axis where the compositional grammar actually pays off — but it's one task, with a post-hoc scorer fix, and needs replication.

---

## v4 headline — null at one-screen scale

5 hand-written tasks × 3 formats × 2 models. Equal effort per format, no reverse-translation. [Full report](reports/eval-v4-cross-domain-2026-05-04T12-44-19-739.md).

| | builder | markdown | prose |
|---|---:|---:|---:|
| **Compression** (total chars across 5 tasks) | 2,318 | **2,235** | 2,488 |
| **Comprehension** (Sonnet 4.6, gold-element coverage) | **95.1%** | 93.7% | 93.5% |
| **Comprehension** (GPT-5.5, gold-element coverage) | 93.9% | **95.0%** | 92.1% |

## v5 headline — preliminary positive at depth

1 hand-written task: ~35 elements, 7 sub-Nouns, 4 levels deep (a distributed Ralph loop spec). [Full report](reports/eval-v5-depth-2026-05-04T13-56-32-992.md).

| | builder | markdown | prose |
|---|---:|---:|---:|
| **Compression** (chars) | **1,291** (-10% vs md) | 1,440 | 1,330 |
| **Comprehension** (Sonnet 4.6) | **91.7%** (33/36) | 88.9% (32/36) | 88.9% (32/36) |
| **Comprehension** (GPT-5.5) | **100.0%** (36/36) | 88.9% (32/36) | 94.4% (34/36) |

GPT-5.5 hit a perfect score on builder — extracted every gold element. First time any format clearly led both axes simultaneously. **Caveat: N=1, post-hoc scorer fix.** See the [v5 report](reports/eval-v5-depth-2026-05-04T13-56-32-992.md) for the full transparency note on the scorer change and the v4 sanity check.

---

## Why it (mostly) failed — and where v5 cracks the story

Three structural reasons custom syntax didn't beat plain text on the first four evals:

1. **Frontier models normalise format internally.** Sonnet 4.6 and GPT-5.5 reconstruct any reasonable spec into the same conceptual plan before reasoning. Format only matters if the executor is brittle, or if the spec is too big to hold whole.
2. **Markdown owns the training data.** BPE tokenizers and training corpora have ingested orders of magnitude more markdown than any custom DSL. A custom grammar starts at a deficit it has to overcome before it can show a win.
3. **Compression and clarity trade off.** When builder compressed at one-screen scale, it did so by dropping scaffolding words the model uses to disambiguate intent. Net effect was a wash.

**v5 suggests a fourth dynamic that runs the other way at depth:** when a spec passes some structural complexity threshold, the chain syntax's explicit composition (sub-Nouns, named bindings, no repeated headers) becomes a comprehension *advantage* rather than a parity tie. Markdown's overhead grows linearly with rule count; builder's grows sub-linearly because composition reuses the noun spine. This is one task of evidence — a hint, not a verdict.

---

## Why I kept it anyway

Two reasons:

1. **I like reading it.** The chain syntax helps me review AI-generated structure at a glance. Aesthetic, not data-backed at one-screen scale (v4) — but v5 adds one task of evidence that this aesthetic preference may also be a measurable productivity advantage when specs get deep.
2. **It's `description`-gated** — the body doesn't load unless the model decides to invoke it. There IS still a small cost: the description line sits in the model's available-skills index every prompt, so the router pays for the decision. Small, but not zero.

If you don't share the aesthetic preference and don't write deeply nested specs, **don't install it.**

---

## What this eval suite did NOT measure

- **Human review time / scannability.** A 5-reviewer × 10-output study (time-to-find-bug) is the only experiment that could rescue the bold claim. Not run.
- **Token generation speed.** Custom DSLs can hurt throughput at decode time independent of total token count. We measured chars and tokens, not tokens/sec.
- **Error recovery.** When the model hallucinates a syntax error in a `Noun.verb()` chain, does it recover as gracefully as it would from a malformed markdown bullet? Untested.
- **Weaker executor models.** Haiku-class and small open-weight models may show more format sensitivity than Sonnet/GPT-5.5. Not tested.
- **More deep tasks.** v5 tested one ~35-element, 4-level-deep spec and got the first non-null result. To call this a finding rather than a preliminary signal, we'd need 2-3 more deep tasks across different domains (e.g. RBAC, multi-stage data pipeline, eligibility rule engine).

If anyone ever needs to revisit whether the skill earns its keep, those are the experiments to run, in roughly that order.

---

## Models used

| Role | Model | Why |
|---|---|---|
| SUT | `anthropic/claude-opus-4.7` | Anthropic flagship (v1 only). |
| SUT | `anthropic/claude-sonnet-4.6` | Anthropic mid — what most Claude Code users run. Used in every eval. |
| SUT | `anthropic/claude-haiku-4.5` | Anthropic small — cheap regression line (v1 only). |
| SUT | `openai/gpt-5.5` | Cross-family — does the language travel? Used v3.5, v4, v5. |
| Judge / reviewer | `google/gemini-3.1-pro-preview` | Independent (non-Anthropic). Also used as adversarial methodology reviewer between evals. |

Total spend across all five evals: **<$10**.

---

## Reproduce the failure

Requires [Bun](https://bun.sh) and an [OpenRouter](https://openrouter.ai) API key.

```bash
git clone https://github.com/lambda-run/builder-language-evals
cd builder-language-evals
bun install

export OPENROUTER_API_KEY=sk-or-v1-...
export GEMINI_API_KEY=...

# v1 — parseability
bun run dry                                 # 1 prompt × Haiku × 3 conditions, ~$0.05
bun run eval                                # full sweep, ~$6, 26 min
bun run scripts/score-parseability.mjs

# v2 — downstream codegen
bun v2/scripts/run-v2.mjs

# v3 / v3.5 — wire format + executor isolation
bun v3/scripts/run-planner-executor.mjs
bun v3.5/scripts/generate-plans.mjs && bun v3.5/scripts/execute.mjs

# v4 — cross-domain comprehension
bun v4/scripts/compression.mjs
bun v4/scripts/comprehend.mjs
bun v4/scripts/score-and-report.mjs

# v5 — depth stress test (preliminary positive)
bun v5/scripts/compression.mjs
bun v5/scripts/comprehend.mjs
bun v5/scripts/score-and-report.mjs
```

The v1 parseability scorer reads `artifacts/results.json` (cached from any prior run) and emits a fresh report — no re-running of the SUT models needed.

---

## Layout

```
skill/SKILL.md              # the skill being evaluated

v1 (in repo root)           # parseability — true but irrelevant
  promptfoo/                # full eval config (12 providers × all datasets)
  datasets/                 # should-use, should-skip, adversarial prompts
  assertions/               # promptfoo assertions
  scripts/score-parseability.mjs

v2/                         # downstream codegen — null
v3/                         # planner+executor wire format — null
v3.5/                       # executor isolation, cross-model — null
v4/                         # cross-domain comprehension + compression — null at one-screen scale
v5/                         # depth stress test — preliminary positive (N=1)

reports/                    # date-stamped markdown summaries (committed)
artifacts/                  # gitignored — promptfoo HTML reports, results.json
```

---

## License

MIT — see [LICENSE](LICENSE).
