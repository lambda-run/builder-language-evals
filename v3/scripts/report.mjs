// Aggregate v3/results/scores.json into a markdown report.
//
// Reports per-condition averages for coverage, parallelism, tokens, plus
// a per-task breakdown. Verdict at the end.
//
// Usage: bun run v3/scripts/report.mjs

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const RESULTS = join(ROOT, "results");
const REPORTS = join(ROOT, "..", "reports");

const scores = JSON.parse(readFileSync(join(RESULTS, "scores.json"), "utf8"));

const taskFiles = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
const tasks = taskFiles.map((f) => parseYaml(readFileSync(join(TASKS, f), "utf8")));

const conditions = ["builder", "json", "markdown"];

function agg(cond) {
  const rows = scores.cells.filter((c) => c.condition === cond);
  const coverage = rows.reduce((s, r) => s + r.coverage, 0) / rows.length;
  const parallel = rows.reduce((s, r) => s + r.parallel_score, 0) / rows.length;
  const tokens = rows.reduce((s, r) => s + r.total_tokens, 0);
  const planTok = rows.reduce((s, r) => s + r.planner_tokens, 0);
  const execTok = rows.reduce((s, r) => s + r.executor_tokens, 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const extra = rows.reduce((s, r) => s + r.extra_calls, 0);
  const turns = rows.reduce((s, r) => s + r.turns, 0);
  return { coverage, parallel, tokens, planTok, execTok, cost, extra, turns, n: rows.length };
}
const aggs = Object.fromEntries(conditions.map((c) => [c, agg(c)]));

const out = [];
out.push("# Builder-Language Eval — v3: Agent-to-Agent Wire Format");
out.push("");
out.push(`Run timestamp: ${scores.ran_at}`);
out.push("");
out.push("## What this measures");
out.push("");
out.push("Whether builder syntax beats JSON or Markdown as the **wire format between two agents** — the planner produces a plan, the executor reads it and runs tools.");
out.push("");
out.push("**Setup:**");
out.push("- 5 tasks. Each has a fuzzy English goal (NOT a pre-decomposed spec) + a tool catalog + a gold trace.");
out.push("- Agent A (planner, Sonnet 4.6) reads the goal + tools, outputs a plan in builder | json | markdown.");
out.push("- Agent B (executor, Sonnet 4.6) reads the plan + has access to the same tools (OpenAI function-call API). Multi-turn agent loop. Tools return canned responses.");
out.push("- Trace records: which tools were called, in what order, and crucially **how many tool_calls were emitted in a single response** (= parallel emission).");
out.push("- Scored: tool coverage vs gold, parallelism captured (gold parallel groups emitted as a single response), end-to-end tokens.");
out.push("");

out.push("## Headline");
out.push("");
out.push("| Condition | Coverage | Parallelism captured | Total tokens | Extra calls | Total cost |");
out.push("|---|---:|---:|---:|---:|---:|");
for (const c of conditions) {
  const a = aggs[c];
  out.push(`| ${c} | ${(a.coverage * 100).toFixed(0)}% | ${(a.parallel * 100).toFixed(0)}% | ${a.tokens} | ${a.extra} | $${a.cost.toFixed(4)} |`);
}
out.push("");
out.push(`Total v3 cost: **$${(aggs.builder.cost + aggs.json.cost + aggs.markdown.cost).toFixed(4)}**`);
out.push("");

// per-task table
out.push("## Per-task: tool coverage");
out.push("");
out.push("| Task | builder | json | markdown |");
out.push("|---|---:|---:|---:|");
for (const t of tasks) {
  const cells = Object.fromEntries(conditions.map((c) => {
    const r = scores.cells.find((x) => x.task_id === t.id && x.condition === c);
    return [c, r ? `${r.covered_tools.length}/${r.covered_tools.length + r.missing_tools.length}` : "—"];
  }));
  out.push(`| \`${t.id}\` | ${cells.builder} | ${cells.json} | ${cells.markdown} |`);
}
out.push("");

out.push("## Per-task: parallelism captured");
out.push("");
out.push("Gold parallel groups (size ≥ 2) emitted as a SINGLE response (multiple `tool_calls` in one assistant message).");
out.push("");
out.push("| Task | builder | json | markdown |");
out.push("|---|---:|---:|---:|");
for (const t of tasks) {
  const cells = Object.fromEntries(conditions.map((c) => {
    const r = scores.cells.find((x) => x.task_id === t.id && x.condition === c);
    return [c, r ? `${r.parallel_matched}/${r.parallel_total}` : "—"];
  }));
  out.push(`| \`${t.id}\` | ${cells.builder} | ${cells.json} | ${cells.markdown} |`);
}
out.push("");

out.push("## Per-task: total tokens (planner + executor)");
out.push("");
out.push("| Task | builder | json | markdown |");
out.push("|---|---:|---:|---:|");
for (const t of tasks) {
  const cells = Object.fromEntries(conditions.map((c) => {
    const r = scores.cells.find((x) => x.task_id === t.id && x.condition === c);
    return [c, r ? r.total_tokens : "—"];
  }));
  out.push(`| \`${t.id}\` | ${cells.builder} | ${cells.json} | ${cells.markdown} |`);
}
out.push("");

// verdict
out.push("## Verdict");
out.push("");
const winnerCov = conditions.reduce((a, b) => aggs[a].coverage >= aggs[b].coverage ? a : b);
const winnerPar = conditions.reduce((a, b) => aggs[a].parallel >= aggs[b].parallel ? a : b);
const winnerTok = conditions.reduce((a, b) => aggs[a].tokens <= aggs[b].tokens ? a : b);
out.push(`- **Coverage winner:** ${winnerCov} (${(aggs[winnerCov].coverage * 100).toFixed(0)}%)`);
out.push(`- **Parallelism winner:** ${winnerPar} (${(aggs[winnerPar].parallel * 100).toFixed(0)}%)`);
out.push(`- **Tokens winner (lower better):** ${winnerTok} (${aggs[winnerTok].tokens} tokens)`);
out.push("");
out.push("**Decision criterion (set before run):** if builder doesn't beat the others on coverage OR parallelism, the skill is dead.");
out.push("");
out.push(`**Result after gold fix:** all three formats tie at 100% coverage and 100% parallelism. The ONLY differentiator is tokens — markdown wins (${aggs.markdown.tokens} < builder's ${aggs.builder.tokens} < json's ${aggs.json.tokens}). Builder neither wins nor loses on the executor's behaviour; for this set of tasks at this complexity, format does not move execution accuracy. Markdown's training-data familiarity gives it a small (~6%) token edge.`);
out.push("");
out.push("### Methodology correction (2026-05-04)");
out.push("");
out.push("Initial run scored builder at 80% parallelism — single miss on `t04_deploy`. The builder planner produced a plan that *added* a real-world dependency: `build` must finish before `run_tests` and `security_scan` can run. The original gold (all 3 parallel) penalised that correct inference.");
out.push("");
out.push("Per Gemini review: \"If Builder is penalized for being right about real-world constraints, your gold standard is wrong, not the notation.\" The gold for t04 was corrected to honour the build dependency. Re-scoring brings all conditions to parity on parallelism — meaning the original 'markdown wins parallelism' claim was an artefact of bad gold, not a real format effect.");
out.push("");

out.push("## Tasks tested");
out.push("");
out.push("| ID | Goal |");
out.push("|---|---|");
for (const t of tasks) {
  out.push(`| \`${t.id}\` | ${t.fuzzy_goal.split("\n")[0]} |`);
}
out.push("");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").split("Z")[0];
const outFile = join(REPORTS, `eval-v3-wire-format-${stamp}.md`);
writeFileSync(outFile, out.join("\n") + "\n");
console.log(`Wrote ${outFile}`);
console.log("\n=== HEADLINE ===");
for (const c of conditions) {
  const a = aggs[c];
  console.log(`${c}: cov=${(a.coverage * 100).toFixed(0)}% par=${(a.parallel * 100).toFixed(0)}% tok=${a.tokens} extra=${a.extra} $${a.cost.toFixed(4)}`);
}
