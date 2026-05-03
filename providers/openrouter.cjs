// Custom promptfoo provider for OpenRouter.
//
// Reads a chat-format prompt (JSON array of {role, content}) and forwards
// it to OpenRouter's chat completions endpoint. Returns the model's text
// output along with the cost OpenRouter reports natively.
//
// Provider config (in promptfooconfig.yaml):
//   id: file://providers/openrouter.cjs
//   label: opus-with-skill
//   config:
//     model: anthropic/claude-opus-4.7
//     system_file: prompts/with-skill-system.txt   # optional
//     system_template_var: SKILL_BODY              # optional (substituted from skill/SKILL.md body)
//     max_tokens: 2500
//     temperature: 0.3

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const OR_KEY = process.env.OPENROUTER_API_KEY;
if (!OR_KEY) {
  throw new Error("OPENROUTER_API_KEY not set in environment.");
}

const ROOT = join(__dirname, "..");

let cachedSkillBody = null;
function skillBody() {
  if (cachedSkillBody !== null) return cachedSkillBody;
  const md = readFileSync(join(ROOT, "skill", "SKILL.md"), "utf8");
  cachedSkillBody = md.replace(/^---[\s\S]*?---\s*/m, "").trim();
  return cachedSkillBody;
}

function resolveSystem(config) {
  if (!config.system_file) return undefined;
  let text = readFileSync(join(ROOT, config.system_file), "utf8");
  if (config.system_template_var) {
    const repl = config.system_template_var === "SKILL_BODY"
      ? skillBody() : "";
    text = text.replace(`{{${config.system_template_var}}}`, repl);
  }
  return text.trim();
}

class OpenRouterProvider {
  constructor(options) {
    // promptfoo's file:// loader passes either an envelope { id, label, config }
    // or the bare config block. Handle both shapes.
    const cfg = options.config || options;
    this.config = cfg;
    this.label =
      options.label
      || cfg.label
      || `openrouter:${cfg.model}`;
  }

  id() {
    return this.label;
  }

  async callApi(prompt, context) {
    const messages = [];
    const system = resolveSystem(this.config);
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: String(prompt) });

    const body = {
      model: this.config.model,
      messages,
      max_tokens: this.config.max_tokens ?? 2500,
      temperature: this.config.temperature ?? 0.3,
    };

    let res;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OR_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/lambda-run/builder-language-evals",
          "X-Title": "builder-language-evals",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { error: `Network error calling OpenRouter: ${e.message}` };
    }

    if (!res.ok) {
      const txt = await res.text();
      return { error: `OR ${this.config.model} ${res.status}: ${txt.slice(0, 300)}` };
    }
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? "";
    const usage = json.usage ?? {};

    return {
      output: text,
      tokenUsage: {
        prompt: usage.prompt_tokens ?? 0,
        completion: usage.completion_tokens ?? 0,
        total: usage.total_tokens ?? 0,
      },
      cost: usage.cost ?? 0,
      metadata: {
        provider: json.provider,
        model: json.model,
      },
    };
  }
}

module.exports = OpenRouterProvider;
