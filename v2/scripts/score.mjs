// Score each (task, condition) result by extracting the Python function from
// the model's response, running it against the task's hidden test cases via
// python3 subprocess, and recording pass/fail per case.
//
// Output: v2/results/scores.json — full per-cell test results.
//
// Usage: bun run v2/scripts/score.mjs

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const RESULTS = join(ROOT, "results");

function extractCode(response) {
  // Look for ```python ... ``` first, then any ``` block.
  let m = response.match(/```python\s*\n([\s\S]*?)```/);
  if (m) return m[1];
  m = response.match(/```[a-zA-Z0-9_]*\s*\n([\s\S]*?)```/);
  if (m) return m[1];
  // No fences — assume whole thing is code if it has `def`
  if (/^\s*def\s+\w+\s*\(/m.test(response)) return response;
  return null;
}

function runPython(code, signature, testCases) {
  // Extract function name AND parameter names from signature
  const fnMatch = signature.match(/def\s+(\w+)\s*\(([^)]*)\)/);
  if (!fnMatch) throw new Error("No def in signature: " + signature);
  const fnName = fnMatch[1];
  const paramNames = fnMatch[2]
    .split(",")
    .map((p) => p.trim().split(":")[0].trim().replace(/\s*=.*$/, ""))
    .filter((p) => p && p !== "self");

  const paramNamesJson = JSON.stringify(paramNames);

  const harness = `
import sys, json, inspect

${code}

results = []
test_cases = json.loads(sys.argv[1])
param_names = ${paramNamesJson}

for tc in test_cases:
    try:
        inp = tc["input"]
        # Smart arg dispatch:
        # - If input is a dict whose keys match the function's param names, **inp.
        # - Else if function takes one param and input is a dict, pass as single positional.
        # - Else if input is a list, *inp.
        if isinstance(inp, dict):
            input_keys = set(inp.keys())
            param_set = set(param_names)
            if input_keys == param_set:
                actual = ${fnName}(**inp)
            elif len(param_names) == 1:
                actual = ${fnName}(inp)
            else:
                # Try positional in declared order
                actual = ${fnName}(*[inp.get(p) for p in param_names])
        elif isinstance(inp, list):
            actual = ${fnName}(*inp)
        else:
            actual = ${fnName}(inp)
        passed = actual == tc["expected"]
        results.append({
            "name": tc["name"],
            "passed": passed,
            "actual": actual if isinstance(actual, (str, int, float, bool, list, dict, type(None))) else str(actual),
            "expected": tc["expected"],
        })
    except Exception as e:
        results.append({
            "name": tc["name"],
            "passed": False,
            "error": f"{type(e).__name__}: {e}",
            "expected": tc["expected"],
        })

print(json.dumps(results))
`;

  const tmp = mkdtempSync(join(tmpdir(), "v2-score-"));
  const file = join(tmp, "harness.py");
  writeFileSync(file, harness);

  const r = spawnSync("python3", [file, JSON.stringify(testCases)], {
    timeout: 10_000,
    encoding: "utf8",
  });

  if (r.error) {
    return { error: `spawn: ${r.error.message}`, results: [] };
  }
  if (r.status !== 0) {
    return { error: `python exit ${r.status}: ${r.stderr.slice(0, 500)}`, results: [] };
  }
  try {
    return { results: JSON.parse(r.stdout.trim()) };
  } catch (e) {
    return { error: `parse: ${e.message}; raw stdout: ${r.stdout.slice(0, 300)}`, results: [] };
  }
}

const taskFiles = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
const scoreOut = { ran_at: new Date().toISOString(), cells: [] };
const conditions = ["builder", "markdown", "plain"];

console.log(`Scoring ${taskFiles.length * 3} cells...\n`);

for (const f of taskFiles) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  console.log(`${task.id}:`);
  for (const cond of conditions) {
    const resFile = join(RESULTS, `${task.id}__${cond}.json`);
    if (!existsSync(resFile)) {
      console.log(`  ${cond}: no result file, skipping`);
      continue;
    }
    const res = JSON.parse(readFileSync(resFile, "utf8"));
    const code = extractCode(res.response);
    if (!code) {
      console.log(`  ${cond}: ✗ no code extracted`);
      scoreOut.cells.push({
        task_id: task.id, condition: cond,
        extracted: false, error: "no code in response",
        passed: 0, total: task.test_cases.length,
      });
      continue;
    }

    const { results, error } = runPython(code, task.function_signature, task.test_cases);
    if (error) {
      console.log(`  ${cond}: ✗ runtime error: ${error.slice(0, 100)}`);
      scoreOut.cells.push({
        task_id: task.id, condition: cond,
        extracted: true, error,
        passed: 0, total: task.test_cases.length,
      });
      continue;
    }
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    console.log(`  ${cond}: ${passed}/${total} (${Math.round(passed / total * 100)}%)`);
    scoreOut.cells.push({
      task_id: task.id, condition: cond,
      extracted: true,
      passed, total,
      cases: results,
    });
  }
}

const outFile = join(RESULTS, "scores.json");
writeFileSync(outFile, JSON.stringify(scoreOut, null, 2));
console.log(`\nWrote ${outFile}`);
