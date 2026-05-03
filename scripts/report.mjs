// Aggregate artifacts/results.json into a markdown report for /reports/.
// Per-cell rows roll up by (model, condition).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "artifacts", "results.json");
const REPORTS = join(ROOT, "reports");
mkdirSync(REPORTS, { recursive: true });

const data = JSON.parse(readFileSync(SRC, "utf8"));
const rows = data.results.results;

function getAssert(cr, name) {
  return cr.gradingResult?.componentResults?.find(
    (a) => String(a.assertion?.value || "").includes(name)
  );
}

function pct(n, d) {
  if (!d) return "—";
  return ((n / d) * 100).toFixed(0) + "%";
}

function num(x, digits = 2) {
  return Number.isFinite(x) ? x.toFixed(digits) : "—";
}

// Group by (label, bucket).
const cells = new Map(); // key: `${label}|${bucket}` → array of rows
const labels = new Set();
const buckets = new Set();
let totalCost = 0;

for (const r of rows) {
  const label = r.provider?.label || r.provider?.id || "?";
  const bucket = r.testCase?.metadata?.bucket || "unknown";
  labels.add(label);
  buckets.add(bucket);
  const key = `${label}|${bucket}`;
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(r);
  totalCost += r.cost ?? 0;
}

const sortedLabels = [...labels].sort();
const sortedBuckets = ["should_use", "should_skip", "adversarial"];

const out = [];
out.push("# Builder-Language Eval Results");
out.push("");
out.push(`Run timestamp: ${new Date().toISOString()}`);
out.push(`Total cells: ${rows.length}`);
out.push(`Total cost (sum of OR usage.cost): $${totalCost.toFixed(4)}`);
out.push("");

// === Headline table: Adoption (llm-judge) per (model × condition × bucket) ===
out.push("## Adoption score (LLM judge, 1–5) — higher is better");
out.push("");
out.push("| Provider | should_use | should_skip | adversarial |");
out.push("|---|---:|---:|---:|");
for (const label of sortedLabels) {
  const r = sortedBuckets.map((b) => {
    const cs = cells.get(`${label}|${b}`) || [];
    const scores = cs.map((c) => getAssert(c, "adoption-rubric")?.score)
                     .filter(Number.isFinite);
    if (scores.length === 0) return "—";
    return num(scores.reduce((a, x) => a + x, 0) / scores.length);
  });
  out.push(`| \`${label}\` | ${r[0]} | ${r[1]} | ${r[2]} |`);
}
out.push("");

// === Has-chain rates per cell ===
out.push("## Chain detection (deterministic) — % of outputs that contain a chain");
out.push("");
out.push("On `should_use` and `adversarial`, higher is better (chain expected).");
out.push("On `should_skip`, **lower** is better (prose expected).");
out.push("");
out.push("| Provider | should_use | should_skip | adversarial |");
out.push("|---|---:|---:|---:|");
for (const label of sortedLabels) {
  const r = sortedBuckets.map((b) => {
    const cs = cells.get(`${label}|${b}`) || [];
    const passes = cs.filter((c) => getAssert(c, "has-chain")?.pass).length;
    return cs.length === 0 ? "—" : pct(passes, cs.length);
  });
  out.push(`| \`${label}\` | ${r[0]} | ${r[1]} | ${r[2]} |`);
}
out.push("");

// === Vocab discipline ===
out.push("## Vocab discipline — ratio of standard verbs to total verbs");
out.push("");
out.push("| Provider | should_use | adversarial |");
out.push("|---|---:|---:|");
for (const label of sortedLabels) {
  const r = ["should_use", "adversarial"].map((b) => {
    const cs = cells.get(`${label}|${b}`) || [];
    const scores = cs.map((c) => getAssert(c, "vocab-discipline")?.score)
                     .filter(Number.isFinite);
    if (scores.length === 0) return "—";
    return num(scores.reduce((a, x) => a + x, 0) / scores.length);
  });
  out.push(`| \`${label}\` | ${r[0]} | ${r[1]} |`);
}
out.push("");

// === No-arrows + Named-subnouns (combined: % cells where both pass) ===
out.push("## Syntactic invariants (no `->`, named SubNouns) — pass rate on chain-expected cells");
out.push("");
out.push("| Provider | no-arrows | named-subnouns |");
out.push("|---|---:|---:|");
for (const label of sortedLabels) {
  const cs = [...(cells.get(`${label}|should_use`) || []),
              ...(cells.get(`${label}|adversarial`) || [])];
  const arrowsPass = cs.filter((c) => getAssert(c, "no-arrows")?.pass).length;
  const subnounsPass = cs.filter((c) => getAssert(c, "named-subnouns")?.pass).length;
  out.push(`| \`${label}\` | ${pct(arrowsPass, cs.length)} | ${pct(subnounsPass, cs.length)} |`);
}
out.push("");

// === Completeness ===
out.push("## Completeness (LLM judge, 1–5) — does the output cover the prompt?");
out.push("");
out.push("| Provider | should_use | adversarial |");
out.push("|---|---:|---:|");
for (const label of sortedLabels) {
  const r = ["should_use", "adversarial"].map((b) => {
    const cs = cells.get(`${label}|${b}`) || [];
    const scores = cs.map((c) => getAssert(c, "completeness-rubric")?.score)
                     .filter(Number.isFinite);
    if (scores.length === 0) return "—";
    return num(scores.reduce((a, x) => a + x, 0) / scores.length);
  });
  out.push(`| \`${label}\` | ${r[0]} | ${r[1]} |`);
}
out.push("");

// === Headline: with-skill vs with-naive vs without-skill, averaged across models ===
out.push("## With-skill vs with-naive vs without-skill — averaged across all 4 models");
out.push("");
function avgFor(condition, bucket, asserter) {
  const all = [];
  for (const m of ["opus-4.7", "sonnet-4.6", "haiku-4.5", "gpt-5.5"]) {
    const cs = cells.get(`${m}/${condition}|${bucket}`) || [];
    for (const c of cs) {
      const a = getAssert(c, asserter);
      if (a && Number.isFinite(a.score)) all.push(a.score);
    }
  }
  if (all.length === 0) return "—";
  return num(all.reduce((a, x) => a + x, 0) / all.length);
}
function passRate(condition, bucket, asserter) {
  const all = [];
  for (const m of ["opus-4.7", "sonnet-4.6", "haiku-4.5", "gpt-5.5"]) {
    const cs = cells.get(`${m}/${condition}|${bucket}`) || [];
    for (const c of cs) {
      const a = getAssert(c, asserter);
      if (a) all.push(a.pass ? 1 : 0);
    }
  }
  if (all.length === 0) return "—";
  return pct(all.reduce((a, x) => a + x, 0), all.length);
}

out.push("| Metric | with-skill | with-naive | without-skill |");
out.push("|---|---:|---:|---:|");
out.push(`| Adoption (should_use) | ${avgFor("with-skill", "should_use", "adoption-rubric")} | ${avgFor("with-naive", "should_use", "adoption-rubric")} | ${avgFor("without-skill", "should_use", "adoption-rubric")} |`);
out.push(`| Adoption (adversarial) | ${avgFor("with-skill", "adversarial", "adoption-rubric")} | ${avgFor("with-naive", "adversarial", "adoption-rubric")} | ${avgFor("without-skill", "adversarial", "adoption-rubric")} |`);
out.push(`| Chain on should_use | ${passRate("with-skill", "should_use", "has-chain")} | ${passRate("with-naive", "should_use", "has-chain")} | ${passRate("without-skill", "should_use", "has-chain")} |`);
out.push(`| Prose on should_skip | ${passRate("with-skill", "should_skip", "has-chain")} | ${passRate("with-naive", "should_skip", "has-chain")} | ${passRate("without-skill", "should_skip", "has-chain")} |`);
out.push(`| No-arrows on adversarial | ${passRate("with-skill", "adversarial", "no-arrows")} | ${passRate("with-naive", "adversarial", "no-arrows")} | ${passRate("without-skill", "adversarial", "no-arrows")} |`);
out.push(`| Vocab discipline (should_use) | ${avgFor("with-skill", "should_use", "vocab-discipline")} | ${avgFor("with-naive", "should_use", "vocab-discipline")} | ${avgFor("without-skill", "should_use", "vocab-discipline")} |`);
out.push(`| Completeness (should_use) | ${avgFor("with-skill", "should_use", "completeness-rubric")} | ${avgFor("with-naive", "should_use", "completeness-rubric")} | ${avgFor("without-skill", "should_use", "completeness-rubric")} |`);
out.push("");

// === Key takeaways autocomputed ===
out.push("## Headline reads");
out.push("");

const skillAdoptUse = parseFloat(avgFor("with-skill", "should_use", "adoption-rubric"));
const naiveAdoptUse = parseFloat(avgFor("with-naive", "should_use", "adoption-rubric"));
const baselineAdoptUse = parseFloat(avgFor("without-skill", "should_use", "adoption-rubric"));
const delta_skill_naive = (skillAdoptUse - naiveAdoptUse).toFixed(2);
const delta_skill_baseline = (skillAdoptUse - baselineAdoptUse).toFixed(2);

out.push(`- Adoption on should_use: with-skill ${skillAdoptUse} | with-naive ${naiveAdoptUse} | without-skill ${baselineAdoptUse}`);
out.push(`- Skill - naive delta: **${delta_skill_naive}** (positive = skill beats naive prompt; this is Dex's question)`);
out.push(`- Skill - baseline delta: **${delta_skill_baseline}** (positive = skill changes behavior at all)`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").split("Z")[0];
const outFile = join(REPORTS, `eval-${stamp}.md`);
writeFileSync(outFile, out.join("\n") + "\n");
console.log(`Wrote ${outFile}`);
console.log("\n" + out.join("\n"));
