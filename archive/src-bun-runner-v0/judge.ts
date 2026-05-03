// LLM judge — uses Gemini 3.1 Pro to score outputs against a rubric.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { callGemini } from "./providers.ts";

export interface JudgeScore {
  score: number;          // 1..5 (or NaN on parse failure)
  rationale: string;
  cost_usd: number;
  raw: string;
}

const RUBRIC_DIR = join(import.meta.dir, "..", "rubrics");

export async function judge(opts: {
  rubric: "adoption" | "completeness" | "why_comments";
  prompt: string;         // the original prompt the SUT was given
  output: string;         // the SUT's response
}): Promise<JudgeScore> {
  const rubricMd = readFileSync(join(RUBRIC_DIR, `${opts.rubric}.md`), "utf8");

  const judgePrompt = [
    rubricMd,
    "---",
    "ORIGINAL PROMPT:",
    opts.prompt,
    "---",
    "MODEL OUTPUT TO JUDGE:",
    opts.output,
    "---",
    "Output JSON only.",
  ].join("\n\n");

  const r = await callGemini({
    model: "gemini-3.1-pro-preview",
    user: judgePrompt,
    max_tokens: 800,
  });

  // Parse the JSON. Tolerant of code fences and surrounding prose —
  // pull the first {...} block and parse that.
  let score = NaN;
  let rationale = "";
  const stripped = r.text.replace(/```json|```/g, "");
  const objMatch = stripped.match(/\{[^{}]*"score"[^{}]*\}/s);
  if (objMatch) {
    try {
      const obj = JSON.parse(objMatch[0]);
      score = Number(obj.score);
      rationale = String(obj.rationale ?? "");
    } catch {
      const m = objMatch[0].match(/"score"\s*:\s*([1-5])/);
      if (m) score = Number(m[1]);
      const ratM = objMatch[0].match(/"rationale"\s*:\s*"([^"]*)"/);
      rationale = ratM ? ratM[1] : objMatch[0].slice(0, 200);
    }
  } else {
    const m = stripped.match(/"score"\s*:\s*([1-5])/);
    if (m) score = Number(m[1]);
    rationale = stripped.slice(0, 200);
  }

  return { score, rationale, cost_usd: r.cost_usd, raw: r.text };
}
