# v3.5 Cross-Model Comparison: Sonnet 4.6 vs GPT-5.5

Run: 2026-05-04T12:13:46.215Z

Same 5 tasks, same 5 "perfect" plans (deterministically generated from gold traces). Only the executor model changes.

## sonnet-4.6

| Format | Coverage | Parallelism | Tokens | Extra | Turns | Cost |
|---|---:|---:|---:|---:|---:|---:|
| builder | 100% | 100% | 27495 | 0 | 17 | $0.1177 |
| markdown_checklist | 100% | 100% | 29904 | 0 | 18 | $0.1255 |
| markdown_explicit | 100% | 100% | 28984 | 0 | 18 | $0.1215 |
| json | 100% | 100% | 32278 | 0 | 18 | $0.1324 |
| terse | 100% | 100% | 28902 | 0 | 18 | $0.1217 |

## gpt-5.5

| Format | Coverage | Parallelism | Tokens | Extra | Turns | Cost |
|---|---:|---:|---:|---:|---:|---:|
| builder | 100% | 100% | 10689 | 0 | 18 | $0.0788 |
| markdown_checklist | 100% | 100% | 10963 | 0 | 18 | $0.0739 |
| markdown_explicit | 100% | 100% | 10446 | 0 | 18 | $0.0742 |
| json | 100% | 100% | 12840 | 0 | 18 | $0.0863 |
| terse | 100% | 100% | 10100 | 0 | 18 | $0.0692 |

## Side-by-side: tokens per format

| Format | Sonnet 4.6 | GPT-5.5 | Δ |
|---|---:|---:|---:|
| builder | 27495 | 10689 | -61.1% |
| markdown_checklist | 29904 | 10963 | -63.3% |
| markdown_explicit | 28984 | 10446 | -64.0% |
| json | 32278 | 12840 | -60.2% |
| terse | 28902 | 10100 | -65.1% |

## Side-by-side: parallelism per format

| Format | Sonnet 4.6 | GPT-5.5 |
|---|---:|---:|
| builder | 100% | 100% |
| markdown_checklist | 100% | 100% |
| markdown_explicit | 100% | 100% |
| json | 100% | 100% |
| terse | 100% | 100% |

## Per-task: turns by model

Lower = more parallelism = more efficient.

| Task × Format | Sonnet turns | GPT-5.5 turns |
|---|---:|---:|
| `t01_pr_review` / builder | 3 | 3 |
| `t01_pr_review` / markdown_checklist | 3 | 3 |
| `t01_pr_review` / markdown_explicit | 3 | 3 |
| `t01_pr_review` / json | 3 | 3 |
| `t01_pr_review` / terse | 3 | 3 |
| `t02_customer_triage` / builder | 3 | 3 |
| `t02_customer_triage` / markdown_checklist | 3 | 3 |
| `t02_customer_triage` / markdown_explicit | 3 | 3 |
| `t02_customer_triage` / json | 3 | 3 |
| `t02_customer_triage` / terse | 3 | 3 |
| `t03_image_pipeline` / builder | 3 | 3 |
| `t03_image_pipeline` / markdown_checklist | 3 | 3 |
| `t03_image_pipeline` / markdown_explicit | 3 | 3 |
| `t03_image_pipeline` / json | 3 | 3 |
| `t03_image_pipeline` / terse | 3 | 3 |
| `t04_deploy` / builder | 5 | 5 |
| `t04_deploy` / markdown_checklist | 5 | 5 |
| `t04_deploy` / markdown_explicit | 5 | 5 |
| `t04_deploy` / json | 5 | 5 |
| `t04_deploy` / terse | 5 | 5 |
| `t05_order` / builder | 3 | 4  ← |
| `t05_order` / markdown_checklist | 4 | 4 |
| `t05_order` / markdown_explicit | 4 | 4 |
| `t05_order` / json | 4 | 4 |
| `t05_order` / terse | 4 | 4 |

## Verdict

- Total tokens — Sonnet: 147563, GPT-5.5: 55038 (Δ -62.7%)
- Total cost — Sonnet: $0.6188, GPT-5.5: $0.3824

