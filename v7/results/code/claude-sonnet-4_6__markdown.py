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
        self._jobs = {}       # id -> Job
        self._status = {}     # id -> str

    def submit(self, job: Job) -> None:
        if job.id in self._jobs:
            return  # silent dedup
        self._jobs[job.id] = job
        self._status[job.id] = "pending"

    def run(self) -> None:
        if not self._jobs:
            return

        # Topological sort (Kahn's algorithm) — also detects cycles
        # Build adjacency and in-degree
        in_degree = {jid: 0 for jid in self._jobs}
        dependents = {jid: [] for jid in self._jobs}  # jid -> list of jobs that depend on jid

        for jid, job in self._jobs.items():
            for dep in job.deps:
                # dep must finish before jid
                dependents[dep].append(jid)
                in_degree[jid] += 1

        # Use a max-heap (priority queue) for ready jobs
        import heapq
        # heap entries: (-priority, id) so highest priority comes first
        ready = []
        for jid, deg in in_degree.items():
            if deg == 0:
                job = self._jobs[jid]
                heapq.heappush(ready, (-job.priority, jid))

        processed = 0
        total = len(self._jobs)

        while ready:
            _, jid = heapq.heappop(ready)
            job = self._jobs[jid]

            # Check if blocked
            if self._status[jid] == "blocked":
                processed += 1
                # Propagate block to dependents
                self._propagate_blocked(jid, dependents, in_degree, ready)
                continue

            # Check if any dep failed/blocked (safety check)
            skip = False
            for dep in job.deps:
                if self._status[dep] in ("failed", "blocked"):
                    self._status[jid] = "blocked"
                    skip = True
                    break

            if skip:
                processed += 1
                self._propagate_blocked(jid, dependents, in_degree, ready)
                continue

            # Run job with retry policy
            backoffs = [0, 0.1, 0.4]
            max_attempts = 3
            succeeded = False

            for attempt in range(max_attempts):
                sleep_time = backoffs[attempt]
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
                    pass  # try next attempt

            if not succeeded:
                self._status[jid] = "failed"

            processed += 1

            # Update dependents
            if succeeded:
                for dep_jid in dependents[jid]:
                    in_degree[dep_jid] -= 1
                    if in_degree[dep_jid] == 0:
                        dep_job = self._jobs[dep_jid]
                        heapq.heappush(ready, (-dep_job.priority, dep_jid))
            else:
                # Propagate blocked
                self._propagate_blocked(jid, dependents, in_degree, ready)

        # If not all processed → cycle
        if processed != total:
            raise CycleError("Dependency cycle detected among submitted jobs")

    def _propagate_blocked(self, failed_jid, dependents, in_degree, ready):
        """Mark all transitive dependents of failed_jid as blocked and add to ready queue."""
        import heapq
        stack = list(dependents[failed_jid])
        while stack:
            dep_jid = stack.pop()
            if self._status[dep_jid] not in ("blocked",):
                self._status[dep_jid] = "blocked"
                # Reduce in_degree so they eventually get scheduled (and skipped)
                in_degree[dep_jid] -= 1
                if in_degree[dep_jid] == 0:
                    job = self._jobs[dep_jid]
                    heapq.heappush(ready, (-job.priority, dep_jid))
                # Recurse
                stack.extend(dependents[dep_jid])

    def status(self, job_id: str) -> str:
        return self._status.get(job_id, "unknown")