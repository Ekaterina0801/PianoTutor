from __future__ import annotations

import logging
import os
import time
import uuid
from collections import defaultdict, deque

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import health, exercises, sessions, analysis, auth, research, assignments
from app.db import init_db
from app.security import validate_security_config

validate_security_config()

app = FastAPI(title="Piano Tutor API", version="0.3.0")
logger = logging.getLogger("piano_tutor")
cors_origins = [
    x.strip()
    for x in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if x.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
init_db()

RATE_LIMIT_WINDOW_S = int(os.getenv("RATE_LIMIT_WINDOW_S", "60"))
RATE_LIMITS = {
    "/api/auth/login": int(os.getenv("LOGIN_RATE_LIMIT_PER_MIN", "10")),
    "/api/auth/register": int(os.getenv("REGISTER_RATE_LIMIT_PER_MIN", "6")),
    "/api/transcribe": int(os.getenv("TRANSCRIBE_RATE_LIMIT_PER_MIN", "12")),
}
_rate_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def request_context_and_limits(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    started = time.perf_counter()
    limit = RATE_LIMITS.get(request.url.path)
    if limit:
        key = f"{request.url.path}:{_client_ip(request)}"
        now = time.time()
        hits = _rate_hits[key]
        while hits and now - hits[0] > RATE_LIMIT_WINDOW_S:
            hits.popleft()
        if len(hits) >= limit:
            return JSONResponse(
                status_code=429,
                content={"code": "rate_limited", "message": "Too many requests", "request_id": request_id},
                headers={"X-Request-ID": request_id},
            )
        hits.append(now)

    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request failed", extra={"request_id": request_id, "path": request.url.path})
        return JSONResponse(
            status_code=500,
            content={"code": "internal_error", "message": "Internal server error", "request_id": request_id},
            headers={"X-Request-ID": request_id},
        )

    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time-ms"] = f"{(time.perf_counter() - started) * 1000:.1f}"
    return response

app.mount("/static", StaticFiles(directory="data/static", html=False), name="static")

app.include_router(health.router)
app.include_router(auth.router, prefix="/api")
app.include_router(exercises.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(research.router, prefix="/api")
app.include_router(assignments.router, prefix="/api")
