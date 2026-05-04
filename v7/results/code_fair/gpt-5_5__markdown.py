from dataclasses import dataclass
from typing import Callable, List, Dict, Set
import time
import heapq


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
        self._order = 0
        self._submit_order: Dict[str, int] = {}

    def submit(self, job):
        # Silent no-op on duplicate id.
        if job.id in self._jobs:
            return
        self._jobs[job.id] = job
        self._status[job.id] = "pending"
        self._submit_order[job.id] = self._order
        self._order += 1

    def status(self, job_id) -> str:
        return self._status.get(job_id, "pending")

    def run(self):
        if not self._jobs:
            return
        self._detect_cycle()

        # Build reverse dependency graph and count submitted deps for each job.
        dependents: Dict[str, List[str]] = {jid: [] for jid in self._jobs}
        remaining = {jid: 0 for jid in self._jobs}
        missing_dep = {jid: False for jid in self._jobs}
        for jid, job in self._jobs.items():
            for dep in job.deps:
                if dep in self._jobs:
                    dependents[dep].append(jid)
                    remaining[jid] += 1
                else:
                    # Not specified; cannot ever run if a dep is absent.
                    missing_dep[jid] = True

        ready = []
        for jid, count in remaining.items():
            if count == 0 and not missing_dep[jid] and self._status[jid] == "pending":
                self._push_ready(ready, jid)

        while ready:
            _, _, jid = heapq.heappop(ready)
            if self._status.get(jid) != "pending":
                continue
            self._execute(jid)
            if self._status[jid] == "succeeded":
                for child in dependents[jid]:
                    if self._status.get(child) == "pending":
                        remaining[child] -= 1
                        if remaining[child] == 0 and not missing_dep[child]:
                            self._push_ready(ready, child)
            elif self._status[jid] == "failed":
                for child in dependents[jid]:
                    self._block_transitive(child, dependents)

        # Anything pending after processing is blocked if it has missing/blocked/failed deps.
        changed = True
        while changed:
            changed = False
            for jid, job in self._jobs.items():
                if self._status[jid] != "pending":
                    continue
                if missing_dep[jid] or any(self._status.get(dep) in ("failed", "blocked") or dep not in self._jobs for dep in job.deps):
                    self._block_transitive(jid, dependents)
                    changed = True

    def _push_ready(self, heap, jid):
        # Higher priority first; insertion order breaks ties deterministically.
        job = self._jobs[jid]
        heapq.heappush(heap, (-job.priority, self._submit_order[jid], jid))

    def _execute(self, jid):
        job = self._jobs[jid]
        sleeps = [0.0, 0.1, 0.4]
        for attempt in range(3):
            if attempt == 0:
                self._status[jid] = "running"
            else:
                self._status[jid] = "retrying"
            time.sleep(sleeps[attempt])
            try:
                job.func()
                self._status[jid] = "succeeded"
                return
            except Exception:
                if attempt == 2:
                    self._status[jid] = "failed"
                    return
                # next loop will mark retrying
                pass

    def _block_transitive(self, jid, dependents):
        if jid not in self._jobs:
            return
        if self._status.get(jid) in ("succeeded", "failed", "blocked"):
            # succeeded/failed jobs are final; still propagate from failed/blocked only as needed.
            if self._status.get(jid) != "blocked":
                return
        if self._status.get(jid) != "blocked":
            self._status[jid] = "blocked"
        for child in dependents.get(jid, []):
            self._block_transitive(child, dependents)

    def _detect_cycle(self):
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {jid: WHITE for jid in self._jobs}

        def dfs(jid):
            color[jid] = GRAY
            for dep in self._jobs[jid].deps:
                if dep not in self._jobs:
                    continue
                if color[dep] == GRAY:
                    raise CycleError()
                if color[dep] == WHITE:
                    dfs(dep)
            color[jid] = BLACK

        for jid in list(self._jobs):
            if color[jid] == WHITE:
                dfs(jid)