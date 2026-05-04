# builder-language-evals

Does forcing Claude to write plans in a custom, chainable syntax actually improve its performance?

We ran seven evaluations and submitted the methodology to two rounds of adversarial Gemini review. **Honest answer: tied with tight markdown on outcome quality, with one small but directionally-consistent edge — builder shows a slight spec-faithfulness lead when the agent produces an artifact (v7-fair: 9.5 vs 9.0 vs 9.0). That's the structured-DSL-prevents-drift theory, lightly supported.**

The [`builder-language`](skill/SKILL.md) skill is best understood as **two things**:

1. **A human discipline.** Forces the author to compose nouns, verbs, and explicit values rather than dumping prose. The structure happens *before* the LLM sees it — the win is in the human's thinking.
2. **A small intent → delivery accuracy edge.** When the agent then reads the spec and builds something, builder's reduced interpretive degrees of freedom appear to nudge the implementation closer to what was specified. Same argument as TypeScript over JS, or protobuf over free-form JSON. Small effect, N=1 task, would need replication to claim hard.

The skill does **not** improve downstream code-generation correctness (v2, v7), is not a better wire format between agents (v3, v3.5), and does not give the model better comprehension of the spec content (v5c — tight markdown is tied or slightly ahead there). An earlier draft of this README claimed builder won outright at depth on tokens and comprehension. Gemini's review caught the confound: those experiments tightened the builder spec but kept the markdown baseline verbose. With both formats hand-tightened (v5c, v7-fair), the broad outcome wins disappear and only the small faithfulness edge remains.

Every result, including the walked-back claims, is preserved below — that's the methodology trail.

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

Same plan. The hypothesis was that the second form is easier for downstream tools and for the next agent in the loop to consume. It mostly isn't, but it does help one specific reader: the human writing it.

When [Dexter Horthy](https://twitter.com/dexhorthy) (HumanLayer / 12-Factor Agents) replied to a description of the skill with **"show me the evals"** and sharpened it to *"is this better than naive prompting?"* — this repo is the answer.

---

## The results

| Claim | Eval | Reality |
|---|---|---|
| The output is parseable as a strict AST. | [v1](reports/eval-v1-parseability-2026-05-03T20-06-53-399.md) | **True but irrelevant.** 83% parseable vs 40% naive. We have no downstream tool that consumes the AST. |
| It improves downstream code generation. | [v2](reports/eval-v2-execution-2026-05-03T21-23-02-720.md) | **False.** All formats tied at 33/38 (87%). Builder produced ~30% longer code for the same correctness. |
| It's a better agent-to-agent wire format. | [v3](reports/eval-v3-wire-format-2026-05-04T10-51-44-825.md) · [v3.5](reports/eval-v3.5-executor-isolation-2026-05-04T10-59-56-246.md) | **False.** All formats hit 100% coverage and 100% gold parallelism. |
| Across many domains, builder is more compact AND more comprehension-friendly. | [v4](reports/eval-v4-cross-domain-2026-05-04T12-44-19-739.md) | **False at one-screen scale.** All within ~2pp; markdown narrowly wins compression. |
| At depth (30+ elements, 4+ levels nested) builder pays off. | [v5](reports/eval-v5-depth-2026-05-04T13-56-32-992.md) | **Looked positive but had two caveats** — N=1 task, scorer patched mid-eval. |
| The depth win survives a tight rewrite of the builder spec. | [v5b](reports/eval-v5b-tight-2026-05-04T14-15-27-315.md) | **Looked like a clean win** (-26% prompt tokens, +5-6pp comprehension) — but turned out to be the v5b confound. |
| ❌ The depth win survives a fair tight-vs-tight comparison. | [**v5c**](reports/eval-v5c-fair-2026-05-04T15-02-46-395.md) | **No, it dissolves.** When markdown is hand-tightened to match builder's compactness, both formats land at 238 cl100k tokens. Comprehension: tight markdown wins on both Sonnet (97.2% vs 94.4%) and GPT-5.5 (100% vs 97.2%). The v5b "win" was 100% baseline verbosity. |
| Spec format affects the quality of code an agent produces from it. | [v7](v7/) | **NULL on test correctness, model-dependent on tokens, model-dependent on judged quality.** All 6 cells (3 formats × 2 models) hit 100% test pass on a 15-test multi-aspect spec. Initial judge scores looked like markdown produced lower-quality code from Sonnet — but that was the verbose-markdown confound again. |
| Quality difference survives a fair tight-vs-tight comparison. | [**v7-fair**](v7/) | **Mostly null + one small directional finding.** All 6 cells hit 15/15 test pass with 0 hallucinations across formats. Code-quality scores are 9.0-9.5 across the board. The one small consistent gap: **builder leads on spec_faithfulness (avg 9.5 vs markdown 9.0 vs prose 9.0)** — the agent's implementation matches what the spec asked for slightly more often when reading builder. Small effect, N=1 task — directionally consistent with the structured-DSL-prevents-drift theory but needs replication. |

For the first four evals, the skill produced a parseable syntax that no system consumes, and on every other axis the differences were within noise. v5/v5b looked like the depth claim might rescue the skill — but a fair comparison (v5c, v7-fair) showed that builder's apparent wins came from comparing against a verbose baseline. **Once you tighten the markdown baseline too, the wins disappear.**

---

## What Gemini's adversarial review caught (and we conceded)

Sent the whole project (README, skill, all results) to Gemini 3.1 Pro for adversarial review. The four big hits:

1. **v5b headline was confounded.** I tightened builder, kept markdown verbose. The "26% prompt token win" was 100% from baseline verbosity, not format.
2. **v7 token story is mixed.** GPT-5.5 used 45% fewer tokens with builder; Sonnet 4.6 (the primary target model) used *more* tokens with builder than markdown. The "efficiency win" reverses on the primary model.
3. **v7 quality story has a complication.** Prose actually scored highest on spec faithfulness (10.0) and lowest on hallucinations (0). Builder scored mid (8.5) with the most hallucinated methods. The "builder beats markdown" framing was true but incomplete.
4. **Scorer-patched-mid-eval is overfitting risk.** Documented but did it anyway in v5.

Gemini's verdict was **delete the skill**. We didn't go that far — see "Why I kept it anyway" below — but the substance of the critique is conceded.

---

## Why it (mostly) failed

Three structural reasons, two of them now stronger evidence after v5c/v7-fair:

1. **Frontier models normalise format internally.** Sonnet 4.6 and GPT-5.5 reconstruct any reasonable spec into the same conceptual plan before reasoning. Format only matters if the executor is brittle.
2. **Markdown owns the training data.** BPE tokenizers and training corpora have ingested orders of magnitude more markdown than any custom DSL. A custom grammar starts at a deficit it has to overcome before it can show a win.
3. **Brevity is the actual lever, not syntax.** v5c showed that tight markdown matches tight builder on tokens. Builder doesn't compress better than markdown — verbose markdown is just much longer than necessary, and most markdown in the wild is verbose. If you write tight markdown, you get the same cost as tight builder.

---

## Why I kept it

Three reasons, in order of strength:

1. **It's a discipline tool for the human writing the spec.** Forces me to compose nouns + verbs + explicit values rather than dumping prose. The structuring happens before the LLM is involved. This is real but unmeasured — the only experiment that could quantify it is a 5-reviewer time-to-find-bug study, which we didn't run.
2. **Small intent → delivery accuracy edge.** v7-fair shows builder leading on spec_faithfulness by ~0.5 points on a 10-point scale. Directionally consistent with structured-DSL theory; needs more tasks to be sure.
3. **It's `description`-gated** — the body doesn't load unless the model decides to invoke it. The router still pays for the skill description on every prompt (small but not zero).

If you don't share the human-side discipline benefit and don't write spec → artifact prompts where ambiguity would hurt, **don't install it.** The data does not justify it as a token-efficiency tool — tight markdown matches it on tokens, and the absolute differences are tiny.

---

## What this eval suite did NOT measure

- **Human review time / scannability.** The only experiment that could rescue the aesthetic claim with data. Not run. A 5-reviewer × 10-output time-to-find-bug study would settle it.
- **Token generation speed.** Custom DSLs may hurt decode throughput independently of total token count.
- **Error recovery.** When the model hallucinates a syntax error in `Noun.verb()`, does it recover as gracefully as it would from a malformed markdown bullet?
- **Weaker executor models.** Haiku-class and small open-weight models may show real format sensitivity; Sonnet/GPT-5.5 don't.
- **Larger specs.** All eval tasks fit in immediate context. Specs that compete with code for attention may behave differently.

---

## Models used

| Role | Model | Why |
|---|---|---|
| SUT | `anthropic/claude-opus-4.7` | Anthropic flagship (v1 only). |
| SUT | `anthropic/claude-sonnet-4.6` | Anthropic mid — what most Claude Code users run. Used in every eval. |
| SUT | `anthropic/claude-haiku-4.5` | Anthropic small — cheap regression line (v1 only). |
| SUT | `openai/gpt-5.5` | Cross-family — does the language travel? Used v3.5, v4, v5/b/c, v7. |
| Judge / reviewer | `google/gemini-3-pro-preview` | Independent (non-Anthropic). Code quality judge in v7; adversarial methodology reviewer between evals. |
| v7 harness | UK AISI [Inspect AI](https://inspect.aisi.org.uk/) | Agent loop, sandbox, scorer. Open source. |

Total spend across all seven evals: **<$15**.

---

## Reproduce

Requires [Bun](https://bun.sh), an [OpenRouter](https://openrouter.ai) API key, and (for v7) Python 3.12 + `inspect-ai`.

```bash
git clone https://github.com/lambda-run/builder-language-evals
cd builder-language-evals
bun install

export OPENROUTER_API_KEY=sk-or-v1-...
export GEMINI_API_KEY=...

# v1 — parseability
bun run eval && bun run scripts/score-parseability.mjs

# v2 — downstream codegen
bun v2/scripts/run-v2.mjs

# v3 / v3.5 — wire format + executor isolation
bun v3/scripts/run-planner-executor.mjs
bun v3.5/scripts/generate-plans.mjs && bun v3.5/scripts/execute.mjs

# v4 — cross-domain comprehension
bun v4/scripts/{compression,comprehend,score-and-report}.mjs

# v5 / v5b / v5c — depth, then tight builder, then fair comparison
bun v5/scripts/{compression,comprehend,score-and-report}.mjs
bun v5b/scripts/{compression,comprehend,score-and-report}.mjs
bun v5c/scripts/{compression,comprehend,score-and-report}.mjs

# v7 — agent builds artifact in sandbox; scored by tests + Gemini judge
cd v7 && python3 -m venv .venv && .venv/bin/pip install inspect-ai openai anthropic pyyaml
.venv/bin/inspect eval scripts/eval.py@job_scheduler_fair --model openrouter/anthropic/claude-sonnet-4.6 -T format=builder
.venv/bin/python /tmp/judge-fair.py   # see v7/scripts for judge driver
```

---

## Layout

```
skill/SKILL.md              # the skill being evaluated

v1 (in repo root)           # parseability — true but irrelevant
v2/                         # downstream codegen — null
v3/                         # planner+executor wire format — null
v3.5/                       # executor isolation, cross-model — null
v4/                         # cross-domain comprehension — null at one-screen scale
v5/                         # depth stress test — preliminary positive (verbose builder)
v5b/                        # depth stress test, tight builder — looked like a clean win
v5c/                        # depth stress test, FAIR (all formats tight) — wins dissolved
v7/                         # agent builds artifact in sandbox (Inspect AI + Gemini judge)

reports/                    # date-stamped markdown summaries (committed)
artifacts/                  # gitignored — promptfoo HTML reports, etc.
```

---

## License

MIT — see [LICENSE](LICENSE).
