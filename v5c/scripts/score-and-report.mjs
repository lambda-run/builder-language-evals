// v4 score + report.
// For each (model, task, format) cell, count how many gold_elements appear
// in the manifest text (case-insensitive substring). Report per-cell scores,
// per-format averages, and a verdict.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const RES = join(ROOT, "results");
const REPORTS = join(ROOT, "..", "reports");

const FORMATS = ["builder", "markdown", "prose"];
const MODELS = [
  { id: "anthropic/claude-sonnet-4.6", slug: "claude-sonnet-4_6", short: "sonnet" },
  { id: "openai/gpt-5.5", slug: "gpt-5_5", short: "gpt-5.5" },
];

// Normalize so snake_case, kebab-case, dotted identifiers, and "10-minute" all
// match their bare-token forms. Without this, builder is unfairly penalized for
// inheriting snake_case identifiers from the source (e.g. `kill_switch`),
// and prose is unfairly penalized for using natural language (e.g. `10-minute`
// for "10m"). Same gold list, same normalization, applied to all three formats.
function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[_\-]+/g, " ")  // snake_case / kebab-case → space
    .replace(/\s+/g, " ")
    .trim();
}

function score(manifest, gold) {
  const lower = manifest.toLowerCase();
  const norm = normalize(manifest);
  const matched = [];
  const missed = [];
  for (const g of gold) {
    const ng = normalize(g);
    const isInt = /^\d+$/.test(String(g));
    const altPct = isInt ? `0.${parseInt(g, 10) / 10}`.replace(/^0\.0\./, "0.") : null;
    const hit = norm.includes(ng) || (altPct && lower.includes(altPct));
    if (hit) matched.push(g);
    else missed.push(g);
  }
  return { matched: matched.length, total: gold.length, missed, score: gold.length === 0 ? 1 : matched.length / gold.length };
}

const taskFiles = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
const cells = [];
for (const f of taskFiles) {
  const t = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  for (const m of MODELS) {
    for (const fmt of FORMATS) {
      const file = join(RES, `${m.slug}__${t.id}__${fmt}.json`);
      if (!existsSync(file)) continue;
      const obj = JSON.parse(readFileSync(file, "utf8"));
      const sc = score(obj.manifest, t.gold_elements);
      cells.push({
        model: m.short, task: t.id, domain: t.domain, format: fmt,
        ...sc,
        cost: obj.cost,
        prompt_tokens: obj.prompt_tokens, completion_tokens: obj.completion_tokens,
      });
    }
  }
}
writeFileSync(join(RES, "scores.json"), JSON.stringify({ ran_at: new Date().toISOString(), cells }, null, 2));

function agg(model, fmt) {
  const rows = cells.filter((c) => c.model === model && c.format === fmt);
  if (rows.length === 0) return null;
  return {
    n: rows.length,
    score: rows.reduce((s, r) => s + r.score, 0) / rows.length,
    matched: rows.reduce((s, r) => s + r.matched, 0),
    total: rows.reduce((s, r) => s + r.total, 0),
    cost: rows.reduce((s, r) => s + r.cost, 0),
  };
}

const compression = JSON.parse(readFileSync(join(RES, "compression.json"), "utf8")).rows;
function compChars(task, fmt) {
  return compression.find((r) => r.task === task && r.format === fmt)?.chars ?? 0;
}

const out = [];
out.push("# Builder-Language Eval — v5: Depth Stress Test");
out.push("");
out.push(`Run timestamp: ${new Date().toISOString()}`);
out.push("");
out.push("## What this measures");
out.push("");
out.push("Tests the hypothesis that builder's compositional advantage shows up at depth — when a spec has 30+ concrete elements, 4+ levels of nesting, and cross-references — even if it ties markdown/prose at one-screen scale (v4 result).");
out.push("");
out.push("**Setup:**");
out.push("- 1 deeply nested task: distributed Ralph loop spec (~35 elements, 7 sub-Nouns, 4 levels deep).");
out.push("- 3 formats: `builder`, `markdown` (headers + bullets), `prose` (natural English).");
out.push("- Hand-written for each format from the same mental model, no reverse-translation.");
out.push("- Two metrics:");
out.push("  - **Compression** — chars to declare the same content");
out.push("  - **Comprehension** — when a model reads the declaration and is asked to produce a manifest of every concrete element implied, what % of gold elements appear in the manifest?");
out.push("- Comprehension run on Sonnet 4.6 + GPT-5.5 for cross-model robustness.");
out.push("");

out.push("## Headline");
out.push("");
out.push("### Compression (chars per declaration)");
out.push("");
out.push("| Task | Domain | builder | markdown | prose |");
out.push("|---|---|---:|---:|---:|");
for (const f of taskFiles) {
  const t = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  out.push(`| \`${t.id}\` | ${t.domain} | ${compChars(t.id, "builder")} | ${compChars(t.id, "markdown")} | ${compChars(t.id, "prose")} |`);
}
const totals = Object.fromEntries(FORMATS.map((fmt) => [fmt, taskFiles.reduce((s, f) => {
  const t = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  return s + compChars(t.id, fmt);
}, 0)]));
out.push(`| **TOTAL** |  | **${totals.builder}** | **${totals.markdown}** | **${totals.prose}** |`);
out.push("");
out.push(`Builder vs markdown: ${((totals.builder - totals.markdown) / totals.markdown * 100).toFixed(1)}%. Builder vs prose: ${((totals.builder - totals.prose) / totals.prose * 100).toFixed(1)}%.`);
out.push("");

out.push("### Comprehension by model and format");
out.push("");
for (const m of MODELS) {
  out.push(`**${m.short}:**`);
  out.push("");
  out.push("| Format | Avg coverage | Total matched / total gold |");
  out.push("|---|---:|---:|");
  for (const fmt of FORMATS) {
    const a = agg(m.short, fmt);
    out.push(`| ${fmt} | ${(a.score * 100).toFixed(1)}% | ${a.matched} / ${a.total} |`);
  }
  out.push("");
}

out.push("### Per-task comprehension (Sonnet)");
out.push("");
out.push("| Task | builder | markdown | prose |");
out.push("|---|---:|---:|---:|");
for (const f of taskFiles) {
  const t = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  const cells_t = FORMATS.map((fmt) => cells.find((c) => c.model === "sonnet" && c.task === t.id && c.format === fmt));
  out.push(`| \`${t.id}\` | ${cells_t[0].matched}/${cells_t[0].total} (${(cells_t[0].score * 100).toFixed(0)}%) | ${cells_t[1].matched}/${cells_t[1].total} (${(cells_t[1].score * 100).toFixed(0)}%) | ${cells_t[2].matched}/${cells_t[2].total} (${(cells_t[2].score * 100).toFixed(0)}%) |`);
}
out.push("");

out.push("### Per-task comprehension (GPT-5.5)");
out.push("");
out.push("| Task | builder | markdown | prose |");
out.push("|---|---:|---:|---:|");
for (const f of taskFiles) {
  const t = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  const cells_t = FORMATS.map((fmt) => cells.find((c) => c.model === "gpt-5.5" && c.task === t.id && c.format === fmt));
  out.push(`| \`${t.id}\` | ${cells_t[0].matched}/${cells_t[0].total} (${(cells_t[0].score * 100).toFixed(0)}%) | ${cells_t[1].matched}/${cells_t[1].total} (${(cells_t[1].score * 100).toFixed(0)}%) | ${cells_t[2].matched}/${cells_t[2].total} (${(cells_t[2].score * 100).toFixed(0)}%) |`);
}
out.push("");

out.push("## Verdict");
out.push("");
const winners = {};
for (const m of MODELS) {
  const winnerFmt = FORMATS.reduce((a, b) => agg(m.short, a).score >= agg(m.short, b).score ? a : b);
  winners[m.short] = { fmt: winnerFmt, score: agg(m.short, winnerFmt).score };
}
for (const m of MODELS) {
  out.push(`- **${m.short} comprehension winner:** ${winners[m.short].fmt} (${(winners[m.short].score * 100).toFixed(1)}%)`);
}
const compWinner = FORMATS.reduce((a, b) => totals[a] <= totals[b] ? a : b);
out.push(`- **Compression winner (lower chars):** ${compWinner} (${totals[compWinner]} chars)`);
out.push("");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").split("Z")[0];
const outFile = join(REPORTS, `eval-v5c-fair-${stamp}.md`);
writeFileSync(outFile, out.join("\n") + "\n");
console.log(`Wrote ${outFile}`);
console.log("\n=== HEADLINE ===");
console.log("Compression total chars:");
for (const fmt of FORMATS) console.log(`  ${fmt}: ${totals[fmt]}`);
console.log("\nComprehension scores:");
for (const m of MODELS) {
  for (const fmt of FORMATS) {
    const a = agg(m.short, fmt);
    console.log(`  ${m.short}/${fmt}: ${(a.score * 100).toFixed(1)}% (${a.matched}/${a.total})`);
  }
}
