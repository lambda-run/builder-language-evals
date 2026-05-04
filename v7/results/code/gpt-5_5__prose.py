from dataclasses import dataclass
from typing import Callable, List, Dict, Set
import time


class CycleError(Exception):
    """Raised when submitted jobs contain a dependency cycle."""
    pass


@dataclass(frozen=True)
class Job:
    id: str
    priority: int
    deps: List[str]
    func: Callable[[], None]


class JobScheduler:
    PENDING = "pending"
    RUNNING = "running"
    RETRYING = "retrying"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    BLOCKED = "blocked"

    def __init__(self):
        self._jobs: Dict[str, Job] = {}
        self._statuses: Dict[str, str] = {}

    def submit(self, job: Job):
        """Submit a job. Duplicate ids are ignored silently."""
        if job.id in self._jobs:
            return
        self._jobs[job.id] = job
        self._statuses[job.id] = self.PENDING

    def status(self, job_id: str) -> str:
        return self._statuses.get(job_id, self.PENDING)

    def run(self):
        if not self._jobs:
            return

        self._detect_cycles()
        dependents = self._build_dependents()

        # If run() is called again, do not re-run terminal jobs. Jobs already
        # blocked/failed/succeeded remain terminal; pending jobs may still run.
        self._propagate_blocks(dependents)

        while True:
            ready = [
                job for job in self._jobs.values()
                if self._statuses[job.id] == self.PENDING
                and all(self._statuses.get(dep) == self.SUCCEEDED for dep in job.deps)
            ]
            if not ready:
                break

            # Run all jobs currently ready as one dependency level. Children made
            # ready by this level are considered in the next loop iteration.
            ready.sort(key=lambda j: (-j.priority, j.id))
            for job in ready:
                # A previous failure in the same level cannot affect another
                # ready job (all its deps were already succeeded), but keep this
                # guard for safety.
                if self._statuses[job.id] != self.PENDING:
                    continue
                self._run_one(job)
                if self._statuses[job.id] == self.FAILED:
                    self._mark_descendants_blocked(job.id, dependents)

        # Any remaining pending job whose dependency is failed/blocked should be
        # blocked, including transitive descendants.
        self._propagate_blocks(dependents)

    def _run_one(self, job: Job):
        delays = [0.0, 0.1, 0.4]
        for attempt, delay in enumerate(delays, start=1):
            if delay:
                self._statuses[job.id] = self.RETRYING
                time.sleep(delay)
            self._statuses[job.id] = self.RUNNING
            try:
                job.func()
            except Exception:
                if attempt == len(delays):
                    self._statuses[job.id] = self.FAILED
                    return
                self._statuses[job.id] = self.RETRYING
                continue
            else:
                self._statuses[job.id] = self.SUCCEEDED
                return

    def _build_dependents(self) -> Dict[str, List[str]]:
        dependents: Dict[str, List[str]] = {job_id: [] for job_id in self._jobs}
        for job in self._jobs.values():
            for dep in job.deps:
                if dep in self._jobs:
                    dependents.setdefault(dep, []).append(job.id)
        return dependents

    def _mark_descendants_blocked(self, root_id: str, dependents: Dict[str, List[str]]):
        stack = list(dependents.get(root_id, []))
        seen: Set[str] = set()
        while stack:
            jid = stack.pop()
            if jid in seen:
                continue
            seen.add(jid)
            if self._statuses.get(jid) == self.PENDING:
                self._statuses[jid] = self.BLOCKED
            # Descendants of a blocked job are blocked too unless already terminal.
            if self._statuses.get(jid) in (self.PENDING, self.BLOCKED):
                stack.extend(dependents.get(jid, []))
            else:
                # Even if this job somehow already has a terminal state, its
                # children may still be affected by another failed dependency.
                stack.extend(dependents.get(jid, []))

    def _propagate_blocks(self, dependents: Dict[str, List[str]]):
        changed = True
        while changed:
            changed = False
            for job in self._jobs.values():
                if self._statuses[job.id] == self.PENDING:
                    if any(self._statuses.get(dep) in (self.FAILED, self.BLOCKED) for dep in job.deps):
                        self._statuses[job.id] = self.BLOCKED
                        changed = True

    def _detect_cycles(self):
        visiting: Set[str] = set()
        visited: Set[str] = set()

        def dfs(job_id: str):
            if job_id in visited:
                return
            if job_id in visiting:
                raise CycleError(f"dependency cycle involving {job_id}")
            visiting.add(job_id)
            job = self._jobs[job_id]
            for dep in job.deps:
                # Only submitted jobs can participate in a submitted-job cycle.
                if dep in self._jobs:
                    dfs(dep)
            visiting.remove(job_id)
            visited.add(job_id)

        for job_id in list(self._jobs):
            dfs(job_id)