// Agent A: Planner.
// Receives a fuzzy goal + a tool catalog, produces a PLAN in one of three
// formats: builder | json | markdown. The plan tells Agent B what to do.
//
// Output: v3/results/plans/<task_id>__<condition>.json
//
// Usage: bun run v3/scripts/plan.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const OUT = join(ROOT, "results", "plans");
mkdirSync(OUT, { recursive: true });

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const PLANNER_MODEL = "anthropic/claude-sonnet-4.6";
const TEMPERATURE = 0.2;

const SYSTEM = {
  builder: `You are a planning agent. Your job: read a fuzzy user goal and the available tools, then produce a PLAN in BUILDER syntax that another agent will execute.

Builder syntax — use \`Noun.verb(...).verb(...)\` chains. Example:
  PRReview
    .parallelize(
        run_lint(pr_id),
        run_tests(pr_id),
        check_security(pr_id))
    .if(any check has issues): post_to_slack(channel, message)
    .else: approve_pr(pr_id)

Rules:
- Use \`.parallelize(a, b, c)\` for tools that can run concurrently (independent inputs).
- Use \`.sequence(a, b)\` or chained verbs for ordered steps.
- Use \`.if(condition): action\` for conditional dispatch.
- Inline \`// comments\` for non-obvious choices.
- Output ONLY the builder spec inside a fenced \`\`\`builder block. No prose before or after.`,

  json: `You are a planning agent. Your job: read a fuzzy user goal and the available tools, then produce a PLAN in JSON that another agent will execute.

JSON schema — an object like:
{
  "steps": [
    { "parallel": true, "calls": [{"tool": "run_lint", "args": {"pr_id": "..."}}, {"tool": "run_tests", "args": {...}}] },
    { "parallel": false, "calls": [{"tool": "approve_pr", "args": {...}}] }
  ],
  "conditionals": [
    { "if": "any check has issues", "then": [{"tool": "post_to_slack", "args": {...}}] }
  ]
}

Rules:
- \`steps\` is an ordered list. Each step has \`parallel: true\` if calls inside can run concurrently.
- Use \`conditionals\` for branching logic.
- Output ONLY the JSON inside a fenced \`\`\`json block. No prose before or after.`,

  markdown: `You are a planning agent. Your job: read a fuzzy user goal and the available tools, then produce a PLAN in MARKDOWN that another agent will execute.

Markdown structure — use headers, sub-headers, bullets. Example:

# Plan
## Step 1 (parallel)
- Call \`run_lint\` with pr_id
- Call \`run_tests\` with pr_id
- Call \`check_security\` with pr_id

## Step 2
- If any check has issues: call \`post_to_slack\` with channel, message
- Otherwise: call \`approve_pr\` with pr_id

Rules:
- Use \`(parallel)\` in step headers when calls can run concurrently.
- Use bullets for individual tool calls and conditionals.
- Output ONLY the markdown plan. No prose preamble.`,
};

function buildPrompt(task) {
  const tools = task.available_tools.map((t) => {
    const props = Object.entries(t.input_schema.properties)
      .map(([k, v]) => `${k}: ${v.type}`)
      .join(", ");
    return `- ${t.name}(${props}) — ${t.description}`;
  }).join("\n");

  return `User goal:
${task.fuzzy_goal}

Available tools:
${tools}

Produce the plan now.`;
}

async function call(systemPrompt, prompt) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      "HTTP-Referer": "https://github.com/lambda-run/builder-language-evals",
      "X-Title": "builder-language-evals v3",
    },
    body: JSON.stringify({
      model: PLANNER_MODEL,
      temperature: TEMPERATURE,
      messages: [
        { role: "system", content: systemPrompt },
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
const conditions = ["builder", "json", "markdown"];
console.log(`Planning ${files.length} tasks × ${conditions.length} conditions = ${files.length * conditions.length} plans`);

let totalCost = 0;
for (const f of files) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  const userPrompt = buildPrompt(task);
  for (const cond of conditions) {
    const outFile = join(OUT, `${task.id}__${cond}.json`);
    if (existsSync(outFile)) {
      console.log(`  ${task.id}/${cond}: cached`);
      continue;
    }
    process.stdout.write(`  ${task.id}/${cond}: planning... `);
    try {
      const result = await call(SYSTEM[cond], userPrompt);
      totalCost += result.cost;
      console.log(`✓ $${result.cost.toFixed(4)} (${result.prompt_tokens}+${result.completion_tokens} tok)`);
      writeFileSync(outFile, JSON.stringify({
        task_id: task.id,
        condition: cond,
        planner_model: PLANNER_MODEL,
        system_prompt: SYSTEM[cond],
        user_prompt: userPrompt,
        plan: result.content,
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
console.log(`\nPlanning total cost: $${totalCost.toFixed(4)}`);
