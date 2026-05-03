// Detects whether the model's output contains a builder-chain shape.
// A "chain" here means a noun on one line followed by one or more
// indented `.verb(...)` continuation lines.
//
// Used in two opposite ways:
//   - on `should_use` / `adversarial` cases, expect pass=true
//   - on `should_skip` cases, expect pass=false (output should be prose)
//
// `expected` from the test case (`assert.expected`) tells us which way:
//   "yes" → chain expected (pass when chain is present)
//   "no"  → chain NOT expected (pass when chain is absent)

// Detect a continuation line: indented `.verb(`. Allow camelCase as well as
// snake_case in the verb name — vocab-discipline.cjs separately counts
// non-standard verbs as invented.
const CHAIN_LINE = /^\s+\.[a-zA-Z_][a-zA-Z0-9_]*\s*\(/m;

module.exports = (output, context) => {
  const text = typeof output === "string" ? output : String(output ?? "");
  const hasChain = CHAIN_LINE.test(text);
  const expected = (context.test?.metadata?.expect_chain
                 ?? context.vars?.expect_chain
                 ?? "yes").toString().toLowerCase();

  if (expected === "yes") {
    return {
      pass: hasChain,
      score: hasChain ? 1 : 0,
      reason: hasChain
        ? "Output contains a builder-chain."
        : "Expected a builder-chain; output is prose only.",
    };
  }

  return {
    pass: !hasChain,
    score: !hasChain ? 1 : 0,
    reason: !hasChain
      ? "Output is prose, as expected for this prompt."
      : "Output uses chain syntax on a prompt where the skill says it should not fire.",
  };
};
