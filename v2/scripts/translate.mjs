// Translate each task's gold_builder spec into english_plain and english_markdown
// versions using Gemini 3.1 Pro. Cached to v2/translations/<task_id>.json so we
// don't re-translate on each run.
//
// Critical: the translator's job is to PRESERVE ALL INFORMATION from the builder
// spec while changing the format. The English versions must contain every rule
// the builder version contains — no nuance dropped.
//
// Usage: bun run v2/scripts/translate.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = join(import.meta.dir, "..");
const TASKS = join(ROOT, "tasks");
const OUT = join(ROOT, "translations");
mkdirSync(OUT, { recursive: true });

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("GEMINI_API_KEY not set"); process.exit(1); }

const PLAIN_SYSTEM = `You convert technical specifications written in a fluent builder syntax into plain natural English.

Your output must:
- Preserve EVERY rule, threshold, and condition from the input. No nuance dropped.
- Read like an engineer writing in a Slack message — natural, complete, no headers or bullets.
- Be ONE flowing prose block. No code blocks, no fences, no lists.
- Use present-tense ("the function takes...", "if the user is admin then...").
- NOT mention "builder syntax" or "this is converted from" — just write the spec as if it was always English.

Output ONLY the prose. No preamble, no commentary.`;

const MARKDOWN_SYSTEM = `You convert technical specifications written in a fluent builder syntax into structured Markdown.

Your output must:
- Preserve EVERY rule, threshold, and condition from the input. No nuance dropped.
- Use Markdown headers (##), bullet lists, and inline code spans for symbol/value names.
- Be a structured document a human can scan with section labels.
- NOT use builder-pattern syntax. NOT use code blocks containing the original spec.
- NOT mention "builder syntax" or "this is converted from" — just write the spec as if it was always Markdown.

Output ONLY the Markdown. No preamble, no commentary.`;

async function translate(systemPrompt, builderSpec, signature) {
  const userMsg = `Function the spec describes:

\`\`\`python
${signature}
\`\`\`

Spec to convert:

\`\`\`
${builderSpec}
\`\`\``;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  }
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("No text in Gemini response: " + JSON.stringify(j).slice(0, 400));
  return text.trim();
}

const files = readdirSync(TASKS).filter((f) => f.endsWith(".yaml")).sort();
console.log(`Translating ${files.length} tasks...`);

for (const f of files) {
  const task = parseYaml(readFileSync(join(TASKS, f), "utf8"));
  const cacheFile = join(OUT, `${task.id}.json`);

  if (existsSync(cacheFile)) {
    console.log(`  ${task.id}: cached, skipping`);
    continue;
  }

  console.log(`  ${task.id}: translating...`);
  const plain = await translate(PLAIN_SYSTEM, task.gold_builder, task.function_signature);
  const markdown = await translate(MARKDOWN_SYSTEM, task.gold_builder, task.function_signature);

  writeFileSync(cacheFile, JSON.stringify({
    task_id: task.id,
    plain,
    markdown,
    generated_at: new Date().toISOString(),
  }, null, 2));

  console.log(`    plain: ${plain.length} chars, markdown: ${markdown.length} chars`);
}
console.log("Done.");
