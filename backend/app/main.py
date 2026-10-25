"""
QuantumShield - FastAPI Main Application
Post-Quantum Secure Messaging Backend
"""
import logging
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.routes import router
from app.websocket.handler import websocket_room_handler

# --- Logging -----------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

logger = logging.getLogger("quantumshield")

# --- Lifespan ----------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"QuantumShield v{settings.app_version} starting on port {settings.port}")
    logger.info("SECURITY: Server operates in relay-only mode. No plaintext or keys stored.")
    logger.info("SECURITY AUDIT: In-memory ephemeral room manager active (zero disk persistence).")
    yield
    logger.info("QuantumShield shutting down")

# --- App ---------------------------------------------------------------------
app = FastAPI(
    title="QuantumShield API",
    description=(
        "Hybrid Post-Quantum Secure Messaging Backend. "
        "The server relays encrypted messages only; all E2E crypto is browser-side."
    ),
    version=settings.app_version,
    lifespan=lifespan,
)

is_wildcard = "*" in settings.allowed_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=not is_wildcard,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: blob:; "
        "connect-src 'self' ws: wss: http: https:; "
        "frame-ancestors 'none'; "
        "object-src 'none'; "
        "base-uri 'self';"
    )
    return response

# --- Routes ------------------------------------------------------------------
app.include_router(router)

@app.websocket("/ws/room/{room_id}")
async def room_websocket(websocket: WebSocket, room_id: str):
    await websocket_room_handler(websocket, room_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
