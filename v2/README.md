# v2 — downstream execution eval

Tests whether feeding a builder-language spec to an executing agent produces strictly better work than feeding the same task as English.

## Design (per Gemini's flipped recommendation)

1. **Hand-write 5–10 tasks** as gold-standard builder specs (NOT LLM-synthesized — synthetic tasks regress to the mean and become circular).
2. **Reverse-translate** each builder spec into two English versions using a strong model:
   - `english_plain` — naturalistic prose
   - `english_markdown` — structured markdown with headers and bullets
   This guarantees the builder version is never the one missing context.
3. **Execute** each version through Sonnet 4.6 (Haiku is too dumb — both will fail and we get a useless 0%/0% tie).
4. **Score deterministically** by running the agent's output Python function against hidden test cases. Pass-rate per condition.

## Three conditions per task

| Condition | What the executor sees | Tests |
|---|---|---|
| `builder` | Hand-written gold builder spec | The skill's format actually helps execution |
| `english_markdown` | Translated to structured markdown | Builder beats *structured* prose, not just prose |
| `english_plain` | Translated to plain English | Builder beats sloppy prose |

Three-way comparison defeats the strawman of comparing builder-language to *unstructured* prose.

## Anti-failure-mode design (from Gemini's adversarial review)

| Failure mode | Mitigation |
|---|---|
| Translation degradation | Builder is gold-standard; English is the derivative. English can never have *more* info than builder. |
| Token illusion | Score by execution success only; report tokens as a secondary stat, not headline. |
| Format overfitting | Executor prompt explicitly says: "Do NOT execute the specification text as literal code." |
| "English is fine" null result | Tasks designed with nested conditional logic and dependency trees where prose naturally becomes ambiguous. |

## Layout

```
v2/
  tasks/             # gold builder specs + hidden tests
    t01_*.yaml
  translations/      # cached builder→english translations (so we don't re-translate on each run)
  scripts/
    translate.mjs    # build→english plain + markdown via Gemini
    execute.mjs      # run all 3 conditions through Sonnet 4.6 via OpenRouter
    score.mjs        # run agent output against hidden tests, score per task
    report.mjs       # aggregate to v2 markdown report
  results/           # per-run JSON + final report
```
