// Main eval runner.
//
// For each prompt × model × condition × run:
//   1. Call the model via OpenRouter (with or without skill in system prompt)
//   2. Run deterministic syntactic asserts on the output
//   3. Run LLM judge (Gemini) for soft dimensions
//   4. Append a result row to results/raw.jsonl
//
// Hard cost cap aborts the run before it exceeds the budget.

import { readFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

import { callOpenRouter } from "./providers.ts";
import { assertOutput } from "./asserts.ts";
import { judge } from "./judge.ts";

const ROOT = join(import.meta.dir, "..");
const RESULTS_DIR = join(ROOT, "results");
const RAW_PATH = join(RESULTS_DIR, "raw.jsonl");

const SUT_MODELS = [
  "anthropic/claude-opus-4.7",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-5.5",
];

const CONDITIONS = ["with-skill", "without-skill"] as const;
type Condition = typeof CONDITIONS[number];

const RUNS_PER_CELL = 3;
const BUDGET_USD = 150;
const ALARM_USD = 120;          // halt + report at 80% of budget

const SKILL_MD = readFileSync(join(ROOT, "skill", "SKILL.md"), "utf8");

interface Golden {
  id: string;
  prompt: string;
  note?: string;
}

interface Bucket {
  bucket: "should_use" | "should_skip" | "adversarial";
  prompts: Golden[];
}

function loadGoldens(): Bucket[] {
  const buckets: Bucket[] = [];
  for (const b of ["should_use", "should_skip", "adversarial"] as const) {
    const text = readFileSync(join(ROOT, "goldens", `${b}.yaml`), "utf8");
    const prompts = YAML.parse(text) as Golden[];
    buckets.push({ bucket: b, prompts });
  }
  return buckets;
}

function buildSystemPrompt(condition: Condition): string | undefined {
  if (condition === "without-skill") return undefined;
  // Strip the YAML frontmatter so it reads cleanly as a system instruction.
  const body = SKILL_MD.replace(/^---[\s\S]*?---\s*/m, "").trim();
  return [
    "You are an assistant. The following skill is loaded into your context.",
    "Decide whether to apply it based on the skill's own rules.",
    "",
    "--- SKILL: builder-language ---",
    body,
    "--- END SKILL ---",
  ].join("\n");
}

interface Cell {
  bucket: string;
  prompt_id: string;
  prompt: string;
  model: string;
  condition: Condition;
  run: number;
}

function buildCells(buckets: Bucket[], opts: { dry: boolean }): Cell[] {
  const cells: Cell[] = [];
  const promptsToRun = opts.dry
    ? buckets.flatMap(b => b.prompts.slice(0, 1)).slice(0, 1)  // 1 prompt total
    : buckets.flatMap(b => b.prompts.map(p => ({ ...p, _bucket: b.bucket })));
  const buckLookup = (id: string) =>
    buckets.find(b => b.prompts.some(p => p.id === id))!.bucket;
  const runs = opts.dry ? 1 : RUNS_PER_CELL;
  const models = opts.dry ? ["anthropic/claude-haiku-4.5"] : SUT_MODELS;

  for (const p of promptsToRun) {
    for (const model of models) {
      for (const condition of CONDITIONS) {
        for (let run = 1; run <= runs; run++) {
          cells.push({
            bucket: buckLookup(p.id),
            prompt_id: p.id,
            prompt: p.prompt,
            model,
            condition,
            run,
          });
        }
      }
    }
  }
  return cells;
}

let totalCostUSD = 0;

async function processCell(cell: Cell) {
  const system = buildSystemPrompt(cell.condition);

  const sut = await callOpenRouter({
    model: cell.model,
    system,
    user: cell.prompt,
    max_tokens: 2500,
  });
  totalCostUSD += sut.cost_usd;

  const asserts = assertOutput(sut.text);

  // LLM judge dimensions
  const adoption = await judge({ rubric: "adoption", prompt: cell.prompt, output: sut.text });
  totalCostUSD += adoption.cost_usd;

  let completeness = null;
  let why_comments = null;
  if (cell.bucket !== "should_skip") {
    completeness = await judge({ rubric: "completeness", prompt: cell.prompt, output: sut.text });
    totalCostUSD += completeness.cost_usd;

    if (asserts.has_chain) {
      why_comments = await judge({ rubric: "why_comments", prompt: cell.prompt, output: sut.text });
      totalCostUSD += why_comments.cost_usd;
    }
  }

  const row = {
    ts: new Date().toISOString(),
    bucket: cell.bucket,
    prompt_id: cell.prompt_id,
    model: cell.model,
    condition: cell.condition,
    run: cell.run,
    output: sut.text,
    sut_cost_usd: sut.cost_usd,
    sut_provider: sut.provider,
    asserts,
    judge: {
      adoption: { score: adoption.score, rationale: adoption.rationale },
      completeness: completeness && { score: completeness.score, rationale: completeness.rationale },
      why_comments: why_comments && { score: why_comments.score, rationale: why_comments.rationale },
    },
    running_cost_usd: totalCostUSD,
  };
  appendFileSync(RAW_PATH, JSON.stringify(row) + "\n");
  return row;
}

async function main() {
  const dry = process.argv.includes("--dry");
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  // Fresh raw file per run.
  if (existsSync(RAW_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    Bun.write(join(RESULTS_DIR, `raw-${stamp}.jsonl`), readFileSync(RAW_PATH));
  }
  Bun.write(RAW_PATH, "");

  const buckets = loadGoldens();
  const cells = buildCells(buckets, { dry });

  console.log(`Mode: ${dry ? "DRY" : "FULL"}`);
  console.log(`Cells to run: ${cells.length}`);
  console.log(`Budget cap: $${BUDGET_USD}, alarm at $${ALARM_USD}`);
  console.log("---");

  let i = 0;
  for (const cell of cells) {
    i++;
    const tag = `[${i}/${cells.length}] ${cell.bucket}/${cell.prompt_id} ${cell.model.split("/")[1]} ${cell.condition}#${cell.run}`;
    try {
      const row = await processCell(cell);
      const ad = row.judge.adoption.score;
      const ch = row.asserts.has_chain ? "chain" : "prose";
      console.log(`${tag} → ${ch} adoption=${ad} (running $${totalCostUSD.toFixed(3)})`);
    } catch (e: any) {
      console.error(`${tag} FAILED: ${e.message}`);
    }

    if (totalCostUSD >= ALARM_USD) {
      console.error(`\nALARM: spent $${totalCostUSD.toFixed(2)} >= $${ALARM_USD}. Halting.`);
      break;
    }
  }

  console.log("---");
  console.log(`Done. Total cost: $${totalCostUSD.toFixed(3)}`);
  console.log(`Raw results: ${RAW_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
