// Sub-chains must use a named SubNoun (capital letter) inside parens, not
// a leading dot. The skill explicitly forbids `(.verb()...)` because LLMs
// "correct" it back to executable code.
//
// Detects the anti-pattern `( .verb` or `(.verb` (with optional whitespace)
// and fails. Only applied when chain is expected.

const LEADING_DOT_SUBCHAIN = /\(\s*\.[a-zA-Z_]/;

module.exports = (output, context) => {
  const text = typeof output === "string" ? output : String(output ?? "");

  const expected = (context.test?.metadata?.expect_chain
                 ?? context.vars?.expect_chain
                 ?? "yes").toString().toLowerCase();
  if (expected !== "yes") {
    return { pass: true, score: 1, reason: "Skipped (prose case)." };
  }

  if (LEADING_DOT_SUBCHAIN.test(text)) {
    const m = text.match(LEADING_DOT_SUBCHAIN);
    return {
      pass: false,
      score: 0,
      reason: `Leading-dot sub-chain detected near: "${m[0]}". Sub-chains must use a named SubNoun like (Rule .x().y()).`,
    };
  }

  return { pass: true, score: 1, reason: "Sub-chains use named SubNouns." };
};
