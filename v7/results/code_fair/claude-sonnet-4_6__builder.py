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
    func: Callable[[], None]


class JobScheduler:
    def __init__(self):
        self._jobs = {}       # id -> Job
        self._statuses = {}   # id -> status string

    def submit(self, job: Job):
        if job.id in self._jobs:
            return  # silent no-op
        self._jobs[job.id] = job
        self._statuses[job.id] = "pending"

    def status(self, job_id: str) -> Optional[str]:
        return self._statuses.get(job_id)

    def run(self):
        if not self._jobs:
            return

        # Topological sort with cycle detection (Kahn's algorithm)
        # Build in-degree and adjacency list
        jobs = self._jobs
        ids = list(jobs.keys())

        # in_degree[node] = number of unresolved deps
        in_degree = {jid: 0 for jid in ids}
        # dependents[jid] = list of jobs that depend on jid
        dependents = {jid: [] for jid in ids}

        for jid in ids:
            job = jobs[jid]
            for dep in job.deps:
                if dep not in jobs:
                    raise ValueError(f"Unknown dependency '{dep}' for job '{jid}'")
                in_degree[jid] += 1
                dependents[dep].append(jid)

        # Use a list as a priority queue (sorted by priority desc)
        # Ready queue: jobs whose in_degree == 0
        ready = [jid for jid in ids if in_degree[jid] == 0]
        # Sort ready by priority descending
        ready.sort(key=lambda jid: jobs[jid].priority, reverse=True)

        executed_order = []

        while ready:
            # Pick the highest-priority ready job
            # ready is kept sorted, pop from front
            current_id = ready.pop(0)
            executed_order.append(current_id)

            # Run with retry
            job = jobs[current_id]
            success = self._run_with_retry(current_id, job)

            if success:
                # Update dependents
                new_ready = []
                for dep_id in dependents[current_id]:
                    in_degree[dep_id] -= 1
                    if in_degree[dep_id] == 0:
                        new_ready.append(dep_id)
                # Insert new_ready into ready, maintaining priority order
                ready.extend(new_ready)
                ready.sort(key=lambda jid: jobs[jid].priority, reverse=True)
            else:
                # Mark transitive downstream as blocked
                self._mark_blocked(current_id, dependents)

        # Check for cycles: any job still with in_degree > 0 that wasn't blocked
        # means there's a cycle
        remaining = [jid for jid in ids if jid not in set(executed_order)
                     and self._statuses[jid] not in ("blocked",)]
        if remaining:
            raise CycleError(f"Cycle detected involving jobs: {remaining}")

    def _run_with_retry(self, job_id: str, job: Job) -> bool:
        """Run a job with up to 3 attempts, exponential backoff. Returns True on success."""
        delays = [0, 0.1, 0.4]
        max_attempts = 3

        for attempt in range(max_attempts):
            sleep_time = delays[attempt]
            if sleep_time > 0:
                time.sleep(sleep_time)

            if attempt == 0:
                self._statuses[job_id] = "running"
            else:
                self._statuses[job_id] = "retrying"

            try:
                job.func()
                self._statuses[job_id] = "succeeded"
                return True
            except Exception:
                pass  # will retry or fail

        self._statuses[job_id] = "failed"
        return False

    def _mark_blocked(self, failed_id: str, dependents: dict):
        """BFS/DFS to mark all transitive dependents of failed_id as blocked."""
        stack = list(dependents[failed_id])
        while stack:
            jid = stack.pop()
            if self._statuses[jid] != "blocked":
                self._statuses[jid] = "blocked"
                stack.extend(dependents[jid])