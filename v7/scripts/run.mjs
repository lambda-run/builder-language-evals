// v7: agent builds real artifact in sandbox per spec.
// Each (model, format) cell gets a fresh sandbox dir, max 10 turns,
// scored by running gold_tests against the agent's code.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const SANDBOX_ROOT = join(ROOT, "sandbox");
const RESULTS = join(ROOT, "results");
mkdirSync(RESULTS, { recursive: true });

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }

const MODELS = ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"];
const FORMATS = ["builder", "markdown", "prose"];
const MAX_TURNS = 10;

const SYSTEM = `You are a Python developer. You will be given a spec for a class to implement.

Use the tools to write the implementation in a file named exactly \`rate_limiter.py\`, then run the tests. If tests fail, read your code and the test output, fix the bugs, and run tests again. Stop iterating once all tests pass.

Important:
- The class must be named exactly RateLimiter and live in rate_limiter.py
- Use Python stdlib only (no external packages)
- Tests are run from the same directory as your file
- You have at most 10 turns to converge

Always emit a tool call. When all tests pass, your final tool call should be run_tests so we have the final result.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write (or overwrite) a file in the sandbox.",
      parameters: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the sandbox.",
      parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in the sandbox.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "run_tests",
      description: "Run gold tests against the current sandbox state. Returns stdout including PASS_COUNT=N/M line.",
      parameters: { type: "object", properties: {} },
    },
  },
];

function execTool(call, sandbox, goldTests) {
  const args = JSON.parse(call.function.arguments || "{}");
  try {
    if (call.function.name === "write_file") {
      const safe = args.name.replace(/[^A-Za-z0-9._-]/g, "_");
      writeFileSync(join(sandbox, safe), args.content);
      return `Wrote ${safe} (${args.content.length} chars).`;
    }
    if (call.function.name === "read_file") {
      const safe = args.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const path = join(sandbox, safe);
      if (!existsSync(path)) return `File not found: ${safe}`;
      return readFileSync(path, "utf8");
    }
    if (call.function.name === "list_files") {
      return readdirSync(sandbox).join("\n") || "(empty)";
    }
    if (call.function.name === "run_tests") {
      writeFileSync(join(sandbox, "tests.py"), goldTests);
      try {
        const out = execSync(`cd ${sandbox} && timeout 30 python3 tests.py 2>&1`, { encoding: "utf8" });
        return out;
      } catch (e) {
        return `Test run errored:\n${(e.stdout || "") + (e.stderr || "") + (e.message || "")}`;
      }
    }
  } catch (e) {
    return `Tool error: ${e.message}`;
  }
  return `Unknown tool: ${call.function.name}`;
}

async function call(model, messages) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      "HTTP-Referer": "https://github.com/lambda-run/builder-language-evals",
      "X-Title": "builder-language-evals v7",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      parallel_tool_calls: false,
    }),
  });
  if (!r.ok) throw new Error(`OR ${r.status}: ${await r.text()}`);
  return r.json();
}

function extractPassCount(toolResult) {
  const m = toolResult.match(/PASS_COUNT=(\d+)\/(\d+)/);
  return m ? { passed: parseInt(m[1], 10), total: parseInt(m[2], 10) } : null;
}

async function runCell(task, model, fmt) {
  const slug = `${model.split("/")[1].replace(/\./g, "_")}__${fmt}`;
  const sandbox = join(SANDBOX_ROOT, slug);
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(sandbox, { recursive: true });

  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Spec (${fmt} format):\n\n${task[fmt].trimEnd()}\n\nImplement this and run tests until all pass.` },
  ];

  let totalCost = 0, totalPrompt = 0, totalCompletion = 0;
  let lastTestOutput = "(never ran)";
  let bestPass = null;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    let resp;
    try { resp = await call(model, messages); }
    catch (e) { return { ok: false, error: e.message, turns: turn - 1, cost: totalCost, prompt_tokens: totalPrompt, completion_tokens: totalCompletion, lastTestOutput, bestPass }; }

    totalCost += resp.usage?.cost ?? 0;
    totalPrompt += resp.usage?.prompt_tokens ?? 0;
    totalCompletion += resp.usage?.completion_tokens ?? 0;

    const msg = resp.choices?.[0]?.message;
    if (!msg) return { ok: false, error: "no message", turns: turn, cost: totalCost, prompt_tokens: totalPrompt, completion_tokens: totalCompletion, lastTestOutput, bestPass };

    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // model gave up / went to text. End cell.
      return { ok: false, reason: "no_tool_call", turns: turn, finalContent: msg.content, cost: totalCost, prompt_tokens: totalPrompt, completion_tokens: totalCompletion, lastTestOutput, bestPass };
    }

    for (const tc of msg.tool_calls) {
      const result = execTool(tc, sandbox, task.gold_tests);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });

      if (tc.function.name === "run_tests") {
        lastTestOutput = result;
        const score = extractPassCount(result);
        if (score && (!bestPass || score.passed > bestPass.passed)) bestPass = score;
        if (score && score.passed === score.total) {
          return { ok: true, turns: turn, cost: totalCost, prompt_tokens: totalPrompt, completion_tokens: totalCompletion, lastTestOutput, bestPass };
        }
      }
    }
  }

  return { ok: false, reason: "max_turns", turns: MAX_TURNS, cost: totalCost, prompt_tokens: totalPrompt, completion_tokens: totalCompletion, lastTestOutput, bestPass };
}

const taskFiles = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
const allResults = [];
for (const f of taskFiles) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  for (const model of MODELS) {
    for (const fmt of FORMATS) {
      process.stdout.write(`${task.id}/${model.split("/")[1]}/${fmt}: `);
      const r = await runCell(task, model, fmt);
      console.log(`${r.ok ? "✓" : "✗"} pass=${r.bestPass ? `${r.bestPass.passed}/${r.bestPass.total}` : "?"} turns=${r.turns} $${(r.cost ?? 0).toFixed(4)} (${r.prompt_tokens}+${r.completion_tokens})${r.reason ? ` [${r.reason}]` : ""}${r.error ? ` ERR: ${r.error}` : ""}`);
      allResults.push({ task: task.id, model, format: fmt, ...r });
      writeFileSync(join(RESULTS, `${task.id}__${model.split("/")[1].replace(/\./g, "_")}__${fmt}.json`), JSON.stringify(r, null, 2));
    }
  }
}
writeFileSync(join(RESULTS, "all.json"), JSON.stringify({ ran_at: new Date().toISOString(), results: allResults }, null, 2));

const totalCost = allResults.reduce((s, r) => s + (r.cost ?? 0), 0);
console.log(`\nTotal cost: $${totalCost.toFixed(4)}`);
