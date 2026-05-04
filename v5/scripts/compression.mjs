// Compression analysis: char count + estimated token count for each
// (task, format) cell. No API calls. Pure measurement.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const OUT = join(ROOT, "results", "compression.json");

// Rough token estimate: 1 token ≈ 4 chars for English/code (cl100k average).
// Not exact — but consistent across formats so the relative comparison holds.
const charsPerToken = 4;

const FORMATS = ["builder", "markdown", "prose"];

const files = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
const rows = [];

for (const f of files) {
  const t = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  for (const fmt of FORMATS) {
    const text = t[fmt].trimEnd();
    rows.push({
      task: t.id,
      domain: t.domain,
      format: fmt,
      chars: text.length,
      lines: text.split("\n").length,
      est_tokens: Math.round(text.length / charsPerToken),
    });
  }
}

writeFileSync(OUT, JSON.stringify({ ran_at: new Date().toISOString(), rows }, null, 2));
console.log(`Wrote ${OUT}\n`);

// console summary
console.log(`${"Task".padEnd(22)} ${"builder".padStart(8)} ${"markdown".padStart(9)} ${"prose".padStart(7)}  vs_md  vs_prose`);
console.log("-".repeat(72));
for (const f of files) {
  const t = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  const b = rows.find((r) => r.task === t.id && r.format === "builder").chars;
  const m = rows.find((r) => r.task === t.id && r.format === "markdown").chars;
  const p = rows.find((r) => r.task === t.id && r.format === "prose").chars;
  const vsM = ((b - m) / m * 100).toFixed(0);
  const vsP = ((b - p) / p * 100).toFixed(0);
  console.log(`${t.id.padEnd(22)} ${String(b).padStart(8)} ${String(m).padStart(9)} ${String(p).padStart(7)}  ${vsM.padStart(4)}%  ${vsP.padStart(6)}%`);
}
const totals = {};
for (const fmt of FORMATS) totals[fmt] = rows.filter((r) => r.format === fmt).reduce((s, r) => s + r.chars, 0);
console.log("-".repeat(72));
console.log(`${"TOTAL".padEnd(22)} ${String(totals.builder).padStart(8)} ${String(totals.markdown).padStart(9)} ${String(totals.prose).padStart(7)}  ${((totals.builder - totals.markdown) / totals.markdown * 100).toFixed(0).padStart(4)}%  ${((totals.builder - totals.prose) / totals.prose * 100).toFixed(0).padStart(6)}%`);
