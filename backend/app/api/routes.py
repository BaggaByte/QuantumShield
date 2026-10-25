"""
QuantumShield Backend - API Routes
REST endpoints for room management, health, benchmarks, and security status.
"""
import time
import platform
import sys
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.rooms.manager import room_manager
from app.config import settings
from app.push import push_manager

logger = logging.getLogger("quantumshield.api")
router = APIRouter()
_start_time = time.time()

# --- Models ------------------------------------------------------------------

class VapidKeyResponse(BaseModel):
    public_key: str

class PushSubscribeRequest(BaseModel):
    room_id: str
    participant_id: str
    subscription: dict

class PushUnsubscribeRequest(BaseModel):
    room_id: str
    participant_id: str

class RoomResponse(BaseModel):
    room_id: str
    participants: int
    crypto_mode: Optional[str]
    handshake_complete: bool

class CreateRoomResponse(BaseModel):
    room_id: str
    created: bool

class HealthResponse(BaseModel):
    status: str
    uptime_seconds: float
    version: str
    rooms_active: int

class SecurityStatusResponse(BaseModel):
    server_stores_plaintext: bool
    server_stores_keys: bool
    relay_only: bool
    supported_modes: list[str]
    disclaimer: str

class BenchmarkConfigResponse(BaseModel):
    supported_modes: list[str]
    max_trials: int
    supported_message_sizes: list[int]
    notes: str

# --- Endpoints ---------------------------------------------------------------

from collections import defaultdict
from fastapi import Request

_ip_room_creations: dict[str, list[float]] = defaultdict(list)

@router.get("/health", response_model=HealthResponse, tags=["system"])
async def health():
    return HealthResponse(
        status="ok",
        uptime_seconds=round(time.time() - _start_time, 2),
        version=settings.app_version,
        rooms_active=room_manager.room_count(),
    )

@router.post("/rooms", response_model=CreateRoomResponse, tags=["rooms"])
async def create_room(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    
    # Rate limit: prune timestamps older than 60s
    recent = [t for t in _ip_room_creations[client_ip] if now - t < 60.0]
    if len(recent) >= settings.rate_limit_rooms_per_min:
        logger.warning(f"Rate limit exceeded for room creation from IP {client_ip}")
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Maximum {settings.rate_limit_rooms_per_min} rooms per minute."
        )
    
    recent.append(now)
    _ip_room_creations[client_ip] = recent

    try:
        room = room_manager.create_room(
            unjoined_ttl=float(settings.unjoined_room_ttl_seconds),
            max_ttl=float(settings.room_ttl_seconds),
        )
        return CreateRoomResponse(room_id=room.room_id, created=True)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

@router.get("/rooms/{room_id}", response_model=RoomResponse, tags=["rooms"])
async def get_room(room_id: str):
    room = room_manager.get_room(
        room_id,
        unjoined_ttl=float(settings.unjoined_room_ttl_seconds),
        max_ttl=float(settings.room_ttl_seconds),
    )
    if not room:
        raise HTTPException(status_code=404, detail=f"Room {room_id} not found")
    return RoomResponse(
        room_id=room.room_id,
        participants=room.participant_count(),
        crypto_mode=room.crypto_mode,
        handshake_complete=room.handshake_complete,
    )

@router.get("/api/security/status", response_model=SecurityStatusResponse, tags=["security"])
async def security_status():
    return SecurityStatusResponse(
        server_stores_plaintext=False,
        server_stores_keys=False,
        relay_only=True,
        supported_modes=["classical", "hybrid"],
        disclaimer=(
            "QuantumShield provides hybrid post-quantum end-to-end encrypted messaging combining X25519 and ML-KEM-768. "
            "All cryptographic operations occur client-side in the browser. "
            "The server relays opaque ciphertext only and does not possess session keys or plaintext."
        ),
    )

@router.get("/api/benchmarks/config", response_model=BenchmarkConfigResponse, tags=["benchmarks"])
async def benchmark_config():
    return BenchmarkConfigResponse(
        supported_modes=["classical", "hybrid"],
        max_trials=1000,
        supported_message_sizes=[64, 256, 1024, 4096, 16384],
        notes=(
            "Browser-side benchmarks measure Web Crypto API and noble library performance. "
            "Network simulations (latency, packet loss) are deterministic simulations, not real network conditions. "
            "CPU usage is approximated via performance.now() timing; browser scheduling affects accuracy."
        ),
    )

@router.get("/api/system/info", tags=["system"])
async def system_info():
    return {
        "status": "online",
        "version": settings.app_version,
        "backend": "FastAPI + Uvicorn",
        "crypto_note": "All E2E crypto performed client-side in browser (Web Crypto API + @noble libraries)",
    }

# --- Zero-Knowledge Push Notification Endpoints -----------------------------

@router.get("/api/push/vapid-public-key", response_model=VapidKeyResponse, tags=["push"])
async def get_vapid_public_key():
    """Returns the RFC 8292 VAPID public key for Web Push subscription."""
    return VapidKeyResponse(public_key=push_manager.public_key)

@router.post("/api/push/subscribe", tags=["push"])
async def subscribe_push(req: PushSubscribeRequest):
    """Registers a participant's Web Push subscription for zero-knowledge wake-up signals."""
    success = push_manager.subscribe(req.room_id, req.participant_id, req.subscription)
    if not success:
        raise HTTPException(status_code=400, detail="Invalid push subscription payload")
    return {"status": "subscribed", "room_id": req.room_id}

@router.post("/api/push/unsubscribe", tags=["push"])
async def unsubscribe_push(req: PushUnsubscribeRequest):
    """Removes a participant's Web Push subscription."""
    push_manager.unsubscribe(req.room_id, req.participant_id)
    return {"status": "unsubscribed"}

