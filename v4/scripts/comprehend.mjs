// Comprehension test: feed each (task, format) declaration to a model.
// Ask the model to produce a "manifest" — every concrete component, action,
// or output that should result from honoring the declaration.
// Score = % of gold_elements present (case-insensitive substring) in the
// manifest text.
//
// Run on Sonnet 4.6 + GPT-5.5 for cross-model robustness.
//
// Output: v4/results/<model>__<task>__<format>.json

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const OUT = join(ROOT, "results");
mkdirSync(OUT, { recursive: true });

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const MODELS = ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"];
const FORMATS = ["builder", "markdown", "prose"];

const SYSTEM = `You read declarations of intent (project specs, agent definitions, ops pipelines, audits, etc.) and extract every concrete component, action, configuration, or output that follows from honoring the declaration.

Output a single MANIFEST as a flat bullet list. Each line is one concrete element. Be exhaustive — include every component, parameter, choice, or step the declaration mentions or directly implies. Do not add prose; only the bullet list.

Do not invent things the declaration does not mention. If the declaration is ambiguous on a point, omit it.`;

function buildPrompt(task, fmt) {
  return `Declaration (in ${fmt} format):

${task[fmt].trimEnd()}

Output a flat bullet list manifest of every concrete element this declaration implies.`;
}

async function call(model, prompt) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      "HTTP-Referer": "https://github.com/lambda-run/builder-language-evals",
      "X-Title": "builder-language-evals v4",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OR ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    cost: j.usage?.cost ?? 0,
    prompt_tokens: j.usage?.prompt_tokens ?? 0,
    completion_tokens: j.usage?.completion_tokens ?? 0,
  };
}

const files = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
console.log(`v4: ${files.length} tasks × ${FORMATS.length} formats × ${MODELS.length} models = ${files.length * FORMATS.length * MODELS.length} runs`);

let totalCost = 0;
for (const f of files) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  for (const model of MODELS) {
    const slug = model.split("/")[1].replace(/\./g, "_");
    for (const fmt of FORMATS) {
      const outFile = join(OUT, `${slug}__${task.id}__${fmt}.json`);
      if (existsSync(outFile)) { console.log(`  ${slug}/${task.id}/${fmt}: cached`); continue; }
      const prompt = buildPrompt(task, fmt);
      process.stdout.write(`  ${slug}/${task.id}/${fmt}: `);
      try {
        const r = await call(model, prompt);
        totalCost += r.cost;
        console.log(`✓ $${r.cost.toFixed(4)} (${r.prompt_tokens}+${r.completion_tokens})`);
        writeFileSync(outFile, JSON.stringify({
          model, task_id: task.id, format: fmt, prompt,
          manifest: r.content,
          prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens,
          cost: r.cost, ran_at: new Date().toISOString(),
        }, null, 2));
      } catch (e) {
        console.log(`✗ ${e.message}`);
      }
    }
  }
}
console.log(`\nTotal cost: $${totalCost.toFixed(4)}`);
