// Reads results/raw.jsonl and produces a markdown summary table.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const RAW = join(ROOT, "results", "raw.jsonl");
const OUT = join(ROOT, "results", "summary.md");

interface Row {
  bucket: string;
  prompt_id: string;
  model: string;
  condition: string;
  run: number;
  asserts: any;
  judge: any;
  sut_cost_usd: number;
}

function loadRows(): Row[] {
  const text = readFileSync(RAW, "utf8");
  return text.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
}

function mean(xs: number[]) {
  const filtered = xs.filter(x => Number.isFinite(x));
  if (filtered.length === 0) return NaN;
  return filtered.reduce((a, b) => a + b, 0) / filtered.length;
}

function fmt(x: number, digits = 2) {
  return Number.isFinite(x) ? x.toFixed(digits) : "—";
}

function main() {
  const rows = loadRows();

  // Group by (model, condition).
  const byCell = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.model}|${r.condition}`;
    (byCell.get(key) ?? byCell.set(key, []).get(key)!).push(r);
  }

  const lines: string[] = [];
  lines.push("# Builder-Language Eval Results");
  lines.push("");
  lines.push(`Total runs: ${rows.length}`);
  lines.push(`Total SUT cost: $${rows.reduce((a, r) => a + (r.sut_cost_usd ?? 0), 0).toFixed(3)}`);
  lines.push("");

  lines.push("## Per-cell summary");
  lines.push("");
  lines.push("| Model | Condition | Chain% (use) | Prose% (skip) | No-arrow | Named SubNoun | Vocab% | Adoption (avg) | Completeness (avg) |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|");

  const cellKeys = [...byCell.keys()].sort();
  for (const key of cellKeys) {
    const [model, condition] = key.split("|");
    const cell = byCell.get(key)!;

    const useRows = cell.filter(r => r.bucket === "should_use" || r.bucket === "adversarial");
    const skipRows = cell.filter(r => r.bucket === "should_skip");

    const chainOnUse = useRows.length === 0 ? NaN
      : useRows.filter(r => r.asserts.has_chain).length / useRows.length;
    const proseOnSkip = skipRows.length === 0 ? NaN
      : skipRows.filter(r => !r.asserts.has_chain).length / skipRows.length;
    const noArrow = mean(cell.map(r => r.asserts.no_arrows ? 1 : 0));
    const namedSub = mean(cell.map(r => r.asserts.named_subnouns ? 1 : 0));
    const vocab = mean(cell.map(r => r.asserts.vocab_ratio));
    const adoption = mean(cell.map(r => r.judge?.adoption?.score));
    const completeness = mean(cell.filter(r => r.judge?.completeness)
      .map(r => r.judge.completeness.score));

    lines.push(`| ${model.split("/")[1]} | ${condition} | ${fmt(chainOnUse * 100, 0)}% | ${fmt(proseOnSkip * 100, 0)}% | ${fmt(noArrow * 100, 0)}% | ${fmt(namedSub * 100, 0)}% | ${fmt(vocab * 100, 0)}% | ${fmt(adoption)} | ${fmt(completeness)} |`);
  }

  // With-vs-without delta per model
  lines.push("");
  lines.push("## With-skill vs without-skill delta");
  lines.push("");
  lines.push("| Model | Δ chain-on-use | Δ prose-on-skip | Δ adoption |");
  lines.push("|---|---:|---:|---:|");
  const models = [...new Set(rows.map(r => r.model))];
  for (const model of models) {
    const w = byCell.get(`${model}|with-skill`) ?? [];
    const wo = byCell.get(`${model}|without-skill`) ?? [];
    const c = (rows: Row[]) => {
      const u = rows.filter(r => r.bucket === "should_use" || r.bucket === "adversarial");
      const s = rows.filter(r => r.bucket === "should_skip");
      return {
        chainUse: u.length ? u.filter(r => r.asserts.has_chain).length / u.length : NaN,
        proseSkip: s.length ? s.filter(r => !r.asserts.has_chain).length / s.length : NaN,
        adoption: mean(rows.map(r => r.judge?.adoption?.score)),
      };
    };
    const W = c(w); const O = c(wo);
    lines.push(`| ${model.split("/")[1]} | ${fmt((W.chainUse - O.chainUse) * 100, 0)}pp | ${fmt((W.proseSkip - O.proseSkip) * 100, 0)}pp | ${fmt(W.adoption - O.adoption)} |`);
  }

  writeFileSync(OUT, lines.join("\n") + "\n");
  console.log(`Wrote ${OUT}`);
  console.log("\n" + lines.join("\n"));
}

main();
