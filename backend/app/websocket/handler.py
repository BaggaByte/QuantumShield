"""
QuantumShield Backend - WebSocket Handler
Routes handshake and encrypted messages between participants.
The server processes only routing metadata; message content is opaque ciphertext.
"""
import json
import logging
import time
from fastapi import WebSocket, WebSocketDisconnect
from app.rooms.manager import room_manager

logger = logging.getLogger("quantumshield.websocket")

MAX_MESSAGE_BYTES = 65536

async def websocket_room_handler(websocket: WebSocket, room_id: str):
    await websocket.accept()
    room = None
    participant = None

    try:
        # Validate room exists before joining
        existing_room = room_manager.get_room(room_id)
        if existing_room is None:
            await websocket.send_json({"type": "error", "message": f"Room {room_id} not found"})
            await websocket.close(code=4004)
            return

        if existing_room.is_full():
            await websocket.send_json({"type": "error", "message": "Room is full (max 2 participants)"})
            await websocket.close(code=4003)
            return

        room, participant = room_manager.join_room(room_id, websocket)

        # Notify the joining participant of their role and room info
        await websocket.send_json({
            "type": "room_joined",
            "room_id": room.room_id,
            "participant_id": participant.participant_id,
            "role": participant.role,
            "participant_count": room.participant_count(),
        })

        # Notify the other participant that someone joined
        other = room.get_other_participant(participant.participant_id)
        if other:
            await other.websocket.send_json({
                "type": "peer_joined",
                "participant_count": room.participant_count(),
                "peer_role": participant.role,
            })

        # Main message loop
        async for raw in websocket.iter_text():
            if len(raw.encode()) > MAX_MESSAGE_BYTES:
                await websocket.send_json({"type": "error", "message": "Message too large"})
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type", "")

            # Relay handshake, encrypted messages, and delivery acknowledgments to the peer
            if msg_type in ("handshake_offer", "handshake_answer", "handshake_complete",
                            "encrypted_message", "message_ack", "ping"):
                current_room = room_manager.get_room(room_id)
                if current_room:
                    peer = current_room.get_other_participant(participant.participant_id)
                    if peer:
                        # Tag with sender id for recipient to verify
                        msg["from"] = participant.participant_id
                        msg["relayed_at"] = time.time()
                        await peer.websocket.send_json(msg)
                    else:
                        await websocket.send_json({"type": "error", "message": "Peer not connected"})

            elif msg_type == "set_crypto_mode":
                mode = msg.get("mode")
                if mode in ("classical", "hybrid"):
                    current_room = room_manager.get_room(room_id)
                    if current_room:
                        current_room.crypto_mode = mode
                    await websocket.send_json({"type": "mode_accepted", "mode": mode})
                else:
                    await websocket.send_json({"type": "error", "message": "Invalid mode"})

            elif msg_type == "handshake_done":
                current_room = room_manager.get_room(room_id)
                if current_room:
                    current_room.handshake_complete = True
                    # Notify both participants
                    for p in current_room.participants.values():
                        await p.websocket.send_json({
                            "type": "session_established",
                            "mode": current_room.crypto_mode,
                            "room_id": room_id,
                        })

            elif msg_type == "pong":
                pass  # Ignore pong responses

            else:
                await websocket.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: participant={participant.participant_id if participant else 'unknown'}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
    finally:
        if room and participant:
            updated_room = room_manager.leave_room(room_id, participant.participant_id)
            if updated_room:
                # Notify remaining participant
                remaining = list(updated_room.participants.values())
                if remaining:
                    await remaining[0].websocket.send_json({
                        "type": "peer_left",
                        "participant_count": updated_room.participant_count(),
                    })
