"""
QuantumShield - Backend Tests
Tests for room management, WebSocket routing, and API endpoints.
Cryptographic correctness is tested client-side in the browser via the Security Test Center.
"""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.main import app
from app.rooms.manager import RoomManager, room_manager

# --- Fixtures -----------------------------------------------------------------

@pytest.fixture(autouse=True)
def fresh_room_manager():
    """Reset the shared room manager before each test."""
    room_manager._rooms.clear()
    yield
    room_manager._rooms.clear()

@pytest.fixture
def client():
    return TestClient(app)

# --- Health Check -------------------------------------------------------------

def test_health_endpoint(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "uptime_seconds" in body
    assert body["version"] == "1.0.0"

# --- Room Management ---------------------------------------------------------

def test_create_room(client):
    r = client.post("/rooms")
    assert r.status_code == 200
    body = r.json()
    assert body["created"] is True
    assert len(body["room_id"]) == 8

def test_get_nonexistent_room(client):
    r = client.get("/rooms/XXXXXXXX")
    assert r.status_code == 404

def test_get_created_room(client):
    create_r = client.post("/rooms")
    room_id = create_r.json()["room_id"]
    get_r = client.get(f"/rooms/{room_id}")
    assert get_r.status_code == 200
    body = get_r.json()
    assert body["room_id"] == room_id
    assert body["participants"] == 0
    assert body["handshake_complete"] is False

def test_room_manager_create():
    rm = RoomManager(max_rooms=5)
    room = rm.create_room()
    assert room is not None
    assert len(room.room_id) == 8
    assert rm.room_count() == 1

def test_room_manager_max_rooms():
    rm = RoomManager(max_rooms=2)
    rm.create_room()
    rm.create_room()
    with pytest.raises(RuntimeError, match="Maximum room count"):
        rm.create_room()

def test_room_not_full_initially():
    rm = RoomManager()
    room = rm.create_room()
    assert not room.is_full()
    assert room.participant_count() == 0

def test_room_isolation():
    """Participants in different rooms cannot receive each other's data."""
    rm = RoomManager()
    room_a = rm.create_room()
    room_b = rm.create_room()
    
    ws_a1 = AsyncMock()
    ws_b1 = AsyncMock()
    
    r_a, p_a1 = rm.join_room(room_a.room_id, ws_a1)
    r_b, p_b1 = rm.join_room(room_b.room_id, ws_b1)
    
    # Each room has its own participants
    assert room_a.get_other_participant(p_a1.participant_id) is None
    assert room_b.get_other_participant(p_b1.participant_id) is None
    
    # Participant in room A cannot access room B's data
    assert rm.get_room(room_a.room_id) is not rm.get_room(room_b.room_id)

def test_room_full_after_two_join():
    rm = RoomManager()
    room = rm.create_room()
    ws1, ws2 = AsyncMock(), AsyncMock()
    rm.join_room(room.room_id, ws1)
    rm.join_room(room.room_id, ws2)
    assert room.is_full()

def test_join_full_room_raises():
    rm = RoomManager()
    room = rm.create_room()
    ws1, ws2, ws3 = AsyncMock(), AsyncMock(), AsyncMock()
    rm.join_room(room.room_id, ws1)
    rm.join_room(room.room_id, ws2)
    with pytest.raises(ValueError, match="full"):
        rm.join_room(room.room_id, ws3)

def test_leave_room_cleanup():
    rm = RoomManager()
    room = rm.create_room()
    ws = AsyncMock()
    _, p = rm.join_room(room.room_id, ws)
    updated = rm.leave_room(room.room_id, p.participant_id)
    # Room deleted when empty
    assert updated is None
    assert rm.get_room(room.room_id) is None

def test_participant_roles():
    rm = RoomManager()
    room = rm.create_room()
    ws1, ws2 = AsyncMock(), AsyncMock()
    _, p1 = rm.join_room(room.room_id, ws1)
    _, p2 = rm.join_room(room.room_id, ws2)
    assert p1.role == "initiator"
    assert p2.role == "responder"

# --- Security Status ---------------------------------------------------------

def test_security_status(client):
    r = client.get("/api/security/status")
    assert r.status_code == 200
    body = r.json()
    assert body["server_stores_plaintext"] is False
    assert body["server_stores_keys"] is False
    assert body["relay_only"] is True
    assert "classical" in body["supported_modes"]
    assert "hybrid" in body["supported_modes"]

# --- Benchmark Config ---------------------------------------------------------

def test_benchmark_config(client):
    r = client.get("/api/benchmarks/config")
    assert r.status_code == 200
    body = r.json()
    assert "classical" in body["supported_modes"]
    assert "hybrid" in body["supported_modes"]
    assert body["max_trials"] > 0
    assert len(body["supported_message_sizes"]) > 0

# --- Crypto Design Constraints -----------------------------------------------

def test_server_does_not_store_keys():
    """The server has no key storage; verify at code level."""
    import app.rooms.manager as rm_module
    import app.websocket.handler as ws_module
    import inspect
    
    room_src = inspect.getsource(rm_module)
    ws_src = inspect.getsource(ws_module)
    
    # These terms should not appear in server-side code
    forbidden_terms = ["aes_key", "session_key", "private_key", "plaintext_message"]
    for term in forbidden_terms:
        assert term not in room_src, f"Forbidden term '{term}' found in room manager"
        assert term not in ws_src, f"Forbidden term '{term}' found in websocket handler"
