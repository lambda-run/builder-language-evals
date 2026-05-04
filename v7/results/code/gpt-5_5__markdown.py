from dataclasses import dataclass
from typing import Callable, List, Dict, Set
import time


class CycleError(Exception):
    """Raised when submitted jobs contain a dependency cycle."""
    pass


@dataclass
class Job:
    id: str
    priority: int
    deps: List[str]
    func: Callable[[], None]


class JobScheduler:
    def __init__(self):
        self._jobs: Dict[str, Job] = {}
        self._status: Dict[str, str] = {}

    def submit(self, job: Job) -> None:
        # Deduplicate silently by id.
        if job.id in self._jobs:
            return
        self._jobs[job.id] = job
        self._status[job.id] = "pending"

    def status(self, job_id: str) -> str:
        return self._status.get(job_id, "pending")

    def run(self) -> None:
        if not self._jobs:
            return

        self._check_cycles()

        # Continue level by level. At each pass, take the set of jobs that are
        # ready at the start of the pass and run them by descending priority.
        while True:
            self._propagate_blocks()

            pending = [jid for jid, st in self._status.items() if st == "pending"]
            if not pending:
                return

            ready = [
                jid for jid in pending
                if all(self._status.get(dep) == "succeeded" for dep in self._jobs[jid].deps)
            ]

            if not ready:
                # No cycle remains (already checked). The remaining jobs are
                # waiting on missing or blocked/failed deps, so mark them blocked.
                for jid in pending:
                    self._status[jid] = "blocked"
                return

            ready.sort(key=lambda jid: (-self._jobs[jid].priority, jid))
            for jid in ready:
                # It may have become blocked because an earlier ready job failed.
                if self._status.get(jid) != "pending":
                    continue
                # Re-check dependencies in case one changed during this batch.
                if any(self._status.get(dep) != "succeeded" for dep in self._jobs[jid].deps):
                    continue
                self._run_one(jid)
                if self._status[jid] == "failed":
                    self._mark_descendants_blocked(jid)

    def _run_one(self, jid: str) -> None:
        job = self._jobs[jid]
        delays = [0.0, 0.1, 0.4]
        for attempt, delay in enumerate(delays, start=1):
            if delay:
                time.sleep(delay)
            self._status[jid] = "running" if attempt == 1 else "retrying"
            try:
                job.func()
            except Exception:
                if attempt == len(delays):
                    self._status[jid] = "failed"
                    return
                self._status[jid] = "retrying"
            else:
                self._status[jid] = "succeeded"
                return

    def _check_cycles(self) -> None:
        visiting: Set[str] = set()
        visited: Set[str] = set()

        def dfs(jid: str) -> None:
            if jid in visited:
                return
            if jid in visiting:
                raise CycleError()
            visiting.add(jid)
            for dep in self._jobs[jid].deps:
                if dep in self._jobs:  # Ignore dependencies that were not submitted.
                    dfs(dep)
            visiting.remove(jid)
            visited.add(jid)

        for jid in list(self._jobs):
            dfs(jid)

    def _dependents_of(self, jid: str):
        for other_id, job in self._jobs.items():
            if jid in job.deps:
                yield other_id

    def _mark_descendants_blocked(self, jid: str) -> None:
        stack = list(self._dependents_of(jid))
        seen: Set[str] = set()
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            if self._status.get(cur) not in ("succeeded", "failed"):
                self._status[cur] = "blocked"
            stack.extend(self._dependents_of(cur))

    def _propagate_blocks(self) -> None:
        # If any pending job depends (directly) on a failed/blocked job, block it;
        # repeat to make the block transitive.
        changed = True
        while changed:
            changed = False
            for jid, job in self._jobs.items():
                if self._status.get(jid) == "pending":
                    if any(self._status.get(dep) in ("failed", "blocked") for dep in job.deps):
                        self._status[jid] = "blocked"
                        changed = True