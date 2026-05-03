---
name: builder-language
description: A grammar for explaining compositional structure to TECHNICAL readers as a fluent chain — `Noun.verb(...).verb(...)` with inline why-comments and invented domain verbs. Use only when the topic is technical/operational, the reader will parse code-shaped syntax without friction, and there are 3+ aspects that combine into a whole. Common uses — spec'ing a design, auditing gaps, comparing options, translating a vague ask into named fields. Mix with prose. Cap chains at ~8 verbs. Skip for non-technical readers, code edits, status updates, yes/no questions, or narrative.
---

# Builder-Language

A grammar for explaining compositional structure as a fluent chain. Verbs are invented per domain.

## Grammar

```
<Noun>
  .<verb>(<args>)              // why this exists, not what it is
  .<verb>(<SubNoun>             // sub-chain captures what's being built
      .<verb>(<args>)
      .<verb>(<args>))
  [.<terminator>()]            // optional: .run() / .send() / .build() / nothing
```

**Two strict syntactic conventions:**

- **No `->` arrows or lambda syntax.** LLMs see `->` and drift into writing executable logic instead of structural specs.
- **Sub-chains use a named `<SubNoun>` (capital letter), not a leading dot.** `(Rule .x().y())` reads as a Noun being configured. `(.x().y())` looks like invalid code and LLMs will silently "correct" it. The named sub-Noun also recovers the *capture* that lambdas used to provide.

## Standard vocabulary

Prefer these over inventing synonyms — invent only when the standard set genuinely doesn't fit the domain.

**Verbs (16):**

| Category | Verbs |
|---|---|
| Control flow | `sequence`, `parallelize`, `route`, `wait_for`, `fallback` |
| Data flow | `transform`, `filter`, `store`, `fetch` |
| Coordination | `subagent(name, task, context)`, `human_in_loop(reviewer)` |
| LLM-typical | `summarize`, `review`, `notify` |
| Lifecycle | `schedule`, `run` |

**Literals (4 enum families):**

| Family | Values |
|---|---|
| `cadence` | `immediate` · `hourly` · `daily` · `weekly` · `on_change` |
| `channel` | `sms` · `email` · `slack` · `push` · `inbox` |
| `severity` | `info` · `warn` · `error` · `critical` |
| `format` | `json` · `text` · `markdown` |

**No composers.** Modifiers fold into named args: `.run(timeout: 30, retry: 3, guard: check)` — not `withTimeout(30, withRetry(3, run()))`.

## Rules

1. **Cap at ~8 verbs per chain.** Past that, decompose.
2. **Sub-chains only at 3+ sub-fields.** Below, flatten.
3. **Comments explain WHY, not WHAT.** `permissions // what I'm allowed to do` ✓. `permissions // a list of permissions` ✗.
4. **Pick one argument form** (default named: `field: value`) and stay there across the response.
5. **Verbs must be orthogonal.** Don't ship `.target_audience()` *and* `.add_demographic()` — pick one.
6. **Name empty cells only when the topic is gap-finding.** Otherwise it's noise.

## When to fire — all four required

1. Topic is technical / operational (specs, configs, plans, audits).
2. Reader is technical (will parse `.verb(args)` without friction).
3. 3+ distinct aspects that combine into a whole.
4. Side-by-side viewing genuinely helps.

Any no → use prose. Mix freely: chain for the structured part, prose for context, motivation, and what could go wrong.

## Examples

Translating a vague ask — generic verbs, no terminator:

```
InboxWatcher
  .source(account: "...", filters: [...])
  .importance(
      .from_list(senders)        // VIP senders
      .keyword_match(patterns)   // urgent words
      .reply_window(hours))      // hasn't been replied to
  .ping(channel: "sms", cadence: "immediate")
```

Spec'ing a plan — invented domain verbs, `.run()` terminator:

```
ResearchTask
  .frame(question: "...", decision_by: "...")
  .parallelize(
      subagent(name: "market", task: t1, context: c1),
      subagent(name: "legal",  task: t2, context: c2))
  .transform(into: "synthesis_doc", format: "markdown")  // standard verb + literal
  .human_in_loop(reviewer: "Lyndon")
  .run()
```
