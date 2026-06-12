from collections import defaultdict, deque
from time import monotonic

from fastapi import Depends, HTTPException, Request, status

_requests: dict[str, deque[float]] = defaultdict(deque)


def rate_limit(max_requests: int, window_seconds: int):
    def dependency(request: Request) -> None:
        forwarded = request.headers.get("x-forwarded-for", "")
        client = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
        key = f"{request.url.path}:{client}"
        now = monotonic()
        bucket = _requests[key]
        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()
        if len(bucket) >= max_requests:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited")
        bucket.append(now)

    return Depends(dependency)
