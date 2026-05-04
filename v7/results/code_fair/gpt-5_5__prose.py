from dataclasses import dataclass
from typing import Callable, List, Dict, Set
import time


class CycleError(Exception):
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
        self._order: Dict[str, int] = {}

    def submit(self, job: Job):
        if job.id in self._jobs:
            return
        self._order[job.id] = len(self._order)
        self._jobs[job.id] = job
        self._status[job.id] = "pending"

    def status(self, job_id: str):
        return self._status.get(job_id, "pending")

    def _check_cycles(self):
        visiting: Set[str] = set()
        visited: Set[str] = set()

        def dfs(jid: str):
            if jid in visiting:
                raise CycleError()
            if jid in visited:
                return
            visiting.add(jid)
            job = self._jobs[jid]
            for dep in job.deps:
                if dep in self._jobs:
                    dfs(dep)
            visiting.remove(jid)
            visited.add(jid)

        for jid in list(self._jobs):
            dfs(jid)

    def _reverse_deps(self):
        rev = {jid: [] for jid in self._jobs}
        for jid, job in self._jobs.items():
            for dep in job.deps:
                if dep in rev:
                    rev[dep].append(jid)
        return rev

    def _block_downstream(self, start_id: str, rev):
        stack = list(rev.get(start_id, []))
        seen = set()
        while stack:
            jid = stack.pop()
            if jid in seen:
                continue
            seen.add(jid)
            if self._status.get(jid) not in ("succeeded", "failed"):
                self._status[jid] = "blocked"
            stack.extend(rev.get(jid, []))

    def _attempt_job(self, job: Job):
        delays = [0, 0.1, 0.4]
        for i, delay in enumerate(delays):
            time.sleep(delay)
            self._status[job.id] = "running" if i == 0 else "retrying"
            try:
                job.func()
            except Exception:
                if i == len(delays) - 1:
                    self._status[job.id] = "failed"
                    return False
            else:
                self._status[job.id] = "succeeded"
                return True
        self._status[job.id] = "failed"
        return False

    def run(self):
        self._check_cycles()
        rev = self._reverse_deps()

        while True:
            # Anything depending on an unavailable/failed/blocked dependency can never run.
            changed = True
            while changed:
                changed = False
                for jid, job in self._jobs.items():
                    if self._status.get(jid) == "pending":
                        if any(dep not in self._jobs or self._status.get(dep) in ("failed", "blocked") for dep in job.deps):
                            self._status[jid] = "blocked"
                            changed = True

            pending = [jid for jid in self._jobs if self._status.get(jid) == "pending"]
            if not pending:
                break

            ready = [
                self._jobs[jid]
                for jid in pending
                if all(dep in self._jobs and self._status.get(dep) == "succeeded" for dep in self._jobs[jid].deps)
            ]
            if not ready:
                # No cycle (checked above), so remaining jobs are unsatisfiable (e.g. missing deps).
                for jid in pending:
                    self._status[jid] = "blocked"
                break

            ready.sort(key=lambda j: (-j.priority, self._order[j.id]))
            job = ready[0]
            ok = self._attempt_job(job)
            if not ok:
                self._block_downstream(job.id, rev)