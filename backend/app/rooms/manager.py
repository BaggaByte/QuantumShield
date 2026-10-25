"""
QuantumShield Backend - Room Manager
In-memory room management for the secure messaging relay.
The server never sees plaintext or session keys.
"""
import secrets
import uuid
import time
import logging
from typing import Dict, Optional, List
from dataclasses import dataclass, field
from fastapi import WebSocket

logger = logging.getLogger("quantumshield.rooms")

@dataclass
class Participant:
    participant_id: str
    websocket: WebSocket
    connected_at: float = field(default_factory=time.time)
    role: str = "unknown"  # hub | spoke
    alias: str = ""
    fingerprint: str = ""

@dataclass
class Room:
    room_id: str
    created_at: float = field(default_factory=time.time)
    participants: Dict[str, Participant] = field(default_factory=dict)
    crypto_mode: Optional[str] = None  # classical | hybrid
    handshake_complete: bool = False
    hub_id: Optional[str] = None
    max_participants: int = 8

    def is_full(self) -> bool:
        return len(self.participants) >= self.max_participants

    def participant_count(self) -> int:
        return len(self.participants)

    def get_other_participant(self, participant_id: str) -> Optional[Participant]:
        for pid, p in self.participants.items():
            if pid != participant_id:
                return p
        return None

    def get_other_participants(self, participant_id: str) -> List[Participant]:
        return [p for pid, p in self.participants.items() if pid != participant_id]

    def get_participants_info(self) -> List[dict]:
        return [
            {
                "id": p.participant_id,
                "role": p.role,
                "alias": p.alias,
                "fingerprint": p.fingerprint,
                "connected_at": p.connected_at,
            }
            for p in self.participants.values()
        ]

class RoomManager:
    def __init__(self, max_rooms: int = 100):
        self._rooms: Dict[str, Room] = {}
        self._max_rooms = max_rooms

    def cleanup_expired_rooms(self, unjoined_ttl: float = 300.0, max_ttl: float = 3600.0) -> int:
        """Removes unjoined rooms older than unjoined_ttl (5m) and any rooms older than max_ttl (1h)."""
        now = time.time()
        to_delete = []
        for rid, room in self._rooms.items():
            age = now - room.created_at
            if room.participant_count() == 0 and age > unjoined_ttl:
                to_delete.append((rid, f"unjoined for {int(age)}s"))
            elif age > max_ttl:
                to_delete.append((rid, f"exceeded max lifetime of {int(age)}s"))

        for rid, reason in to_delete:
            del self._rooms[rid]
            logger.info(f"Cleaned up expired room {rid} ({reason})")
        return len(to_delete)

    def create_room(self, unjoined_ttl: float = 300.0, max_ttl: float = 3600.0) -> Room:
        self.cleanup_expired_rooms(unjoined_ttl=unjoined_ttl, max_ttl=max_ttl)
        if len(self._rooms) >= self._max_rooms:
            raise RuntimeError("Maximum room count reached")

        for _ in range(10):
            room_id = secrets.token_hex(6).upper()
            if room_id not in self._rooms:
                break
        else:
            room_id = str(uuid.uuid4()).replace("-", "")[:12].upper()

        room = Room(room_id=room_id)
        self._rooms[room_id] = room
        logger.info(f"Room created: {room_id}")
        return room

    def get_room(self, room_id: str, unjoined_ttl: float = 300.0, max_ttl: float = 3600.0) -> Optional[Room]:
        rid = room_id.upper()
        room = self._rooms.get(rid)
        if room:
            age = time.time() - room.created_at
            if (room.participant_count() == 0 and age > unjoined_ttl) or (age > max_ttl):
                del self._rooms[rid]
                logger.info(f"Room {rid} expired during lookup (age={int(age)}s)")
                return None
        return room

    def join_room(self, room_id: str, websocket: WebSocket) -> tuple[Room, Participant]:
        room = self.get_room(room_id)
        if room is None:
            raise ValueError(f"Room {room_id} not found")
        if room.is_full():
            raise ValueError(f"Room {room_id} is full (max {room.max_participants} participants)")
        pid = str(uuid.uuid4())
        role = "hub" if room.participant_count() == 0 else "spoke"
        participant = Participant(participant_id=pid, websocket=websocket, role=role)
        room.participants[pid] = participant
        if role == "hub":
            room.hub_id = pid
        logger.info(f"Participant {pid} ({role}) joined room {room_id} ({room.participant_count()}/{room.max_participants})")
        return room, participant

    def leave_room(self, room_id: str, participant_id: str) -> Optional[Room]:
        room = self.get_room(room_id)
        if room and participant_id in room.participants:
            del room.participants[participant_id]
            logger.info(f"Participant {participant_id} left room {room_id}")
            if room.participant_count() == 0:
                del self._rooms[room_id]
                logger.info(f"Room {room_id} deleted (empty)")
                return None

            # If the hub left, elect the oldest remaining participant as the new hub
            if room.hub_id == participant_id and room.participants:
                new_hub = min(room.participants.values(), key=lambda p: p.connected_at)
                new_hub.role = "hub"
                room.hub_id = new_hub.participant_id
                logger.info(f"Hub failover in room {room_id}: elected {new_hub.participant_id} as new hub")

            room.handshake_complete = False
        return room

    def list_rooms(self) -> List[dict]:
        return [
            {
                "room_id": r.room_id,
                "participants": r.participant_count(),
                "crypto_mode": r.crypto_mode,
                "handshake_complete": r.handshake_complete,
            }
            for r in self._rooms.values()
        ]

    def room_count(self) -> int:
        return len(self._rooms)

room_manager = RoomManager()
