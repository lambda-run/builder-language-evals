"""v7: Inspect AI task. Agent receives spec in builder | markdown | prose,
implements a RateLimiter class, runs gold tests, iterates until pass.

Run:
    .venv/bin/inspect eval scripts/eval.py@rate_limiter \
        --model openrouter/anthropic/claude-sonnet-4.6 \
        -T format=builder
"""

from pathlib import Path
import yaml

from inspect_ai import task, Task
from inspect_ai.dataset import Sample
from inspect_ai.solver import basic_agent, system_message
from inspect_ai.tool import bash, python
from inspect_ai.scorer import scorer, Score, mean

TASKS_DIR = Path(__file__).parent.parent / "tasks"


def load_task(task_id: str):
    return yaml.safe_load((TASKS_DIR / f"{task_id}.yaml").read_text())


TASK_DATA = load_task("t01_rate_limiter")  # default for rate_limiter()
SCHEDULER_DATA = load_task("t02_job_scheduler")
SCHEDULER_FAIR_DATA = load_task("t02_job_scheduler_fair")

SYSTEM = """You are a Python developer. Implement the class described in the spec, then run tests until they all pass.

Workflow:
1. Use `bash` to write `rate_limiter.py` with your implementation (use `cat > rate_limiter.py << 'EOF' ... EOF`)
2. Use `bash` to write `tests.py` with EXACTLY this content (do not modify):
```
{gold_tests}
```
3. Use `bash` to run: `python3 tests.py`
4. Read the PASS_COUNT line. If not 10/10, fix bugs and re-run.
5. When all tests pass, call submit() with the final PASS_COUNT value.

Rules:
- Class must be named exactly `RateLimiter`
- Use Python stdlib only (time module is fine)
- File must be named exactly `rate_limiter.py`
- You have at most 15 turns
"""


def make_pass_rate_scorer(gold_tests: str):
    @scorer(metrics=[mean()])
    def pass_rate():
        async def score(state, target):
            from inspect_ai.util import sandbox as get_sandbox
            sb = get_sandbox()
            await sb.write_file("tests.py", gold_tests)
            result = await sb.exec(["python3", "tests.py"], timeout=60)
            out = (result.stdout or "") + "\n" + (result.stderr or "")
            import re
            m = re.search(r"PASS_COUNT=(\d+)/(\d+)", out)
            if not m:
                return Score(value=0.0, answer="no PASS_COUNT in output", explanation=out[-2000:])
            passed, total = int(m.group(1)), int(m.group(2))
            return Score(
                value=passed / total,
                answer=f"{passed}/{total}",
                explanation=out[-3000:],
                metadata={"passed": passed, "total": total},
            )
        return score
    return pass_rate


def _build_task(data: dict, format: str, class_name: str, file_name: str, max_messages: int = 20):
    if format not in ("builder", "markdown", "prose"):
        raise ValueError(f"format must be builder | markdown | prose, got {format}")
    spec = data[format].rstrip()
    gold_tests = data["gold_tests"]
    sys_prompt = SYSTEM.format(gold_tests=gold_tests).replace("RateLimiter", class_name).replace("rate_limiter.py", file_name).replace("at most 15 turns", f"at most {max_messages} turns")
    return Task(
        dataset=[
            Sample(
                input=f"Spec ({format} format):\n\n{spec}\n\nImplement this and iterate until all tests pass.",
                target="all_tests_pass",
                metadata={"format": format, "task_id": data["id"]},
            )
        ],
        solver=basic_agent(
            init=system_message(sys_prompt),
            tools=[bash(timeout=60), python(timeout=60)],
            max_attempts=1,
            message_limit=max_messages,
        ),
        scorer=make_pass_rate_scorer(gold_tests)(),
        sandbox="local",
    )


@task
def rate_limiter(format: str = "builder"):
    return _build_task(TASK_DATA, format, "RateLimiter", "rate_limiter.py", max_messages=20)


@task
def job_scheduler(format: str = "builder"):
    return _build_task(SCHEDULER_DATA, format, "JobScheduler", "job_scheduler.py", max_messages=40)


@task
def job_scheduler_fair(format: str = "builder"):
    """Fair-comparison variant: every format is hand-tightened to its minimum
    expressive form, with all formats conveying the same information content."""
    return _build_task(SCHEDULER_FAIR_DATA, format, "JobScheduler", "job_scheduler.py", max_messages=40)
