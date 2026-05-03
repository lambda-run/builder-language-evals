// Deterministic syntactic checks on a model's output.
// No LLM calls, no judgement — just regex/grep against the builder-language
// invariants documented in the SKILL.md.

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

export interface AssertResult {
  has_chain: boolean;
  no_arrows: boolean;            // no `->` lambda syntax anywhere
  named_subnouns: boolean;       // sub-chains use (Capital ...) not (.x.y)
  no_leading_dot_subchain: boolean; // explicit anti-pattern check
  vocab_ratio: number;           // standard_verbs / total_verbs (0..1)
  total_verbs: number;
  standard_verbs: number;
  invented_verbs: string[];
}

const CHAIN_PATTERN = /^\s*\.[a-z_][a-z0-9_]*\s*\(/m; // a leading-dot verb call

export function assertOutput(text: string): AssertResult {
  // 1. Does the output contain a builder chain at all?
  const has_chain = CHAIN_PATTERN.test(text);

  // 2. No `->` arrows (the lambda trap the skill explicitly forbids).
  // Allow markdown arrows in prose like " — " or "→" only inside non-code
  // sentences; `->` ASCII is the LLM-trigger we want to ban.
  const no_arrows = !/->/.test(text);

  // 3. Sub-chains must use (Capital .verb()...) not (.verb()...).
  // Look for sub-chain openings: `(` followed by either uppercase Noun + dot
  // (good) or directly `.verb` (bad).
  const leading_dot_subchain = /\(\s*\.[a-z_]/.test(text);
  const no_leading_dot_subchain = !leading_dot_subchain;
  const named_subnouns_ok = no_leading_dot_subchain;

  // 4. Vocab discipline — extract every `.verb(` token, count how many are
  // in the standard vocabulary.
  const verbMatches = [...text.matchAll(/\.([a-z_][a-z0-9_]*)\s*\(/g)];
  const all = verbMatches.map(m => m[1]);
  const std = all.filter(v => STANDARD_VERBS.has(v));
  const invented = [...new Set(all.filter(v => !STANDARD_VERBS.has(v)))];
  const vocab_ratio = all.length === 0 ? 0 : std.length / all.length;

  return {
    has_chain,
    no_arrows,
    named_subnouns: named_subnouns_ok,
    no_leading_dot_subchain,
    vocab_ratio,
    total_verbs: all.length,
    standard_verbs: std.length,
    invented_verbs: invented,
  };
}
