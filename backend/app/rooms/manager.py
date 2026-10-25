"""
QuantumShield Backend - Room Manager
In-memory room management for the secure messaging relay.
The server never sees plaintext or session keys.
"""
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

    def create_room(self) -> Room:
        if len(self._rooms) >= self._max_rooms:
            raise RuntimeError("Maximum room count reached")
        room_id = str(uuid.uuid4())[:8].upper()
        room = Room(room_id=room_id)
        self._rooms[room_id] = room
        logger.info(f"Room created: {room_id}")
        return room

    def get_room(self, room_id: str) -> Optional[Room]:
        return self._rooms.get(room_id.upper())

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
