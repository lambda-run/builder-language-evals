// Execute every (task, condition) pair through Sonnet 4.6 via OpenRouter.
// The executor's prompt is FORMAT-NEUTRAL — it gives the spec, the function
// signature, and the rule "do NOT execute the spec text as literal code."
// We don't tell the executor which condition it's seeing.
//
// Output: v2/results/<task_id>__<condition>.json with the model's response.
//
// Usage: bun run v2/scripts/execute.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const TRANSL = join(ROOT, "translations");
const OUT = join(ROOT, "results");
mkdirSync(OUT, { recursive: true });

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const EXECUTOR_MODEL = "anthropic/claude-sonnet-4.6";
const TEMPERATURE = 0.2;

const NEUTRAL_SYSTEM = `You are an automated system that implements technical specifications as Python functions.

Given a specification and a function signature, you must:
1. Implement the function in Python so that it satisfies the specification.
2. Output ONLY a Python code block containing the function. No prose before or after.
3. Do NOT attempt to execute the specification text as literal Python code — it is a description of what the function should do, not Python source.
4. Match the function name and argument signature exactly as given.
5. Pure-Python only. No imports beyond the standard library.

Output format must be exactly:

\`\`\`python
def function_name(...):
    ...
\`\`\`

Nothing else.`;

function buildPrompt(spec, signature) {
  return `Function signature you must implement:

\`\`\`python
${signature}
\`\`\`

Specification (description of what the function should do):

${spec}

Implement the function. Output ONLY the Python code block.`;
}

async function call(prompt) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      "HTTP-Referer": "https://github.com/lambda-run/builder-language-evals",
      "X-Title": "builder-language-evals v2",
    },
    body: JSON.stringify({
      model: EXECUTOR_MODEL,
      temperature: TEMPERATURE,
      messages: [
        { role: "system", content: NEUTRAL_SYSTEM },
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
console.log(`Executing ${files.length} tasks × 3 conditions = ${files.length * 3} cells with ${EXECUTOR_MODEL}`);

let totalCost = 0;
const conditions = ["builder", "markdown", "plain"];

for (const f of files) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  const transl = JSON.parse(readFileSync(join(TRANSL, `${task.id}.json`), "utf8"));

  for (const cond of conditions) {
    const outFile = join(OUT, `${task.id}__${cond}.json`);
    if (existsSync(outFile)) {
      console.log(`  ${task.id}/${cond}: cached, skipping`);
      continue;
    }

    let spec;
    if (cond === "builder") spec = task.gold_builder;
    else if (cond === "markdown") spec = transl.markdown;
    else spec = transl.plain;

    const prompt = buildPrompt(spec, task.function_signature);
    process.stdout.write(`  ${task.id}/${cond}: calling... `);

    try {
      const result = await call(prompt);
      totalCost += result.cost;
      console.log(`✓ $${result.cost.toFixed(4)} (${result.prompt_tokens}+${result.completion_tokens} tok)`);
      writeFileSync(outFile, JSON.stringify({
        task_id: task.id,
        condition: cond,
        executor_model: EXECUTOR_MODEL,
        prompt,
        response: result.content,
        cost: result.cost,
        prompt_tokens: result.prompt_tokens,
        completion_tokens: result.completion_tokens,
        ran_at: new Date().toISOString(),
      }, null, 2));
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
}

console.log(`\nTotal cost: $${totalCost.toFixed(4)}`);
