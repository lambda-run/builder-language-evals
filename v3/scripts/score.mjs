// Score every (task, condition) trace against the gold trace.
//
// Metrics per cell:
//   - coverage           : required gold tools that were actually called
//   - extra_calls        : tool calls in trace not present in gold
//   - parallel_groups    : count of gold parallel groups emitted as a single
//                          response in the trace (set inclusion check)
//   - parallel_total     : total gold parallel groups (size >= 2)
//   - tokens_total       : planner + executor tokens
//
// Output: v3/results/scores.json
//
// Usage: bun run v3/scripts/score.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const PLANS = join(ROOT, "results", "plans");
const TRACES = join(ROOT, "results", "traces");
const OUT = join(ROOT, "results", "scores.json");

function scoreCell(task, plan, trace) {
  const goldGroups = task.gold_trace; // [{parallel, calls:[{tool}]}]

  // flatten gold tool requirements (with duplicates allowed via count)
  const goldToolCounts = {};
  for (const g of goldGroups) {
    for (const c of g.calls) {
      goldToolCounts[c.tool] = (goldToolCounts[c.tool] ?? 0) + 1;
    }
  }
  const goldToolSet = new Set(Object.keys(goldToolCounts));

  // count tool calls actually emitted in trace
  const traceToolCounts = {};
  const turnToolNames = []; // [{names: [...]}] one per turn
  for (const turn of trace) {
    const names = (turn.tool_calls ?? []).map((c) => c.name);
    turnToolNames.push(names);
    for (const n of names) {
      traceToolCounts[n] = (traceToolCounts[n] ?? 0) + 1;
    }
  }

  // coverage: count gold tools that appear in trace at least once
  const covered = [...goldToolSet].filter((t) => (traceToolCounts[t] ?? 0) > 0);
  const coverage = goldToolSet.size === 0 ? 1 : covered.length / goldToolSet.size;

  // extra: trace tools not in gold
  const extraToolNames = Object.keys(traceToolCounts).filter((t) => !goldToolSet.has(t));
  const extraCalls = extraToolNames.reduce((s, t) => s + traceToolCounts[t], 0);

  // parallelism captured: for each gold group with size>=2 and parallel:true,
  // is there ANY turn whose tool-name set is a SUPERSET of the group's tool names?
  const parallelGoldGroups = goldGroups.filter((g) => g.parallel && g.calls.length >= 2);
  let parallelMatched = 0;
  const parallelDetail = [];
  for (const g of parallelGoldGroups) {
    const groupNames = g.calls.map((c) => c.tool);
    const groupSet = new Set(groupNames);
    const matchedTurn = turnToolNames.findIndex((names) => {
      const tset = new Set(names);
      return [...groupSet].every((n) => tset.has(n));
    });
    const matched = matchedTurn !== -1;
    if (matched) parallelMatched++;
    parallelDetail.push({ group: groupNames, matched, turn: matchedTurn });
  }
  const parallelScore = parallelGoldGroups.length === 0 ? 1 : parallelMatched / parallelGoldGroups.length;

  return {
    coverage,
    covered_tools: covered,
    missing_tools: [...goldToolSet].filter((t) => !covered.includes(t)),
    extra_calls: extraCalls,
    extra_tools: extraToolNames,
    parallel_matched: parallelMatched,
    parallel_total: parallelGoldGroups.length,
    parallel_score: parallelScore,
    parallel_detail: parallelDetail,
    total_calls: Object.values(traceToolCounts).reduce((s, n) => s + n, 0),
    turns: trace.length,
  };
}

const taskFiles = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
const conditions = ["builder", "json", "markdown"];
const cells = [];

for (const f of taskFiles) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  for (const cond of conditions) {
    const planFile = join(PLANS, `${task.id}__${cond}.json`);
    const traceFile = join(TRACES, `${task.id}__${cond}.json`);
    if (!existsSync(traceFile)) {
      console.log(`  ${task.id}/${cond}: missing trace, skip`);
      continue;
    }
    const planObj = existsSync(planFile) ? JSON.parse(readFileSync(planFile, "utf8")) : null;
    const traceObj = JSON.parse(readFileSync(traceFile, "utf8"));
    const scored = scoreCell(task, planObj, traceObj.trace);
    const planTokens = (planObj?.prompt_tokens ?? 0) + (planObj?.completion_tokens ?? 0);
    const execTokens = (traceObj.prompt_tokens ?? 0) + (traceObj.completion_tokens ?? 0);
    cells.push({
      task_id: task.id,
      condition: cond,
      ...scored,
      planner_tokens: planTokens,
      executor_tokens: execTokens,
      total_tokens: planTokens + execTokens,
      cost: (planObj?.cost ?? 0) + (traceObj.cost ?? 0),
    });
  }
}

writeFileSync(OUT, JSON.stringify({ ran_at: new Date().toISOString(), cells }, null, 2));
console.log(`Scored ${cells.length} cells → ${OUT}`);

// quick console summary
for (const cond of conditions) {
  const rows = cells.filter((c) => c.condition === cond);
  const cov = rows.reduce((s, r) => s + r.coverage, 0) / rows.length;
  const par = rows.reduce((s, r) => s + r.parallel_score, 0) / rows.length;
  const tok = rows.reduce((s, r) => s + r.total_tokens, 0);
  const ext = rows.reduce((s, r) => s + r.extra_calls, 0);
  console.log(`  ${cond}: coverage=${(cov * 100).toFixed(0)}%  parallel=${(par * 100).toFixed(0)}%  tokens=${tok}  extra_calls=${ext}`);
}
