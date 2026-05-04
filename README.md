# builder-language-evals

A 95-line Claude Code skill that turns AI-generated plans from prose into a structured `Noun.verb(args).verb(SubNoun.verb(args))` chain. This repo is the eval suite that asked: does it actually help?

## Verdict

**Tied with tight markdown on every outcome we measured.** One small directional finding stands: builder leads on spec-faithfulness when an agent reads the spec and produces an artifact (v7-fair: 9.5/10 vs 9.0/10 for markdown and prose). That's a TypeScript-prevents-drift kind of edge, lightly supported (N=1 task), not a token or correctness win.

**Use it if:** you want a discipline that forces you to compose nouns + verbs + explicit values when writing specs. The benefit is mostly in the *author's* thinking, not the LLM's output.

**Don't use it for:** token efficiency (tied with tight markdown), better code generation (tied), or better wire-format between agents (tied).

## What the skill does

It turns this:

> *"I need to answer a research question by a given deadline. Run two subagents in parallel — one for market, one for legal — each with its own task and context. Combine into a markdown synthesis doc, have Lyndon review it, then kick it off."*

…into this:

```ts
ResearchTask
  .frame(question: "...", decision_by: "...")
  .parallelize(market_agent, legal_agent)
  .transform(into: "synthesis_doc", format: "markdown")
  .approve(lyndon)
```

`market_agent`, `legal_agent`, `lyndon` are bindings defined elsewhere. Same plan, structurally explicit.

## Reproduce

```bash
git clone https://github.com/lambda-run/builder-language-evals
cd builder-language-evals && bun install
export OPENROUTER_API_KEY=... GEMINI_API_KEY=...

# Each evN/ has its own scripts. Quick smoke (compression, no API):
bun v5c/scripts/compression.mjs
```

Total spend across all seven evals: **<$15**.

---

<details>
<summary><b>Methodology trail (for the curious)</b></summary>

### How this got here

Started after [Dexter Horthy](https://twitter.com/dexhorthy) replied to a description of the skill with **"show me the evals"** and sharpened it to *"is this better than naive prompting?"*

Seven evals, two adversarial Gemini reviews. Bold claims caught and walked back along the way — full table below so you can see what passed and what didn't.

### Results table

| Eval | Claim tested | Result |
|---|---|---|
| [v1](reports/eval-v1-parseability-2026-05-03T20-06-53-399.md) | Output parses as a strict AST | **True but irrelevant.** 83% vs 40% naive — no downstream tool consumes the AST. |
| [v2](reports/eval-v2-execution-2026-05-03T21-23-02-720.md) | Improves downstream code generation | **False.** All formats tied at 87% pass; builder produced ~30% longer code. |
| [v3](reports/eval-v3-wire-format-2026-05-04T10-51-44-825.md) · [v3.5](reports/eval-v3.5-executor-isolation-2026-05-04T10-59-56-246.md) | Better agent-to-agent wire format | **False.** All formats hit 100% coverage and 100% gold parallelism. |
| [v4](reports/eval-v4-cross-domain-2026-05-04T12-44-19-739.md) | More compact AND clearer across domains | **False at one-screen scale.** Within ~2pp; markdown narrowly wins compression. |
| [v5](reports/eval-v5-depth-2026-05-04T13-56-32-992.md) | Pays off at depth (30+ elements, deep nesting) | Looked positive — N=1, scorer patched mid-eval. |
| [v5b](reports/eval-v5b-tight-2026-05-04T14-15-27-315.md) | Tight builder vs (verbose) markdown wins big | Looked like -26% tokens, +5pp comprehension. **Confound** — tightened builder, left markdown verbose. |
| [**v5c**](reports/eval-v5c-fair-2026-05-04T15-02-46-395.md) | Win survives fair tight-vs-tight | **No.** Both at 238 cl100k tokens; tight markdown wins comprehension by 1 element on both models (noise). |
| [v7](v7/) | Format affects code quality when agent builds artifact | Looked like markdown produced buggy code from Sonnet. **Same confound** as v5b. |
| [**v7-fair**](v7/) | Quality difference survives fair comparison | **Mostly null + one small finding.** All cells 15/15 tests, 0 hallucinations. Builder leads on spec-faithfulness (9.5 vs 9.0/9.0). Other dimensions tied. |

### What the data actually shows

Three findings strong enough to keep:

1. **Verbose markdown is bad.** Almost all the apparent "builder wins" came from comparing against verbose markdown baselines. Tight anything beats verbose anything.
2. **Frontier models normalize format.** Sonnet 4.6 and GPT-5.5 reconstruct any reasonable spec into the same conceptual plan before reasoning. Format effects only appear in marginal places (decode efficiency, faithfulness).
3. **Builder shows a small spec-faithfulness lead** in agent → artifact tasks (v7-fair). Directional, N=1, would need 3+ tasks to firm up.

### What we did NOT measure

- **Human review time / scannability.** The only experiment that could test the human-discipline claim with data. Not run.
- **Token generation speed.** Decode throughput across formats.
- **Error recovery.** When the model hallucinates a syntax error in `Noun.verb()` vs malformed markdown — does recovery differ?
- **Weaker executor models.** Haiku-class might show real format sensitivity that Sonnet/GPT-5.5 don't.
- **Larger specs.** All eval tasks fit in immediate context.

### Models used

| Role | Model |
|---|---|
| SUT | `anthropic/claude-sonnet-4.6` (every eval), `gpt-5.5`, `claude-opus-4.7`, `claude-haiku-4.5` |
| Judge | `google/gemini-3-pro-preview` (code review + adversarial methodology) |
| v7 harness | UK AISI [Inspect AI](https://inspect.aisi.org.uk/) |

### Layout

```
skill/SKILL.md          # the skill
v1/ … v7/               # one dir per eval (results, scripts, tasks)
reports/                # date-stamped markdown summaries
```

</details>

## License

MIT — see [LICENSE](LICENSE).
