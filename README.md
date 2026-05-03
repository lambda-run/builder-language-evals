# builder-language-evals

Evaluation suite for the [`builder-language`](skill/SKILL.md) Claude Code skill.

Built with [`promptfoo`](https://promptfoo.dev), using OpenRouter for SUT calls and Google Gemini (with structured output) as the independent judge.

## What this measures

**Form-adherence.** When the `builder-language` skill is loaded into a model's context, does the model produce output in the form the skill describes? Does it correctly skip the form when the skill says it shouldn't fire?

Three system-prompt conditions, compared per cell:

| Condition | System prompt | Tests |
|---|---|---|
| `with-skill` | Full SKILL.md (~90 lines) | Does the skill ship as designed? |
| `with-naive` | One sentence: "respond using a fluent builder-chain syntax" | Is the skill better than naive prompting? *(Dex's question.)* |
| `without-skill` | None | Baseline. |

Across 25 prompts × 4 models × 3 conditions:

- **`has-chain`** — does the output contain a builder chain? (deterministic regex)
- **`no-arrows`** — no `->` lambda arrows. (deterministic)
- **`named-subnouns`** — sub-chains use named SubNouns, not leading dots. (deterministic)
- **`vocab-discipline`** — ratio of standard-vocab verbs to total verbs. (measurement)
- **`adoption`** — LLM-judged: is the form right for the prompt? (Gemini, structured output)
- **`completeness`** — LLM-judged: does the chain capture the prompt's major aspects? (Gemini)

## What this does NOT measure

This is the honest part.

The `builder-language` skill is fundamentally a **human communication technique** — a grammar to make compositional structure legible to a technical reader. The interesting question is whether that grammar makes humans understand structure better, faster, or more completely than prose.

That is a **user study**, not an LLM benchmark. We do not measure:

- **Reading-time comprehension** — is the chain form faster to extract facts from than prose?
- **Gap detection** — does the chain form make missing pieces more visible during review?
- **Cross-LLM comprehension** — when one Claude reads what another Claude wrote in chain form, does it grok it better than prose?

Those would each need a controlled human study. This eval only measures that the skill, when loaded, reliably produces the form it describes — not that the form is *good*.

## Models tested

| Role | Model | Why |
|---|---|---|
| SUT | `anthropic/claude-opus-4.7` | Anthropic flagship |
| SUT | `anthropic/claude-sonnet-4.6` | Anthropic mid — what most Claude Code users run |
| SUT | `anthropic/claude-haiku-4.5` | Anthropic small — cheap regression line |
| SUT | `openai/gpt-5.5` | Cross-family — does the language travel? |
| Judge | `google/gemini-3.1-pro-preview` | Independent (non-Anthropic). Structured output via `responseSchema` — no regex parsing. |

## Reproduce

Requires [Bun](https://bun.sh) and an [OpenRouter](https://openrouter.ai) API key.

```bash
git clone https://github.com/lambda-run/builder-language-evals
cd builder-language-evals
bun install

export OPENROUTER_API_KEY=sk-or-v1-...
export GEMINI_API_KEY=...

bun run dry         # 1 prompt × Haiku × 3 conditions, ~$0.05
bun run eval        # full sweep — 12 providers × 25 prompts
bun run view        # open HTML report
```

## Layout

This follows the structure of Gerred Dillon's promptfoo setup in [tempo content-intelligence](https://github.com/your-org/tempo) — same shape, adapted to the skill-eval domain.

```
skill/SKILL.md           # the skill being evaluated (snapshotted from ~/.claude/skills/)

promptfoo/
  main.yaml              # full eval config (12 providers × all datasets)
  dry.yaml               # 1-prompt smoke check, ~$0.05

datasets/
  should-use.yaml        # 10 prompts that should trigger the skill
  should-skip.yaml       # 10 prompts that should NOT trigger
  adversarial.yaml       # 5 prompts that tempt specific failure modes

assertions/
  has-chain.cjs          # detect chain shape (uses test metadata.expect_chain)
  no-arrows.cjs          # ban `->` lambda syntax
  named-subnouns.cjs     # ban leading-dot sub-chains
  vocab-discipline.cjs   # measurement: standard verb ratio

prompts/
  with-skill-system.txt  # system-prompt template, {{SKILL_BODY}} substituted
  naive-prompt.txt       # one-line "respond in builder syntax" baseline
  adoption-rubric.txt    # LLM judge: is the form right?
  completeness-rubric.txt# LLM judge: does the chain cover the request?
  why-comments-rubric.txt# LLM judge: are comments WHY not WHAT?

providers/
  openrouter.cjs         # custom JS provider, captures OR's native cost field
  gemini-judge.cjs       # judge with responseSchema for guaranteed-valid JSON

scripts/
  run-promptfoo.sh       # entry: loads .env, runs `promptfoo eval -c <config>`

artifacts/               # gitignored — promptfoo HTML reports, results.json
reports/                 # date-stamped markdown summaries
```

## Background

This eval exists because [Dexter Horthy](https://twitter.com/dexhorthy) (HumanLayer / 12 Factor Agents) replied to a description of the `builder-language` skill with three words: **"Show me the evals."**

He then sharpened the question: *"is this better than naive prompting?"* — which is why we test three system-prompt conditions, not two.

He also asked: *"is your intent to compile this to an AST and execute it, or is it just syntax that goes into the token hole?"* The honest answer right now is: it is text the model emits and the human reads. The skill is a human communication grammar, not a DSL. We'd build the parser only after a user study proves the form actually helps humans.

## License

MIT — see [LICENSE](LICENSE).
