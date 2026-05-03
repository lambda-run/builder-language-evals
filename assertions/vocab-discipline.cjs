// Measures the ratio of standard vocabulary verbs to total verbs.
//
// Standard verbs are listed in skill/SKILL.md. Threshold (0..1) is read
// from `assert.config.threshold` (defaults to 0.5).
//
// Returns score = ratio (0..1) so promptfoo treats it as a graded assertion.
// pass = ratio >= threshold.

const STANDARD_VERBS = new Set([
  // control flow
  "sequence", "parallelize", "route", "wait_for", "fallback",
  // data flow
  "transform", "filter", "store", "fetch",
  // coordination
  "subagent", "human_in_loop",
  // LLM-typical
  "summarize", "review", "notify",
  // lifecycle
  "schedule", "run",
]);

// Match any `.verb(` token; standard verbs are snake_case (so a camelCase
// verb will fall outside the standard set and count as invented).
const VERB_CALL = /\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

module.exports = (output, context) => {
  const text = typeof output === "string" ? output : String(output ?? "");

  const expected = (context.test?.metadata?.expect_chain
                 ?? context.vars?.expect_chain
                 ?? "yes").toString().toLowerCase();
  if (expected !== "yes") {
    return { pass: true, score: 1, reason: "Skipped (prose case)." };
  }

  const threshold = Number(context.config?.threshold ?? 0.5);

  const matches = [...text.matchAll(VERB_CALL)].map((m) => m[1]);
  if (matches.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: "No verb calls found — chain expected but no `.verb(` tokens.",
    };
  }

  const std = matches.filter((v) => STANDARD_VERBS.has(v));
  const ratio = std.length / matches.length;
  const invented = [...new Set(matches.filter((v) => !STANDARD_VERBS.has(v)))];

  // Measurement-only assertion: pass=true always, score = ratio.
  // The threshold appears in `reason` for context but does not gate.
  return {
    pass: true,
    score: ratio,
    reason: `Vocab discipline ${(ratio * 100).toFixed(0)}% (${std.length}/${matches.length} standard, threshold ${(threshold * 100).toFixed(0)}%). Invented: [${invented.slice(0, 5).join(", ")}${invented.length > 5 ? ", ..." : ""}]`,
  };
};
