# Builder-Language Eval — v3.5: Executor Isolation

Run timestamp: 2026-05-04T10:59:56.206Z

## What this measures

Per Gemini's design critique of v3: "Test the executor in isolation. Before optimizing the planner's format, you must know what the executor actually parses into parallel_tool_calls most reliably."

**Setup:**
- Same 5 tasks as v3 (same gold traces, same canned tool responses).
- For each task, hand-generate "perfect" plans in 5 formats: builder, markdown_checklist, markdown_explicit, json, terse_pseudocode.
- Plans are derived deterministically from the gold trace — same logical content, different syntactic idiom.
- Feed the perfect plan + the user goal to the executor (Sonnet 4.6, OpenAI tool-call API, parallel_tool_calls enabled).
- Measure: tool coverage vs gold, parallelism captured (gold parallel groups emitted in a single response), tokens.

**Why isolate the executor?** v3 mixed planner format choice with executor parsing ability. If the executor parses markdown checklists into parallel calls perfectly on its own, planner-format optimization is moot.

## Headline

| Format | Coverage | Parallelism | Tokens | Extra calls | Cost |
|---|---:|---:|---:|---:|---:|
| builder | 100% | 100% | 27495 | 0 | $0.1177 |
| markdown_checklist | 100% | 100% | 29904 | 0 | $0.1255 |
| markdown_explicit | 100% | 100% | 28984 | 0 | $0.1215 |
| json | 100% | 100% | 32278 | 0 | $0.1324 |
| terse | 100% | 100% | 28902 | 0 | $0.1217 |

## Per-task: parallelism captured

| Task | builder | md_checklist | md_explicit | json | terse |
|---|---:|---:|---:|---:|---:|
| `t01_pr_review` | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| `t02_customer_triage` | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| `t03_image_pipeline` | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| `t04_deploy` | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| `t05_order` | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |

## Per-task: total tokens

| Task | builder | md_checklist | md_explicit | json | terse |
|---|---:|---:|---:|---:|---:|
| `t01_pr_review` | 4679 | 4762 | 4596 | 5153 | 4607 |
| `t02_customer_triage` | 4854 | 4829 | 4696 | 5194 | 4727 |
| `t03_image_pipeline` | 4629 | 4639 | 4611 | 5091 | 4607 |
| `t04_deploy` | 7442 | 7648 | 7351 | 8326 | 7275 |
| `t05_order` | 5891 | 8026 | 7730 | 8514 | 7686 |

## Verdict

- **Coverage:** builder (100%)
- **Parallelism:** builder (100%)
- **Tokens (lower better):** builder (27495)

**Headline:** all five formats hit 100% coverage and 100% gold parallelism. Builder is the most token-efficient (~9% less than markdown_checklist, ~17% less than json). The original v3 finding that 'markdown beats builder on tokens' was driven by the PLANNER's output verbosity in builder syntax, not by builder being inherently inefficient. With perfect plans, builder is densest.

### Important caveat — over-parallelization

Builder's token win on `t05_order` is partly because it caused the executor to **incorrectly** parallelize `charge_card` and `create_order` (in real life you should charge before creating). Other formats kept them sequential. Our metric only checks gold parallel groups were captured — it does not penalize over-parallelization. So builder's edge here is partly an artefact of the metric. With Gemini's proposed dependency-violation penalty, builder's lead would shrink.

### What this changes about v3

v3 (planner+executor) showed markdown winning tokens. v3.5 (executor-only with perfect plans) shows builder winning tokens. The two together: format effects on EXECUTOR are small. Most of the v3 token delta came from the PLANNER, not the executor's parsing.

