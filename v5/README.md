# v5 — Depth Stress Test

The hypothesis v5 tests, for the first time:

> Builder's compositional advantage shows up at **depth** — when a spec has 30+ concrete elements, 4+ levels of nesting, and cross-references — even if it ties markdown/prose at one-screen scale (the v4 result).

## What v5 measures

One deeply nested task: a distributed Ralph loop spec with ~35 concrete elements organized into 7 sub-Nouns, 4 levels deep. Three formats — `builder`, `markdown`, `prose` — all hand-written from the same mental model, no reverse-translation.

Two metrics, same as v4:

- **Compression** — chars to declare the same content.
- **Comprehension** — when a model reads the declaration and is asked to produce a manifest of every concrete element implied, what % of gold elements appear in the manifest?

Comprehension run on Sonnet 4.6 + GPT-5.5.

## Headline result

| Format | Compression (chars) | Sonnet 4.6 | GPT-5.5 |
|---|---:|---:|---:|
| **builder** | **1,291** (-10% vs md) | **91.7%** (33/36) | **100.0%** (36/36) |
| markdown | 1,440 | 88.9% (32/36) | 88.9% (32/36) |
| prose | 1,330 | 88.9% (32/36) | 94.4% (34/36) |

For the first time across five evals, builder shows a clear non-noise advantage on both axes simultaneously.

## Methodology note — scorer was patched mid-eval

Important transparency: the first scorer pass produced an apparent **negative** result for builder (lost comprehension by 5–11pp). On inspection this was a substring-match bug:

- Gold elements include multi-word phrases like `"kill switch"`, `"reviewer pool"`, `"error rate"`.
- Builder inherits identifiers from the source: `kill_switch`, `reviewer_pool`, `error_rate`.
- The model faithfully reproduced builder's vocabulary in its manifest.
- Substring match on `"kill switch"` failed against `"kill_switch"`.

The scorer was patched to normalize `_` and `-` to spaces before substring matching, and to accept `0.X` as equivalent to `X` for percent values. Both changes are symmetric across formats.

**Sanity check: re-scored v4 with the same normalized scorer.** v4 result is unchanged: still null within ~2pp on both models. So the normalization isn't biased toward builder; it's a real bug whose impact is proportional to how many multi-word technical terms the gold list has, and v5's gold has many.

## Caveats

- **N=1 task.** Could be domain-specific (distributed agent orchestration may simply suit chain syntax better than other domains).
- **Hand-written by skill author.** Selection effect on what the gold elements are and how the spec was framed.
- **Scorer patch was post-hoc.** The fix is principled (and validated against v4 as unchanged), but a stricter design would have specified normalization before any data was collected.

To convert this from "preliminary signal" to "validated finding," v5 would need 2-3 more deep tasks in different domains (e.g., a deep RBAC policy, a multi-stage data pipeline with conditional branches, an eligibility rule engine). That's the natural follow-up if the depth claim matters.

## What v5 doesn't change

The skill is still kept for the same reason as before — personal notation aid, aesthetic preference. v5 adds one preliminary data point that the aesthetic preference may also be a measurable productivity advantage when specs get deep enough. It does not, on its own, change the recommendation.
