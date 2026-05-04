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
        self._counter = 0

    def submit(self, job):
        # Silent no-op if the id has already been submitted.
        if job.id in self._jobs:
            return
        self._jobs[job.id] = job
        self._status[job.id] = "pending"
        self._order[job.id] = self._counter
        self._counter += 1

    def status(self, job_id):
        return self._status.get(job_id, "pending")

    def run(self):
        if not self._jobs:
            return

        self._detect_cycle()
        dependents = self._build_dependents()

        while True:
            pending = [jid for jid, st in self._status.items() if st == "pending"]
            if not pending:
                return

            # Anything depending on a failed/blocked/missing dependency can never run.
            changed = False
            for jid in list(pending):
                if self._status.get(jid) != "pending":
                    continue
                job = self._jobs[jid]
                if any((dep not in self._jobs) or (self._status.get(dep) in ("failed", "blocked"))
                       for dep in job.deps):
                    self._block_downstream(jid, dependents, include_self=True)
                    changed = True

            pending = [jid for jid, st in self._status.items() if st == "pending"]
            if not pending:
                return

            ready = [jid for jid in pending
                     if all(dep in self._jobs and self._status.get(dep) == "succeeded"
                            for dep in self._jobs[jid].deps)]

            if not ready:
                # Cycle should already have been found. If there is still no progress,
                # treat the remaining jobs as blocked rather than spin forever.
                for jid in list(pending):
                    if self._status.get(jid) == "pending":
                        self._block_downstream(jid, dependents, include_self=True)
                return

            ready.sort(key=lambda jid: (-self._jobs[jid].priority, self._order[jid]))
            for jid in ready:
                if self._status.get(jid) != "pending":
                    continue
                if not all(dep in self._jobs and self._status.get(dep) == "succeeded"
                           for dep in self._jobs[jid].deps):
                    continue
                ok = self._run_one(self._jobs[jid])
                if not ok:
                    self._block_downstream(jid, dependents, include_self=False)

    def _run_one(self, job: Job) -> bool:
        delays = [0, 0.1, 0.4]
        last_exc = None
        for attempt, delay in enumerate(delays, start=1):
            time.sleep(delay)
            self._status[job.id] = "running" if attempt == 1 else "retrying"
            try:
                job.func()
            except Exception as exc:  # failure means retry until attempts exhausted
                last_exc = exc
                if attempt == 3:
                    self._status[job.id] = "failed"
                    return False
            else:
                self._status[job.id] = "succeeded"
                return True
        self._status[job.id] = "failed"
        return False

    def _build_dependents(self):
        dependents = {jid: [] for jid in self._jobs}
        for jid, job in self._jobs.items():
            for dep in job.deps:
                if dep in dependents:
                    dependents[dep].append(jid)
        return dependents

    def _block_downstream(self, jid: str, dependents, include_self=False):
        stack = [jid] if include_self else list(dependents.get(jid, []))
        seen: Set[str] = set()
        while stack:
            cur = stack.pop()
            if cur in seen or cur not in self._jobs:
                continue
            seen.add(cur)
            if self._status.get(cur) in ("pending", "retrying", "running"):
                self._status[cur] = "blocked"
            for nxt in dependents.get(cur, []):
                stack.append(nxt)

    def _detect_cycle(self):
        visiting: Set[str] = set()
        visited: Set[str] = set()

        def dfs(jid: str):
            if jid in visiting:
                raise CycleError()
            if jid in visited:
                return
            visiting.add(jid)
            for dep in self._jobs[jid].deps:
                if dep in self._jobs:
                    dfs(dep)
            visiting.remove(jid)
            visited.add(jid)

        for jid in list(self._jobs):
            if jid not in visited:
                dfs(jid)