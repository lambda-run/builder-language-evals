// v3.5: executor isolation test.
// Feed the executor hardcoded "perfect" plans in 5 formats. Measure ONLY
// the executor's parallelization behaviour. Planner is removed from the loop.
//
// Output: v3.5/results/<task_id>__<format>.json

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "..", "v3", "tasks");
const PLANS = join(ROOT, "plans");
const OUT = join(ROOT, "results-gpt55");
mkdirSync(OUT, { recursive: true });

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const EXECUTOR_MODEL = "openai/gpt-5.5";
const TEMPERATURE = 0.2;
const MAX_TURNS = 10;

const SYSTEM = `You are an executor agent. You will be given a USER GOAL and a PLAN. Execute the plan by calling the available tools.

Rules:
1. Read the plan and call the tools it describes.
2. When the plan says certain steps run in parallel, emit those tool calls TOGETHER in a single response (multiple tool_calls in one assistant message).
3. Stop calling tools once the plan is complete.
4. Use the user goal to fill in the actual argument values for each tool.`;

const FORMATS = ["builder", "markdown_checklist", "markdown_explicit", "json", "terse"];

function toolsForOpenAI(task) {
  return task.available_tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}
function cannedFor(toolName, task) {
  const v = task.canned_responses?.[toolName];
  return v === undefined ? { ok: true } : v;
}

async function call(messages, tools) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      "HTTP-Referer": "https://github.com/lambda-run/builder-language-evals",
      "X-Title": "builder-language-evals v3.5",
    },
    body: JSON.stringify({
      model: EXECUTOR_MODEL,
      temperature: TEMPERATURE,
      tools, tool_choice: "auto", parallel_tool_calls: true, messages,
    }),
  });
  if (!r.ok) throw new Error(`OR ${r.status}: ${await r.text()}`);
  return await r.json();
}

function safeJSON(s) { try { return JSON.parse(s); } catch { return s; } }

async function runAgent(task, plan) {
  const tools = toolsForOpenAI(task);
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `User goal:\n${task.fuzzy_goal}\n\nPlan to execute:\n${plan}\n\nExecute the plan now by calling tools.` },
  ];
  const trace = [];
  let pT = 0, cT = 0, cost = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await call(messages, tools);
    pT += resp.usage?.prompt_tokens ?? 0;
    cT += resp.usage?.completion_tokens ?? 0;
    cost += resp.usage?.cost ?? 0;
    const msg = resp.choices?.[0]?.message;
    const tcs = msg?.tool_calls ?? [];
    if (tcs.length === 0) {
      trace.push({ turn, tool_calls: [], parallel: false, final_text: msg?.content ?? "" });
      break;
    }
    const calls = tcs.map((tc) => ({ id: tc.id, name: tc.function.name, args: safeJSON(tc.function.arguments) }));
    trace.push({ turn, tool_calls: calls, parallel: calls.length > 1 });
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: tcs });
    for (const tc of tcs) {
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(cannedFor(tc.function.name, task)) });
    }
  }
  return { trace, prompt_tokens: pT, completion_tokens: cT, cost, turns: trace.length };
}

const files = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
console.log(`v3.5: ${files.length} tasks × ${FORMATS.length} formats = ${files.length * FORMATS.length} runs`);

let totalCost = 0;
for (const f of files) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  for (const fmt of FORMATS) {
    const outFile = join(OUT, `${task.id}__${fmt}.json`);
    if (existsSync(outFile)) { console.log(`  ${task.id}/${fmt}: cached`); continue; }
    const planFile = join(PLANS, `${task.id}__${fmt}.txt`);
    if (!existsSync(planFile)) { console.log(`  ${task.id}/${fmt}: NO PLAN`); continue; }
    const plan = readFileSync(planFile, "utf8").trim();
    process.stdout.write(`  ${task.id}/${fmt}: `);
    try {
      const r = await runAgent(task, plan);
      totalCost += r.cost;
      const calls = r.trace.reduce((s, t) => s + t.tool_calls.length, 0);
      const par = r.trace.filter((t) => t.parallel).length;
      console.log(`✓ ${r.turns}t ${calls}c ${par}p $${r.cost.toFixed(4)}`);
      writeFileSync(outFile, JSON.stringify({
        task_id: task.id, format: fmt, executor_model: EXECUTOR_MODEL,
        plan, trace: r.trace,
        prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens,
        cost: r.cost, turns: r.turns, ran_at: new Date().toISOString(),
      }, null, 2));
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
}
console.log(`\nv3.5 total cost: $${totalCost.toFixed(4)}`);
