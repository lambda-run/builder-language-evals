// Generate "perfect" plans in 5 formats from each task's gold_trace.
// These plans encode the SAME logical structure but in different syntactic
// idioms. The executor will be fed them in v3.5 to test whether format
// alone affects parallel_tool_calls behaviour, with the planner removed.
//
// Output: v3.5/plans/<task_id>__<format>.txt

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "..", "v3", "tasks");
const OUT = join(ROOT, "plans");
mkdirSync(OUT, { recursive: true });

function pascalCase(id) {
  return id.replace(/^t\d+_/, "").split("_").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
}

function renderBuilder(task) {
  const noun = pascalCase(task.id);
  const lines = [noun];
  for (const step of task.gold_trace) {
    if (step.parallel && step.calls.length > 1) {
      lines.push("  .parallelize(");
      lines.push(step.calls.map((c) => `    ${c.tool}(...)`).join(",\n"));
      lines.push("  )");
    } else {
      for (const c of step.calls) lines.push(`  .${c.tool}(...)`);
    }
  }
  return "```builder\n" + lines.join("\n") + "\n```";
}

function renderMarkdownChecklist(task) {
  const lines = ["# Plan", ""];
  task.gold_trace.forEach((step, i) => {
    const para = step.parallel && step.calls.length > 1 ? " (parallel)" : "";
    lines.push(`## Step ${i + 1}${para}`);
    for (const c of step.calls) lines.push(`- Call \`${c.tool}\` with appropriate args`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

function renderMarkdownExplicit(task) {
  const lines = [];
  task.gold_trace.forEach((step, i) => {
    const prefix = i === 0 ? "" : "THEN: ";
    if (step.parallel && step.calls.length > 1) {
      lines.push(`${prefix}RUN IN PARALLEL:`);
      for (const c of step.calls) lines.push(`  - ${c.tool}`);
    } else {
      for (const c of step.calls) lines.push(`${prefix}${c.tool}`);
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

function renderJson(task) {
  const steps = task.gold_trace.map((step) => ({
    parallel: step.parallel && step.calls.length > 1,
    calls: step.calls.map((c) => ({ tool: c.tool, args: "<infer from goal>" })),
  }));
  return "```json\n" + JSON.stringify({ steps }, null, 2) + "\n```";
}

function renderTerse(task) {
  const lines = [];
  for (const step of task.gold_trace) {
    if (step.parallel && step.calls.length > 1) {
      lines.push(`parallel { ${step.calls.map((c) => c.tool + "(...)").join("; ")} }`);
    } else {
      for (const c of step.calls) lines.push(`${c.tool}(...)`);
    }
  }
  return lines.join(";\n") + ";";
}

const renderers = {
  builder: renderBuilder,
  markdown_checklist: renderMarkdownChecklist,
  markdown_explicit: renderMarkdownExplicit,
  json: renderJson,
  terse: renderTerse,
};

const files = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
for (const f of files) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  for (const [fmt, render] of Object.entries(renderers)) {
    const out = render(task);
    writeFileSync(join(OUT, `${task.id}__${fmt}.txt`), out + "\n");
  }
}
console.log(`Generated ${files.length * Object.keys(renderers).length} plans → ${OUT}`);
