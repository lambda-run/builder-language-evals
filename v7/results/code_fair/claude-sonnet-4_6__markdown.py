import time
from dataclasses import dataclass, field
from typing import Callable, List


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
        self._jobs = {}  # id -> Job
        self._status = {}  # id -> status string

    def submit(self, job: Job):
        if job.id in self._jobs:
            return  # silent no-op on duplicate
        self._jobs[job.id] = job
        self._status[job.id] = "pending"

    def run(self):
        if not self._jobs:
            return

        # Topological sort with cycle detection (Kahn's algorithm)
        # But we also need priority-based ordering among ready nodes
        jobs = self._jobs

        # Build in-degree and adjacency
        in_degree = {jid: 0 for jid in jobs}
        dependents = {jid: [] for jid in jobs}  # jid -> list of jobs that depend on jid

        for jid, job in jobs.items():
            for dep in job.deps:
                if dep in jobs:
                    in_degree[jid] += 1
                    dependents[dep].append(jid)
                # If dep not in jobs at all, treat as missing - can't satisfy
                # (spec doesn't mention this case, assume all deps are submitted)

        # Check for cycles using DFS
        self._detect_cycle()

        # Execute using priority queue among ready jobs
        import heapq

        # Use a min-heap with negative priority for max-priority first
        # heap items: (-priority, id)
        ready = []
        for jid in jobs:
            if in_degree[jid] == 0:
                heapq.heappush(ready, (-jobs[jid].priority, jid))

        while ready:
            _, jid = heapq.heappop(ready)
            job = jobs[jid]

            # Check if any dep failed or blocked -> block this job
            should_block = False
            for dep in job.deps:
                if dep in self._status and self._status[dep] in ("failed", "blocked"):
                    should_block = True
                    break

            if should_block:
                self._status[jid] = "blocked"
                # Propagate to dependents
                for dep_jid in dependents[jid]:
                    in_degree[dep_jid] -= 1
                    if in_degree[dep_jid] == 0:
                        heapq.heappush(ready, (-jobs[dep_jid].priority, dep_jid))
                continue

            # Try to run the job with retries
            # Delays before attempts: 0s, 0.1s, 0.4s
            delays = [0, 0.1, 0.4]
            max_attempts = 3
            succeeded = False

            for attempt in range(max_attempts):
                sleep_time = delays[attempt]
                if sleep_time > 0:
                    time.sleep(sleep_time)

                if attempt == 0:
                    self._status[jid] = "running"
                else:
                    self._status[jid] = "retrying"

                try:
                    job.func()
                    self._status[jid] = "succeeded"
                    succeeded = True
                    break
                except Exception:
                    pass

            if not succeeded:
                self._status[jid] = "failed"

            # Update dependents
            for dep_jid in dependents[jid]:
                in_degree[dep_jid] -= 1
                if in_degree[dep_jid] == 0:
                    heapq.heappush(ready, (-jobs[dep_jid].priority, dep_jid))

        # Any jobs still pending (shouldn't happen after cycle detection, but just in case)
        for jid in jobs:
            if self._status[jid] == "pending":
                self._status[jid] = "blocked"

    def _detect_cycle(self):
        """Detect cycle using DFS. Raises CycleError if cycle found."""
        jobs = self._jobs
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {jid: WHITE for jid in jobs}

        def dfs(jid):
            color[jid] = GRAY
            for dep in jobs[jid].deps:
                if dep not in jobs:
                    continue
                if color[dep] == GRAY:
                    raise CycleError(f"Cycle detected involving job '{dep}'")
                if color[dep] == WHITE:
                    dfs(dep)
            color[jid] = BLACK

        for jid in jobs:
            if color[jid] == WHITE:
                dfs(jid)

    def status(self, job_id: str) -> str:
        return self._status.get(job_id, "pending")