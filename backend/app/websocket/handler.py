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
            await websocket.send_json({"type": "error", "message": f"Room is full (max {existing_room.max_participants} participants)"})
            await websocket.close(code=4003)
            return

        room, participant = room_manager.join_room(room_id, websocket)

        # Notify the joining participant of their role, hub id, and full participant roster
        await websocket.send_json({
            "type": "room_joined",
            "room_id": room.room_id,
            "participant_id": participant.participant_id,
            "role": participant.role,
            "hub_id": room.hub_id,
            "participant_count": room.participant_count(),
            "participants": room.get_participants_info(),
        })

        # Broadcast updated participant roster to all other peers in the room
        for other in room.get_other_participants(participant.participant_id):
            await other.websocket.send_json({
                "type": "participant_list",
                "room_id": room.room_id,
                "hub_id": room.hub_id,
                "participant_count": room.participant_count(),
                "participants": room.get_participants_info(),
                "peer_joined": participant.participant_id,
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

            # Set user alias and cryptographic fingerprint for participant roster
            if msg_type == "set_identity":
                participant.alias = str(msg.get("alias", "")).strip()
                participant.fingerprint = str(msg.get("fingerprint", "")).strip()
                current_room = room_manager.get_room(room_id)
                if current_room:
                    roster = current_room.get_participants_info()
                    for p in current_room.participants.values():
                        await p.websocket.send_json({
                            "type": "participant_list",
                            "room_id": room_id,
                            "hub_id": current_room.hub_id,
                            "participant_count": current_room.participant_count(),
                            "participants": roster,
                        })

            # Relay handshake, encrypted messages, and delivery acknowledgments
            elif msg_type in ("handshake_offer", "handshake_answer", "handshake_complete",
                              "encrypted_message", "message_ack", "ping"):
                current_room = room_manager.get_room(room_id)
                if current_room:
                    # Tag with sender id and timestamp for recipient verification
                    msg["from"] = participant.participant_id
                    msg["relayed_at"] = time.time()

                    target = msg.get("to")
                    if target == "hub":
                        target = current_room.hub_id

                    if target and target != "all":
                        # Targeted routing to specific participant
                        peer = current_room.participants.get(target)
                        if peer:
                            await peer.websocket.send_json(msg)
                        else:
                            await websocket.send_json({"type": "error", "message": f"Recipient {target} not connected"})
                    else:
                        # Star broadcast to all other participants
                        for peer in current_room.get_other_participants(participant.participant_id):
                            await peer.websocket.send_json(msg)

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
                    for p in current_room.participants.values():
                        await p.websocket.send_json({
                            "type": "session_established",
                            "mode": current_room.crypto_mode,
                            "room_id": room_id,
                            "hub_id": current_room.hub_id,
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
                # Notify remaining participants with updated roster and hub id
                roster = updated_room.get_participants_info()
                for remaining_p in updated_room.participants.values():
                    await remaining_p.websocket.send_json({
                        "type": "participant_list",
                        "room_id": room_id,
                        "hub_id": updated_room.hub_id,
                        "participant_count": updated_room.participant_count(),
                        "participants": roster,
                        "peer_left": participant.participant_id,
                    })
