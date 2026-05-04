from dataclasses import dataclass, field
from typing import Callable, List, Dict, Set, Any
import heapq
import time


class CycleError(Exception):
    pass


@dataclass
class Job:
    id: str
    priority: int
    deps: List[str] = field(default_factory=list)
    func: Callable[[], Any] = lambda: None


class JobScheduler:
    VALID_STATUSES = {"pending", "running", "retrying", "succeeded", "failed", "blocked"}

    def __init__(self):
        self.jobs: Dict[str, Job] = {}
        self._status: Dict[str, str] = {}
        self._order: Dict[str, int] = {}
        self._submit_counter = 0

    def submit(self, job):
        # Deduplicate by id: first submitted job wins.
        if job.id in self.jobs:
            return
        self.jobs[job.id] = job
        self._status[job.id] = "pending"
        self._order[job.id] = self._submit_counter
        self._submit_counter += 1

    def status(self, job_id):
        return self._status.get(job_id, "pending")

    def _graph(self):
        children = {jid: [] for jid in self.jobs}
        indegree = {jid: 0 for jid in self.jobs}
        for jid, job in self.jobs.items():
            for dep in job.deps:
                if dep in self.jobs:
                    children[dep].append(jid)
                    indegree[jid] += 1
        return children, indegree

    def _check_cycles(self):
        children, indegree = self._graph()
        q = [jid for jid, deg in indegree.items() if deg == 0]
        seen = 0
        while q:
            jid = q.pop()
            seen += 1
            for child in children[jid]:
                indegree[child] -= 1
                if indegree[child] == 0:
                    q.append(child)
        if seen != len(self.jobs):
            raise CycleError("dependency cycle detected")

    def _mark_blocked_transitive(self, start_id, children):
        stack = list(children.get(start_id, []))
        while stack:
            jid = stack.pop()
            if self._status.get(jid) in ("succeeded", "failed", "blocked"):
                # Succeeded/failed jobs are already terminal.  Still walk their children
                # only if this is a blocked/failed chain; a succeeded job cannot be
                # downstream of a newly failed unmet dependency in this scheduler.
                if self._status.get(jid) == "blocked":
                    stack.extend(children.get(jid, []))
                continue
            self._status[jid] = "blocked"
            stack.extend(children.get(jid, []))

    def _run_one(self, job):
        delays = [0.0, 0.1, 0.4]
        last_exc = None
        for attempt, delay in enumerate(delays, start=1):
            if attempt == 1:
                self._status[job.id] = "running"
            else:
                self._status[job.id] = "retrying"
            if delay:
                time.sleep(delay)
            try:
                self._status[job.id] = "running"
                job.func()
                self._status[job.id] = "succeeded"
                return True
            except Exception as exc:
                last_exc = exc
                if attempt == len(delays):
                    self._status[job.id] = "failed"
                    return False
        self._status[job.id] = "failed"
        return False

    def run(self):
        if not self.jobs:
            return

        self._check_cycles()
        children, _ = self._graph()

        # Number of submitted dependencies not yet satisfied. Missing dependencies are
        # treated as unsatisfied and therefore block the job after processing.
        remaining = {}
        missing_dep_jobs = set()
        for jid, job in self.jobs.items():
            count = 0
            missing = False
            for dep in job.deps:
                if dep in self.jobs:
                    if self._status.get(dep) != "succeeded":
                        count += 1
                else:
                    missing = True
            remaining[jid] = count
            if missing:
                missing_dep_jobs.add(jid)

        ready = []
        for jid, job in self.jobs.items():
            if self._status.get(jid) == "pending" and remaining[jid] == 0 and jid not in missing_dep_jobs:
                heapq.heappush(ready, (-job.priority, self._order[jid], jid))

        while ready:
            _, _, jid = heapq.heappop(ready)
            if self._status.get(jid) != "pending":
                continue
            job = self.jobs[jid]
            ok = self._run_one(job)
            if not ok:
                self._mark_blocked_transitive(jid, children)
                continue

            for child in children.get(jid, []):
                if self._status.get(child) != "pending":
                    continue
                remaining[child] -= 1
                if remaining[child] == 0 and child not in missing_dep_jobs:
                    cjob = self.jobs[child]
                    heapq.heappush(ready, (-cjob.priority, self._order[child], child))

        # Any job still pending at this point has an unknown/missing dependency or was
        # otherwise made unreachable. Mark it and its descendants blocked.
        for jid in list(self.jobs):
            if self._status.get(jid) == "pending":
                self._status[jid] = "blocked"
                self._mark_blocked_transitive(jid, children)