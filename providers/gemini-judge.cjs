// Custom promptfoo grader provider for Google Gemini, with structured output.
//
// Promptfoo's `llm-rubric` assertion calls a provider with a rendered grading
// prompt and expects back something parseable. By forcing Gemini's
// responseSchema, we guarantee a `{ pass, score, reason }` JSON object —
// no regex, no fallback parsing.
//
// Used as the `defaultTest.options.provider` in promptfooconfig.yaml.

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) {
  throw new Error("GEMINI_API_KEY not set in environment.");
}

class GeminiJudgeProvider {
  constructor(options) {
    const cfg = options.config || options;
    this.config = cfg;
    this.label =
      options.label
      || cfg.label
      || `gemini-judge:${cfg.model || "gemini-3.1-pro-preview"}`;
  }

  id() {
    return this.label;
  }

  async callApi(prompt, _context) {
    const model = this.config.model || "gemini-3.1-pro-preview";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

    const body = {
      contents: [{ role: "user", parts: [{ text: String(prompt) }] }],
      generationConfig: {
        maxOutputTokens: this.config.max_tokens ?? 800,
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            pass: { type: "BOOLEAN" },
            score: { type: "NUMBER" },
            reason: { type: "STRING" },
          },
          required: ["pass", "score", "reason"],
        },
      },
    };

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { error: `Gemini network error: ${e.message}` };
    }

    if (!res.ok) {
      const txt = await res.text();
      return { error: `Gemini ${model} ${res.status}: ${txt.slice(0, 300)}` };
    }
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";

    // Per Gemini's structured output, `text` is guaranteed to be valid JSON
    // matching the schema above. Parse with JSON.parse — no regex needed.
    return {
      output: text,
      tokenUsage: {
        prompt: json.usageMetadata?.promptTokenCount ?? 0,
        completion: json.usageMetadata?.candidatesTokenCount ?? 0,
        total: json.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }
}

module.exports = GeminiJudgeProvider;
