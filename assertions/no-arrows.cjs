// The skill explicitly forbids `->` lambda arrows. They push LLMs into
// emitting executable logic instead of structural specs.
//
// This assertion fails any output containing the literal substring `->`
// anywhere — both inside chains and in surrounding prose.
//
// Only applied to cases where the skill is meant to fire (chain expected).

module.exports = (output, context) => {
  const text = typeof output === "string" ? output : String(output ?? "");

  // Skip the check on prose-expected cases — there's nothing to enforce.
  const expected = (context.test?.metadata?.expect_chain
                 ?? context.vars?.expect_chain
                 ?? "yes").toString().toLowerCase();
  if (expected !== "yes") {
    return { pass: true, score: 1, reason: "Skipped (prose case)." };
  }

  if (text.includes("->")) {
    const idx = text.indexOf("->");
    const snippet = text.slice(Math.max(0, idx - 30), idx + 30);
    return {
      pass: false,
      score: 0,
      reason: 'Lambda arrow `->` present near: "...' + snippet + '..."',
    };
  }

  return { pass: true, score: 1, reason: "No `->` arrows in output." };
};
