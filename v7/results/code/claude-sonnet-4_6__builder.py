import time
import heapq
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Any


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
    
    def submit(self, job: Job):
        """Submit a job; deduplicate by id (first submission wins)."""
        if job.id not in self._jobs:
            self._jobs[job.id] = job
    
    def status(self, job_id: str) -> str:
        return self._statuses.get(job_id, "pending")
    
    def run(self):
        jobs = self._jobs
        
        # Initialize statuses
        self._statuses = {jid: "pending" for jid in jobs}
        
        # Validate all deps exist (optional, but helpful)
        # Detect cycles using Kahn's algorithm
        # Build in-degree map and adjacency list
        in_degree = {jid: 0 for jid in jobs}
        dependents = {jid: [] for jid in jobs}  # jid -> list of jobs that depend on jid
        
        for jid, job in jobs.items():
            for dep in job.deps:
                if dep not in jobs:
                    raise ValueError(f"Dependency '{dep}' not found for job '{jid}'")
                dependents[dep].append(jid)
                in_degree[jid] += 1
        
        # Backoff delays: attempt 0 -> 0s, attempt 1 -> 0.1s, attempt 2 -> 0.4s
        backoff = [0, 0.1, 0.4]
        
        # Track attempts per job
        attempts = {jid: 0 for jid in jobs}
        
        # Use a priority queue of ready jobs: (-priority, insertion_order, job_id)
        # So highest priority comes first
        ready_heap = []
        counter = 0  # for stable ordering
        
        for jid in jobs:
            if in_degree[jid] == 0:
                heapq.heappush(ready_heap, (-jobs[jid].priority, counter, jid))
                counter += 1
        
        completed = set()  # succeeded jobs
        failed_or_blocked = set()  # failed or blocked jobs
        
        # Check for cycle: if total processable < total jobs
        # We'll detect via Kahn's - count how many we process
        processed_count = 0
        total = len(jobs)
        
        # We need to detect cycles before running. Let's do a pre-check.
        self._detect_cycle(jobs)
        
        while ready_heap:
            _, _, jid = heapq.heappop(ready_heap)
            job = jobs[jid]
            
            # Check if any dependency failed/blocked
            if any(dep in failed_or_blocked for dep in job.deps):
                self._statuses[jid] = "blocked"
                failed_or_blocked.add(jid)
                processed_count += 1
                # Propagate to dependents
                self._release_dependents(jid, jobs, dependents, in_degree, ready_heap, counter)
                counter += len(dependents[jid])
                continue
            
            # Try to run the job with retries
            succeeded = False
            for attempt in range(3):
                if attempt > 0:
                    self._statuses[jid] = "retrying"
                else:
                    self._statuses[jid] = "running"
                
                # Apply backoff before attempt (0s for first, 0.1s for second, 0.4s for third)
                delay = backoff[attempt]
                if delay > 0:
                    time.sleep(delay)
                
                try:
                    job.func()
                    succeeded = True
                    break
                except Exception:
                    pass
            
            if succeeded:
                self._statuses[jid] = "succeeded"
                completed.add(jid)
            else:
                self._statuses[jid] = "failed"
                failed_or_blocked.add(jid)
            
            processed_count += 1
            
            # Release dependents - update their in_degree and add to heap if ready
            new_ready = []
            for dep_jid in dependents[jid]:
                in_degree[dep_jid] -= 1
                if in_degree[dep_jid] == 0:
                    new_ready.append(dep_jid)
            
            # Sort new_ready by priority desc for consistent ordering
            for dep_jid in new_ready:
                heapq.heappush(ready_heap, (-jobs[dep_jid].priority, counter, dep_jid))
                counter += 1
    
    def _release_dependents(self, jid, jobs, dependents, in_degree, ready_heap, counter):
        for dep_jid in dependents[jid]:
            in_degree[dep_jid] -= 1
            if in_degree[dep_jid] == 0:
                heapq.heappush(ready_heap, (-jobs[dep_jid].priority, counter, dep_jid))
                counter += 1
    
    def _detect_cycle(self, jobs):
        """Detect cycles using DFS."""
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {jid: WHITE for jid in jobs}
        
        def dfs(jid):
            color[jid] = GRAY
            for dep in jobs[jid].deps:
                if dep not in color:
                    continue
                if color[dep] == GRAY:
                    raise CycleError(f"Cycle detected involving job '{dep}'")
                if color[dep] == WHITE:
                    dfs(dep)
            color[jid] = BLACK
        
        for jid in jobs:
            if color[jid] == WHITE:
                dfs(jid)