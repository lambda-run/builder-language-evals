# builder-language-evals

An honest accounting of whether the [`builder-language`](skill/SKILL.md) Claude Code skill — a ~95-line instruction set that pushes an AI to express compositional designs as `Noun.verb(args).verb(SubNoun.verb(args))` chains — actually earns its keep.

Four evals, escalating in scope. **One real win, three null results.** The skill is kept as a personal notation aid; it is not a productivity multiplier.

---

## What this is

A repo of evals for a single Claude Code skill. Each eval (v1 → v4) tests a progressively bolder version of the skill's claim. Every result, including the negatives, is committed.

The skill itself is at [`skill/SKILL.md`](skill/SKILL.md). It teaches the model to write a strict outline grammar:

```
ResearchTask
  .frame(question: "...", decision_by: "...")
  .parallelize(
      subagent(name: "market", task: t1, context: c1),
      subagent(name: "legal",  task: t2, context: c2))
  .transform(into: "synthesis_doc", format: "markdown")
  .human_in_loop(reviewer: "Lyndon")
  .run()
```

It's `description`-gated, so it only loads when the model decides the prompt warrants it. Per-conversation cost is zero when idle.

---

## Why it exists

[Dexter Horthy](https://twitter.com/dexhorthy) (HumanLayer / 12-Factor Agents) replied to a description of the skill with: **"Show me the evals."** He sharpened the question to: *"is this better than naive prompting?"* and *"is your intent to compile this to an AST and execute it, or is it just syntax that goes into the token hole?"*

This repo answers those questions. Each eval was designed against the steel-manned version of the prior result — when v1 looked good in isolation, v2 stress-tested whether the format actually changed downstream behavior. When v2 came back null, v3 reframed the claim. When v3 came back ~null, v3.5 isolated the executor. When that came back ~null, v4 tested the broadest version of the claim across five different domains.

---

## What's validated, and what isn't

| Claim | Eval | Result |
|---|---|---|
| The skill produces structurally parseable output more reliably than naive prompting. | [v1](reports/eval-v1-parseability-2026-05-03T20-06-53-399.md) | **✅ Validated.** 83% parseable vs 40% naive on technical prompts; 80% vs 5% on adversarial. Real, but only matters if downstream tooling exists to consume the AST. None does. |
| The skill makes downstream code generation more correct. | [v2](reports/eval-v2-execution-2026-05-03T21-23-02-720.md) | **❌ Null.** All formats tied at 33/38 (87%). Builder produced ~30% longer code for the same correctness. Sonnet 4.6 normalises any reasonable spec format internally. |
| The skill makes a better agent-to-agent wire format (planner → executor). | [v3](reports/eval-v3-wire-format-2026-05-04T10-51-44-825.md) | **❌ Null.** All formats hit 100% coverage and 100% gold parallelism after a gold-trace fix. Markdown won total tokens, but the win was a planner-output artefact, not executor parsing. |
| The win above survives executor isolation (perfect plans, only the executor varies). | [v3.5](reports/eval-v3.5-executor-isolation-2026-05-04T10-59-56-246.md) · [cross-model](reports/eval-v3.5-cross-model-2026-05-04T12-13-46-235.md) | **❌ Null.** All five formats — builder, two markdown variants, json, terse — hit 100/100 on Sonnet and GPT-5.5. Token ranking flipped vs v3, confirming v3's token gap was upstream noise. |
| Across many domains, builder is more compact AND more comprehension-friendly than markdown or prose. | [v4](reports/eval-v4-cross-domain-2026-05-04T12-44-19-739.md) | **❌ Null.** Across 5 domains (project spec, intent, agent def, CI pipeline, audit) on Sonnet 4.6 + GPT-5.5: comprehension within ~2pp on both models. Markdown wins compression by 4%. Sonnet leans builder, GPT-5.5 leans markdown — within noise. |

**Net:** the skill produces a parseable AST that nobody is currently consuming, and on every other axis the differences are within noise.

---

## v4 headline (the broadest test)

5 tasks × 3 formats × 2 models. Hand-written declarations, equal effort, no reverse-translation. [Full report](reports/eval-v4-cross-domain-2026-05-04T12-44-19-739.md).

| | builder | markdown | prose |
|---|---:|---:|---:|
| **Compression** (total chars across 5 tasks) | 2,318 | **2,235** | 2,488 |
| **Comprehension** (Sonnet 4.6, gold-element coverage) | **95.1%** | 93.7% | 93.5% |
| **Comprehension** (GPT-5.5, gold-element coverage) | 93.9% | **95.0%** | 92.1% |

The two models disagree on the winner, and every cell is within ~2pp. Comprehension does not depend on format at this complexity level for either model.

---

## Why null results are the headline

Three structural reasons we kept finding null:

1. **Modern frontier models normalise format.** Sonnet 4.6 and GPT-5.5 internally restructure any reasonable spec into the same plan. Format only matters when the executor is brittle.
2. **Markdown has a training-data tailwind.** BPE tokenizers and training corpora have seen orders of magnitude more markdown than any custom DSL. A custom grammar starts from a deficit it has to overcome before it can show a win.
3. **Compression-vs-clarity tradeoff is real.** When builder *did* compress, it also dropped scaffolding words the model uses to disambiguate. Net effect was a wash.

These confounds are documented in [`feedback_format_evals_training_bias`](https://github.com/lambda-run/builder-language-evals) and would apply to *any* future evaluation comparing a custom notation against markdown. They are the reason DSPy-style optimization is unlikely to help here — it would converge on markdown variants.

---

## Where the skill still lives

Kept, but for a narrow reason: **personal notation aid**. The author finds the chain syntax helps them think and review. The skill is description-gated, so it costs zero context when not invoked, and can be force-loaded via `/builder-language`.

It is **not** recommended as a productivity multiplier for agent reasoning, agent-to-agent communication, or compression. Those claims didn't survive testing.

---

## What the eval suite did NOT measure

- **Human review time / scannability.** A 5-reviewer × 10-output study (time-to-find-bug) is the only experiment that could rescue the bold claim. Not run.
- **Weaker executor models.** Haiku-class and small open-weight models may show more format sensitivity than Sonnet/GPT-5.5. Not tested.
- **Genuinely huge specs.** All eval tasks fit on one screen. Specs with 50+ rules and deep dependency trees may behave differently. Untested.
- **Dependency-violation penalty in v3.** Gemini flagged this as the one outstanding methodology hole. Designed but not implemented.

If the skill ever needs to be defended or revisited, those four are the experiments to run, in that order.

---

## Models used

| Role | Model | Why |
|---|---|---|
| SUT | `anthropic/claude-opus-4.7` | Anthropic flagship (v1 only). |
| SUT | `anthropic/claude-sonnet-4.6` | Anthropic mid — what most Claude Code users run. Used in every eval. |
| SUT | `anthropic/claude-haiku-4.5` | Anthropic small — cheap regression line (v1 only). |
| SUT | `openai/gpt-5.5` | Cross-family — does the language travel? Used v3.5 + v4. |
| Judge | `google/gemini-3.1-pro-preview` | Independent (non-Anthropic). Also used as adversarial methodology reviewer between evals. |

Total spend across all four evals: **<$10**.

---

## Reproduce

Requires [Bun](https://bun.sh) and an [OpenRouter](https://openrouter.ai) API key.

```bash
git clone https://github.com/lambda-run/builder-language-evals
cd builder-language-evals
bun install

export OPENROUTER_API_KEY=sk-or-v1-...
export GEMINI_API_KEY=...

# v1 — parseability (the validated win)
bun run dry                                 # 1 prompt × Haiku × 3 conditions, ~$0.05
bun run eval                                # full sweep, ~$6, 26 min
bun run scripts/score-parseability.mjs      # AST scoring against cached outputs

# v2 — downstream codegen
bun v2/scripts/run-v2.mjs

# v3 / v3.5 — wire format + executor isolation
bun v3/scripts/run-planner-executor.mjs
bun v3.5/scripts/generate-plans.mjs && bun v3.5/scripts/execute.mjs

# v4 — cross-domain comprehension
bun v4/scripts/compression.mjs
bun v4/scripts/comprehend.mjs
bun v4/scripts/score-and-report.mjs
```

The v1 parseability scorer reads `artifacts/results.json` (cached from any prior run) and emits a fresh report — no re-running of the SUT models needed.

---

## Layout

```
skill/SKILL.md              # the skill being evaluated

v1 (in repo root)           # parseability — the one validated win
  promptfoo/                # full eval config (12 providers × all datasets)
  datasets/                 # should-use, should-skip, adversarial prompts
  assertions/               # promptfoo assertions
  scripts/score-parseability.mjs

v2/                         # downstream codegen — null
v3/                         # planner+executor wire format — null
v3.5/                       # executor isolation, cross-model — null
v4/                         # cross-domain comprehension + compression — null

reports/                    # date-stamped markdown summaries (committed)
artifacts/                  # gitignored — promptfoo HTML reports, results.json
```

---

## License

MIT — see [LICENSE](LICENSE).
