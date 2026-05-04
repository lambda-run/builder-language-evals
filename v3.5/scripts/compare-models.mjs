// Compare v3.5 results across executor models: Sonnet 4.6 vs GPT-5.5.
// Same 5 tasks, same 5 formats, same plans.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "..", "v3", "tasks");
const REPORTS = join(ROOT, "..", "reports");

const MODELS = {
  "sonnet-4.6": join(ROOT, "results"),
  "gpt-5.5":    join(ROOT, "results-gpt55"),
};
const FORMATS = ["builder", "markdown_checklist", "markdown_explicit", "json", "terse"];

function scoreCell(task, trace) {
  const goldGroups = task.gold_trace;
  const goldToolSet = new Set(goldGroups.flatMap((g) => g.calls.map((c) => c.tool)));
  const turnNames = trace.map((t) => (t.tool_calls ?? []).map((c) => c.name));
  const calledNames = new Set(turnNames.flat());
  const covered = [...goldToolSet].filter((t) => calledNames.has(t));
  const coverage = goldToolSet.size === 0 ? 1 : covered.length / goldToolSet.size;
  const extra = [...calledNames].filter((t) => !goldToolSet.has(t)).length;
  const parGroups = goldGroups.filter((g) => g.parallel && g.calls.length >= 2);
  let parMatched = 0;
  for (const g of parGroups) {
    const groupSet = new Set(g.calls.map((c) => c.tool));
    if (turnNames.some((names) => [...groupSet].every((n) => new Set(names).has(n)))) parMatched++;
  }
  const parScore = parGroups.length === 0 ? 1 : parMatched / parGroups.length;
  return { coverage, parScore, parMatched, parTotal: parGroups.length, extra };
}

const taskFiles = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
const cells = []; // { model, task, format, ... }
for (const f of taskFiles) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  for (const [model, dir] of Object.entries(MODELS)) {
    for (const fmt of FORMATS) {
      const file = join(dir, `${task.id}__${fmt}.json`);
      if (!existsSync(file)) continue;
      const obj = JSON.parse(readFileSync(file, "utf8"));
      const s = scoreCell(task, obj.trace);
      cells.push({
        model, task: task.id, format: fmt, ...s,
        tokens: (obj.prompt_tokens ?? 0) + (obj.completion_tokens ?? 0),
        cost: obj.cost ?? 0, turns: obj.turns ?? obj.trace.length,
      });
    }
  }
}

function agg(model, fmt) {
  const rows = cells.filter((c) => c.model === model && c.format === fmt);
  if (rows.length === 0) return null;
  return {
    n: rows.length,
    coverage: rows.reduce((s, r) => s + r.coverage, 0) / rows.length,
    parallel: rows.reduce((s, r) => s + r.parScore, 0) / rows.length,
    tokens: rows.reduce((s, r) => s + r.tokens, 0),
    cost: rows.reduce((s, r) => s + r.cost, 0),
    extra: rows.reduce((s, r) => s + r.extra, 0),
    turns: rows.reduce((s, r) => s + r.turns, 0),
  };
}

const out = [];
out.push("# v3.5 Cross-Model Comparison: Sonnet 4.6 vs GPT-5.5");
out.push("");
out.push(`Run: ${new Date().toISOString()}`);
out.push("");
out.push("Same 5 tasks, same 5 \"perfect\" plans (deterministically generated from gold traces). Only the executor model changes.");
out.push("");

for (const model of Object.keys(MODELS)) {
  out.push(`## ${model}`);
  out.push("");
  out.push("| Format | Coverage | Parallelism | Tokens | Extra | Turns | Cost |");
  out.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const fmt of FORMATS) {
    const a = agg(model, fmt);
    if (!a) continue;
    out.push(`| ${fmt} | ${(a.coverage * 100).toFixed(0)}% | ${(a.parallel * 100).toFixed(0)}% | ${a.tokens} | ${a.extra} | ${a.turns} | $${a.cost.toFixed(4)} |`);
  }
  out.push("");
}

out.push("## Side-by-side: tokens per format");
out.push("");
out.push("| Format | Sonnet 4.6 | GPT-5.5 | Δ |");
out.push("|---|---:|---:|---:|");
for (const fmt of FORMATS) {
  const s = agg("sonnet-4.6", fmt), g = agg("gpt-5.5", fmt);
  if (!s || !g) continue;
  const delta = ((g.tokens - s.tokens) / s.tokens * 100).toFixed(1);
  out.push(`| ${fmt} | ${s.tokens} | ${g.tokens} | ${delta}% |`);
}
out.push("");

out.push("## Side-by-side: parallelism per format");
out.push("");
out.push("| Format | Sonnet 4.6 | GPT-5.5 |");
out.push("|---|---:|---:|");
for (const fmt of FORMATS) {
  const s = agg("sonnet-4.6", fmt), g = agg("gpt-5.5", fmt);
  if (!s || !g) continue;
  out.push(`| ${fmt} | ${(s.parallel * 100).toFixed(0)}% | ${(g.parallel * 100).toFixed(0)}% |`);
}
out.push("");

out.push("## Per-task: turns by model");
out.push("");
out.push("Lower = more parallelism = more efficient.");
out.push("");
out.push("| Task × Format | Sonnet turns | GPT-5.5 turns |");
out.push("|---|---:|---:|");
for (const f of taskFiles.map((f) => parseYaml(readFileSync(join(TASKS, f), "utf8")))) {
  for (const fmt of FORMATS) {
    const s = cells.find((c) => c.model === "sonnet-4.6" && c.task === f.id && c.format === fmt);
    const g = cells.find((c) => c.model === "gpt-5.5" && c.task === f.id && c.format === fmt);
    if (!s || !g) continue;
    const flag = s.turns !== g.turns ? "  ←" : "";
    out.push(`| \`${f.id}\` / ${fmt} | ${s.turns} | ${g.turns}${flag} |`);
  }
}
out.push("");

out.push("## Verdict");
out.push("");
const totals = {};
for (const m of Object.keys(MODELS)) totals[m] = { tokens: 0, cost: 0 };
for (const c of cells) {
  totals[c.model].tokens += c.tokens;
  totals[c.model].cost += c.cost;
}
out.push(`- Total tokens — Sonnet: ${totals["sonnet-4.6"].tokens}, GPT-5.5: ${totals["gpt-5.5"].tokens} (Δ ${((totals["gpt-5.5"].tokens - totals["sonnet-4.6"].tokens) / totals["sonnet-4.6"].tokens * 100).toFixed(1)}%)`);
out.push(`- Total cost — Sonnet: $${totals["sonnet-4.6"].cost.toFixed(4)}, GPT-5.5: $${totals["gpt-5.5"].cost.toFixed(4)}`);
out.push("");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").split("Z")[0];
const outFile = join(REPORTS, `eval-v3.5-cross-model-${stamp}.md`);
writeFileSync(outFile, out.join("\n") + "\n");
console.log(`Wrote ${outFile}`);
