from __future__ import annotations

import asyncio
import sys
import time
from collections import defaultdict
from contextlib import asynccontextmanager

# Must be set before any SQLAlchemy/psycopg import on Windows
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import commands, scenes


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm up catalog and schema at startup so first request is fast
    from app.catalog import asset_catalog
    asset_catalog.get_all_ids()
    yield


app = FastAPI(title="WorldCraft AI", version="0.1.0", lifespan=lifespan)

settings = get_settings()

# ── CORS ──────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)

# ── Per-IP rate limiter (in-memory, single instance) ─────────────────────
_rate_store: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW = 60.0  # seconds


@app.middleware("http")
async def rate_limit_commands(request: Request, call_next) -> Response:
    if request.url.path == "/api/v1/commands" and request.method == "POST":
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window_start = now - _RATE_WINDOW
        timestamps = [t for t in _rate_store[ip] if t > window_start]
        if len(timestamps) >= settings.rate_limit_rpm:
            return Response(
                content='{"error_code":"RATE_LIMITED","message":"Too many requests."}',
                status_code=429,
                media_type="application/json",
            )
        timestamps.append(now)
        _rate_store[ip] = timestamps
    return await call_next(request)


# ── Routers ───────────────────────────────────────────────────────────────
app.include_router(commands.router)
app.include_router(scenes.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
