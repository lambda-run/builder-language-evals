// Agent B: Executor.
// Receives a plan + the same tool catalog and runs an agent loop with tool
// calling. Records the FULL trace, including parallel-tool-call groupings:
// when the model emits multiple tool_calls in one response, that's a parallel
// group; when it emits them across separate turns (with tool results in
// between), that's sequential.
//
// Tool calls return canned responses defined per task.
//
// Output: v3/results/traces/<task_id>__<condition>.json
//
// Usage: bun run v3/scripts/execute.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const PLANS = join(ROOT, "results", "plans");
const OUT = join(ROOT, "results", "traces");
mkdirSync(OUT, { recursive: true });

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const EXECUTOR_MODEL = "anthropic/claude-sonnet-4.6";
const TEMPERATURE = 0.2;
const MAX_TURNS = 10;

const SYSTEM = `You are an executor agent. You will be given a PLAN written by another agent and a set of tools. Your job: execute the plan by calling the tools.

Rules:
1. Read the plan and call the tools it describes, with appropriate arguments.
2. When the plan says certain steps run in parallel, emit those tool calls TOGETHER in a single response (multiple tool_calls in one assistant message). Do not split them across turns.
3. Honor conditional logic in the plan — call follow-up tools only if the conditions are met based on tool results.
4. Stop calling tools once the plan is complete. Do not call tools that aren't in the plan.
5. Be efficient — minimum tool calls needed to satisfy the plan.`;

function toolsForOpenAI(task) {
  return task.available_tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function cannedFor(toolName, task) {
  const v = task.canned_responses?.[toolName];
  if (v === undefined) return { ok: true };
  return v;
}

async function call(messages, tools) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      "HTTP-Referer": "https://github.com/lambda-run/builder-language-evals",
      "X-Title": "builder-language-evals v3",
    },
    body: JSON.stringify({
      model: EXECUTOR_MODEL,
      temperature: TEMPERATURE,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: true,
      messages,
    }),
  });
  if (!r.ok) throw new Error(`OR ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function runAgentLoop(task, plan) {
  const tools = toolsForOpenAI(task);
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Plan to execute:\n\n${plan}\n\nExecute the plan now by calling tools.` },
  ];

  const trace = []; // [{turn, tool_calls: [{name, args}], parallel: bool}]
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCost = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await call(messages, tools);
    const usage = resp.usage ?? {};
    totalPromptTokens += usage.prompt_tokens ?? 0;
    totalCompletionTokens += usage.completion_tokens ?? 0;
    totalCost += usage.cost ?? 0;

    const msg = resp.choices?.[0]?.message;
    if (!msg) throw new Error("no message in response");

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      // model is done — record final assistant message and stop
      trace.push({ turn, tool_calls: [], parallel: false, final_text: msg.content ?? "" });
      break;
    }

    // record this turn's tool calls (multiple = parallel emission)
    const calls = toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: safeParseJSON(tc.function.arguments),
    }));
    trace.push({ turn, tool_calls: calls, parallel: calls.length > 1 });

    // append assistant message + a tool message for each call
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
    for (const tc of toolCalls) {
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(cannedFor(tc.function.name, task)),
      });
    }
  }

  return {
    trace,
    prompt_tokens: totalPromptTokens,
    completion_tokens: totalCompletionTokens,
    cost: totalCost,
    turns: trace.length,
    final_messages: messages,
  };
}

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return s; }
}

const files = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
const conditions = ["builder", "json", "markdown"];
console.log(`Executing ${files.length} tasks × ${conditions.length} conditions = ${files.length * conditions.length} runs`);

let totalCost = 0;
for (const f of files) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  for (const cond of conditions) {
    const outFile = join(OUT, `${task.id}__${cond}.json`);
    if (existsSync(outFile)) { console.log(`  ${task.id}/${cond}: cached`); continue; }

    const planFile = join(PLANS, `${task.id}__${cond}.json`);
    if (!existsSync(planFile)) { console.log(`  ${task.id}/${cond}: NO PLAN, skip`); continue; }
    const plan = JSON.parse(readFileSync(planFile, "utf8")).plan;

    process.stdout.write(`  ${task.id}/${cond}: executing... `);
    try {
      const result = await runAgentLoop(task, plan);
      totalCost += result.cost;
      const totalCalls = result.trace.reduce((s, t) => s + t.tool_calls.length, 0);
      const parallelTurns = result.trace.filter((t) => t.parallel).length;
      console.log(`✓ ${result.turns} turns, ${totalCalls} calls (${parallelTurns} parallel) $${result.cost.toFixed(4)} (${result.prompt_tokens}+${result.completion_tokens})`);
      writeFileSync(outFile, JSON.stringify({
        task_id: task.id,
        condition: cond,
        executor_model: EXECUTOR_MODEL,
        plan,
        trace: result.trace,
        prompt_tokens: result.prompt_tokens,
        completion_tokens: result.completion_tokens,
        cost: result.cost,
        turns: result.turns,
        ran_at: new Date().toISOString(),
      }, null, 2));
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
}
console.log(`\nExecution total cost: $${totalCost.toFixed(4)}`);
