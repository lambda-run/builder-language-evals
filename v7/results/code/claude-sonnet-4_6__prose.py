import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional


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
        self._jobs = {}        # id -> Job
        self._status = {}      # id -> str

    def submit(self, job: Job):
        if job.id in self._jobs:
            return  # silent dedup
        self._jobs[job.id] = job
        self._status[job.id] = "pending"

    def status(self, job_id: str) -> str:
        return self._status.get(job_id, "pending")

    def run(self):
        if not self._jobs:
            return

        # Topological sort (Kahn's algorithm) with cycle detection
        jobs = self._jobs

        # Build adjacency and in-degree structures
        # dep -> list of jobs that depend on dep
        dependents = {jid: [] for jid in jobs}
        in_degree = {jid: 0 for jid in jobs}

        for jid, job in jobs.items():
            for dep in job.deps:
                # dep must exist (we trust it does or it won't be ready)
                if dep in dependents:
                    dependents[dep].append(jid)
                    in_degree[jid] += 1

        # Backoff delays (before attempt index 0, 1, 2)
        backoff = [0, 0.1, 0.4]

        # We'll execute in topological order, using a priority queue for
        # jobs whose deps are all satisfied.
        import heapq

        # heap entries: (-priority, insertion_order, job_id)
        heap = []
        counter = 0

        for jid, deg in in_degree.items():
            if deg == 0:
                heapq.heappush(heap, (-jobs[jid].priority, counter, jid))
                counter += 1

        executed = 0
        total = len(jobs)

        while heap:
            neg_pri, _, jid = heapq.heappop(heap)
            job = jobs[jid]

            # Check if any dependency failed/blocked → mark this job blocked
            blocked = False
            for dep in job.deps:
                if self._status[dep] in ("failed", "blocked"):
                    blocked = True
                    break

            if blocked:
                self._status[jid] = "blocked"
                executed += 1
                # Propagate to dependents
                for dep_jid in dependents[jid]:
                    in_degree[dep_jid] -= 1
                    if in_degree[dep_jid] == 0:
                        heapq.heappush(heap, (-jobs[dep_jid].priority, counter, dep_jid))
                        counter += 1
                continue

            # Attempt the job up to 3 times
            succeeded = False
            for attempt in range(3):
                if attempt == 0:
                    self._status[jid] = "running"
                else:
                    self._status[jid] = "retrying"

                # Sleep backoff before attempt
                sleep_time = backoff[attempt]
                if sleep_time > 0:
                    time.sleep(sleep_time)

                try:
                    job.func()
                    succeeded = True
                    break
                except Exception:
                    pass

            if succeeded:
                self._status[jid] = "succeeded"
            else:
                self._status[jid] = "failed"

            executed += 1

            # Unlock dependents
            for dep_jid in dependents[jid]:
                in_degree[dep_jid] -= 1
                if in_degree[dep_jid] == 0:
                    heapq.heappush(heap, (-jobs[dep_jid].priority, counter, dep_jid))
                    counter += 1

        # If not all jobs were executed, there's a cycle
        if executed < total:
            raise CycleError("Dependency cycle detected among submitted jobs")