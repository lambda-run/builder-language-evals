"""Extract each agent's final job_scheduler.py from inspect logs, then send all
six (3 formats x 2 models) to Gemini 3.1 Pro for structured judging on:
  - spec_faithfulness  (does the impl match the spec, or invent?)
  - code_clarity        (readable, well-named, well-structured?)
  - idiomatic_python    (uses stdlib well, no anti-patterns?)
  - error_handling      (sane errors, no swallowed exceptions?)
  - structure           (cohesive, sensible separation, sized right?)
  - hallucinated_methods (count of methods/classes not implied by spec)
  - missing_methods      (count of spec items not implemented)

Outputs results/judge.json + a summary print to stdout.
"""

import json
import re
import sys
import os
import glob
import yaml
from pathlib import Path

from inspect_ai.log import read_eval_log
import urllib.request

ROOT = Path(__file__).parent.parent
LOGS = ROOT / "logs"
CODE_OUT = ROOT / "results" / "code"
JUDGE_OUT = ROOT / "results" / "judge.json"
CODE_OUT.mkdir(parents=True, exist_ok=True)

GEMINI_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_KEY:
    print("GEMINI_API_KEY not set", file=sys.stderr)
    sys.exit(1)

# Load the markdown version of the spec as the canonical "what was asked for"
SPEC_DATA = yaml.safe_load((ROOT / "tasks" / "t02_job_scheduler.yaml").read_text())
CANONICAL_SPEC = SPEC_DATA["markdown"]


def extract_final_code(eval_path: Path) -> tuple[str, str, str]:
    """Returns (model, format, final_code_or_empty)."""
    log = read_eval_log(str(eval_path))
    model = log.eval.model
    fmt = log.eval.task_args.get("format", "?")
    sample = log.samples[0]
    final_code = ""
    # Walk all bash tool calls, take the LAST cat > job_scheduler.py
    for m in sample.messages:
        tcs = getattr(m, "tool_calls", None) or []
        for tc in tcs:
            cmd = (tc.arguments or {}).get("command", "")
            if "cat > job_scheduler.py" in cmd or "cat>job_scheduler.py" in cmd:
                # Extract the heredoc body
                match = re.search(r"<<\s*['\"]?(\w+)['\"]?\n(.*?)\n\1\s*$", cmd, re.DOTALL | re.MULTILINE)
                if match:
                    final_code = match.group(2)
    return model, fmt, final_code


JUDGE_SYSTEM = """You are a senior Python code reviewer. You will be given:
1. A canonical SPEC describing a class to implement
2. An IMPLEMENTATION produced by an AI coding agent

Your job: score the implementation on a structured rubric. Be precise; cite line numbers when calling out specific issues. Do not be polite — call out hallucinations and quality issues directly.

Output JSON ONLY (no prose around it) with this exact schema:

{
  "spec_faithfulness": <0-10>,
  "code_clarity": <0-10>,
  "idiomatic_python": <0-10>,
  "error_handling": <0-10>,
  "structure": <0-10>,
  "hallucinated_methods": [<list of method/class names that exist in the impl but were NOT requested by the spec>],
  "missing_features": [<list of spec items NOT implemented>],
  "notable_strengths": [<short bullets>],
  "notable_issues": [<short bullets, with line numbers if relevant>]
}

Scoring:
- 10 = exemplary; nothing meaningful to improve
- 7-8 = solid; minor nits
- 5-6 = works but has real issues
- 3-4 = serious problems
- 0-2 = broken or missing"""


def call_gemini(prompt: str) -> dict:
    """Call Gemini 3.1 Pro via REST. Returns parsed JSON."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key={GEMINI_KEY}"
    body = {
        "systemInstruction": {"parts": [{"text": JUDGE_SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 16000,
            "responseMimeType": "application/json",
        },
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        result = json.loads(r.read())
    text = result["candidates"][0]["content"]["parts"][0]["text"]
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        # Print head + tail so we can see what Gemini actually returned
        print(f"    JSON parse failed: {e}", file=sys.stderr)
        print(f"    --- Gemini raw text head ({len(text)} chars total) ---", file=sys.stderr)
        print(text[:500], file=sys.stderr)
        print(f"    --- tail ---", file=sys.stderr)
        print(text[-500:], file=sys.stderr)
        # finishReason if present
        try:
            fr = result["candidates"][0].get("finishReason", "?")
            print(f"    finishReason: {fr}", file=sys.stderr)
        except Exception:
            pass
        raise


def judge_impl(model: str, fmt: str, code: str) -> dict:
    prompt = (
        f"## CANONICAL SPEC\n\n{CANONICAL_SPEC}\n\n"
        f"## IMPLEMENTATION (from model={model}, format={fmt})\n\n"
        f"```python\n{code}\n```\n\n"
        f"Score per rubric. Return JSON only."
    )
    return call_gemini(prompt)


# Step 1: extract code from logs. Sorted ascending by filename (== timestamp) so
# later runs overwrite earlier ones when (model, format) collide.
log_files = sorted(LOGS.glob("*_job-scheduler_*.eval"))
by_cell: dict[tuple[str, str], dict] = {}
for path in log_files:
    model, fmt, code = extract_final_code(path)
    if not code:
        print(f"WARN: no code extracted from {path.name}", file=sys.stderr)
        continue
    slug = f"{model.split('/')[-1].replace('.', '_')}__{fmt}"
    out_path = CODE_OUT / f"{slug}.py"
    out_path.write_text(code)
    by_cell[(model, fmt)] = {"model": model, "format": fmt, "slug": slug, "code_path": str(out_path), "code_chars": len(code), "code_lines": code.count("\n") + 1, "src_log": path.name}
cells = list(by_cell.values())
for c in cells:
    print(f"Extracted {c['slug']}: {c['code_chars']} chars, {c['code_lines']} lines (from {c['src_log']})")

print(f"\nExtracted {len(cells)} implementations. Now judging with Gemini 3.1 Pro...\n")

# Step 2: judge each
judged = []
for c in cells:
    code = Path(c["code_path"]).read_text()
    print(f"  Judging {c['slug']}...", flush=True)
    try:
        scores = judge_impl(c["model"], c["format"], code)
    except Exception as e:
        print(f"    ERROR: {e}")
        scores = {"error": str(e)}
    judged.append({**c, "scores": scores})

JUDGE_OUT.write_text(json.dumps({"ran_at": __import__("datetime").datetime.utcnow().isoformat() + "Z", "cells": judged}, indent=2, default=str))
print(f"\nWrote {JUDGE_OUT}")

# Step 3: summary
print("\n=== SUMMARY ===\n")
print(f"{'cell':<40} {'faith':>6} {'clarity':>8} {'idiom':>6} {'errs':>5} {'struct':>7} {'halluc':>7} {'missing':>8}")
for c in judged:
    s = c["scores"]
    if "error" in s:
        print(f"{c['slug']:<40} ERROR: {s['error']}")
        continue
    print(f"{c['slug']:<40} {s.get('spec_faithfulness',0):>6} {s.get('code_clarity',0):>8} {s.get('idiomatic_python',0):>6} {s.get('error_handling',0):>5} {s.get('structure',0):>7} {len(s.get('hallucinated_methods',[])):>7} {len(s.get('missing_features',[])):>8}")

# Per-format aggregation
from collections import defaultdict
agg = defaultdict(lambda: defaultdict(list))
for c in judged:
    s = c["scores"]
    if "error" in s:
        continue
    for k in ("spec_faithfulness", "code_clarity", "idiomatic_python", "error_handling", "structure"):
        agg[c["format"]][k].append(s.get(k, 0))
    agg[c["format"]]["hallucinated_count"].append(len(s.get("hallucinated_methods", [])))
    agg[c["format"]]["missing_count"].append(len(s.get("missing_features", [])))
    agg[c["format"]]["code_chars"].append(c["code_chars"])

print(f"\n=== PER-FORMAT AVERAGES (across both models) ===\n")
print(f"{'format':<10} {'faith':>6} {'clarity':>8} {'idiom':>6} {'errs':>5} {'struct':>7} {'avg_halluc':>11} {'avg_missing':>12} {'avg_chars':>10}")
for fmt in ("builder", "markdown", "prose"):
    a = agg[fmt]
    if not a:
        continue
    avg = lambda k: sum(a[k]) / len(a[k]) if a[k] else 0
    print(f"{fmt:<10} {avg('spec_faithfulness'):>6.1f} {avg('code_clarity'):>8.1f} {avg('idiomatic_python'):>6.1f} {avg('error_handling'):>5.1f} {avg('structure'):>7.1f} {avg('hallucinated_count'):>11.2f} {avg('missing_count'):>12.2f} {avg('code_chars'):>10.0f}")
