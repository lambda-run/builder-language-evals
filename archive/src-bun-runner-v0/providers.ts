// Thin wrappers around OpenRouter (for SUT) and Google Gemini (for judge).

const OR_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!OR_KEY) throw new Error("OPENROUTER_API_KEY not set");
if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not set");

export interface CallResult {
  text: string;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  model: string;
  provider?: string;
  raw: any;
}

export async function callOpenRouter(opts: {
  model: string;
  system?: string;
  user: string;
  max_tokens?: number;
  temperature?: number;
}): Promise<CallResult> {
  const messages: any[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const body = {
    model: opts.model,
    messages,
    max_tokens: opts.max_tokens ?? 2000,
    temperature: opts.temperature ?? 0.3,
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OR_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/lambda-run/builder-language-evals",
      "X-Title": "builder-language-evals",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OR ${opts.model} ${res.status}: ${txt.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const choice = json.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    cost_usd: json.usage?.cost ?? 0,
    prompt_tokens: json.usage?.prompt_tokens ?? 0,
    completion_tokens: json.usage?.completion_tokens ?? 0,
    model: json.model ?? opts.model,
    provider: json.provider,
    raw: json,
  };
}

// Native Gemini (avoids OR's 5% markup on judge calls).
export async function callGemini(opts: {
  model: string;          // e.g. "gemini-3.1-pro-preview"
  system?: string;
  user: string;
  max_tokens?: number;
}): Promise<CallResult> {
  // Gemini API uses model name without "google/" prefix.
  const modelName = opts.model.replace(/^google\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_KEY}`;

  const body: any = {
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: {
      maxOutputTokens: opts.max_tokens ?? 1000,
      temperature: 0.1,
    },
  };
  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${modelName} ${res.status}: ${txt.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  // Gemini cost: rough estimate based on Gemini 2.5 Pro pricing — $1.25/M in, $10/M out
  // for prompts <= 200K tokens. Treat as approximate.
  const inTok = json.usageMetadata?.promptTokenCount ?? 0;
  const outTok = json.usageMetadata?.candidatesTokenCount ?? 0;
  const cost = (inTok * 1.25 + outTok * 10) / 1_000_000;
  return {
    text,
    cost_usd: cost,
    prompt_tokens: inTok,
    completion_tokens: outTok,
    model: modelName,
    raw: json,
  };
}
