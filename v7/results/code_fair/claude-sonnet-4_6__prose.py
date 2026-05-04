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
    func: Callable


class JobScheduler:
    def __init__(self):
        self._jobs = {}  # id -> Job
        self._status = {}  # id -> status string

    def submit(self, job: Job):
        """Submit a job; silently ignore duplicate ids."""
        if job.id in self._jobs:
            return
        self._jobs[job.id] = job
        self._status[job.id] = "pending"

    def status(self, job_id: str) -> str:
        return self._status.get(job_id, "unknown")

    def run(self):
        """Execute all submitted jobs respecting deps, priority, and retry policy."""
        if not self._jobs:
            return

        # Topological sort (Kahn's algorithm) to detect cycles
        # and determine a valid execution order.
        # But we also need to respect priority among ready jobs.

        jobs = self._jobs
        statuses = self._status

        # Build adjacency and in-degree for cycle detection
        # dep -> list of jobs that depend on it
        dependents = {jid: [] for jid in jobs}
        in_degree = {jid: 0 for jid in jobs}

        for jid, job in jobs.items():
            for dep in job.deps:
                if dep in jobs:
                    dependents[dep].append(jid)
                    in_degree[jid] += 1
                # deps referencing unknown jobs are ignored (or treat as satisfied?)
                # Spec doesn't mention external deps, assume all deps are submitted jobs

        # Use a priority queue for ready jobs
        # Ready = in_degree == 0 (all deps satisfied or no deps)
        import heapq

        # heap entries: (-priority, id) so highest priority pops first
        ready_heap = []
        for jid in jobs:
            if in_degree[jid] == 0:
                heapq.heappush(ready_heap, (-jobs[jid].priority, jid))

        processed = 0
        total = len(jobs)

        while ready_heap:
            _, jid = heapq.heappop(ready_heap)
            job = jobs[jid]

            # Check if any dep has failed/blocked → block this job
            should_block = False
            for dep in job.deps:
                if dep in statuses and statuses[dep] in ("failed", "blocked"):
                    should_block = True
                    break

            if should_block:
                self._mark_blocked(jid, dependents)
                processed += 1
                # Push dependents that are now ready
                for dep_jid in dependents[jid]:
                    in_degree[dep_jid] -= 1
                    if in_degree[dep_jid] == 0:
                        heapq.heappush(ready_heap, (-jobs[dep_jid].priority, dep_jid))
                continue

            # Attempt to run the job with retry policy
            # sleeps before each attempt: 0, 0.1, 0.4
            delays = [0, 0.1, 0.4]
            max_attempts = 3
            succeeded = False

            for attempt in range(max_attempts):
                time.sleep(delays[attempt])
                if attempt == 0:
                    statuses[jid] = "running"
                else:
                    statuses[jid] = "retrying"
                try:
                    job.func()
                    statuses[jid] = "succeeded"
                    succeeded = True
                    break
                except Exception:
                    pass

            if not succeeded:
                statuses[jid] = "failed"

            processed += 1

            # Update dependents
            for dep_jid in dependents[jid]:
                in_degree[dep_jid] -= 1
                if in_degree[dep_jid] == 0:
                    heapq.heappush(ready_heap, (-jobs[dep_jid].priority, dep_jid))

        if processed < total:
            raise CycleError("Cycle detected in job dependencies")

    def _mark_blocked(self, jid: str, dependents: dict):
        """Mark a job and all transitive dependents as blocked."""
        self._status[jid] = "blocked"
        for dep_jid in dependents.get(jid, []):
            if self._status.get(dep_jid) not in ("blocked",):
                self._mark_blocked(dep_jid, dependents)