"""
QuantumShield - FastAPI Main Application
Post-Quantum Secure Messaging Backend
"""
import logging
import sys
from collections import deque
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.routes import router
from app.websocket.handler import websocket_room_handler

# --- In-Memory Ring Buffer Log Handler ---------------------------------------
class InMemoryLogHandler(logging.Handler):
    def __init__(self, capacity: int = 500):
        super().__init__()
        self.buffer = deque(maxlen=capacity)

    def emit(self, record):
        try:
            entry = {
                "id": f"{record.created}-{record.msecs}",
                "timestamp": datetime.fromtimestamp(record.created).strftime("%H:%M:%S.%f")[:-3],
                "level": record.levelname,
                "source": "backend",
                "logger": record.name,
                "message": record.getMessage(),
            }
            self.buffer.append(entry)
        except Exception:
            pass

in_memory_log_handler = InMemoryLogHandler(capacity=500)
formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
in_memory_log_handler.setFormatter(formatter)

# --- Logging -----------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logging.getLogger().addHandler(in_memory_log_handler)
logging.getLogger("uvicorn").addHandler(in_memory_log_handler)
logging.getLogger("uvicorn.access").addHandler(in_memory_log_handler)
logging.getLogger("quantumshield").addHandler(in_memory_log_handler)

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

# --- Routes ------------------------------------------------------------------
app.include_router(router)

@app.get("/api/system/logs", tags=["system"])
async def get_system_logs(limit: int = 150):
    """Retrieve the recent system and security audit logs from the in-memory buffer."""
    logs = list(in_memory_log_handler.buffer)[-limit:]
    return {"logs": logs, "total_buffered": len(in_memory_log_handler.buffer)}

@app.websocket("/ws/room/{room_id}")
async def room_websocket(websocket: WebSocket, room_id: str):
    await websocket_room_handler(websocket, room_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
