"""
QuantumShield Backend - Zero-Knowledge Web Push Notification Service
Provides RFC 8292 VAPID key management and privacy-preserving push notifications.

Zero-Knowledge Security Contract:
- The server NEVER sends plaintext, room secrets, sender aliases, or message IDs in push payloads.
- Push signals are opaque wake-up triggers: {"title": "QuantumShield", "body": "New encrypted signal received", ...}
- All decryptable contents remain strictly client-side.
"""
import os
import json
import time
import base64
import logging
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid
from pywebpush import webpush, WebPushException

from app.config import settings

logger = logging.getLogger("quantumshield.push")

VAPID_PEM_PATH = Path(__file__).resolve().parent.parent / "vapid_private.pem"


class PushManager:
    """Manages VAPID credentials and room push subscriptions."""

    def __init__(self):
        self._pem_path = str(VAPID_PEM_PATH)
        self._vapid: Optional[Vapid] = None
        self._public_key_b64: str = ""
        # room_id -> {participant_id: subscription_dict}
        self._subscriptions: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self._init_vapid()

    def _init_vapid(self):
        """Initializes or loads VAPID P-256 keys."""
        try:
            if os.path.exists(self._pem_path):
                self._vapid = Vapid.from_file(private_key_file=self._pem_path)
                logger.info(f"Loaded existing VAPID key from {self._pem_path}")
            else:
                self._vapid = Vapid()
                self._vapid.generate_keys()
                with open(self._pem_path, "wb") as f:
                    f.write(self._vapid.private_pem())
                logger.info(f"Generated new VAPID keypair at {self._pem_path}")

            # Export uncompressed P-256 public point (65 bytes) as url-safe base64 without padding
            raw_pub = self._vapid.public_key.public_bytes(
                Encoding.X962, PublicFormat.UncompressedPoint
            )
            self._public_key_b64 = (
                base64.urlsafe_b64encode(raw_pub).decode("utf-8").rstrip("=")
            )
            logger.info("VAPID public key configured successfully")
        except Exception as e:
            logger.error(f"Failed to initialize VAPID manager: {e}")
            raise

    @property
    def public_key(self) -> str:
        """Returns the URL-safe base64 encoded uncompressed P-256 public key for pushManager.subscribe()."""
        return self._public_key_b64

    def subscribe(self, room_id: str, participant_id: str, subscription_info: Dict[str, Any]) -> bool:
        """Registers or updates a Web Push subscription for a participant in a room."""
        if not room_id or not participant_id or not subscription_info:
            return False
        if "endpoint" not in subscription_info:
            return False

        if room_id not in self._subscriptions:
            self._subscriptions[room_id] = {}

        self._subscriptions[room_id][participant_id] = subscription_info
        logger.info(
            f"Registered push subscription for participant {participant_id[:8]} in room {room_id}"
        )
        return True

    def unsubscribe(self, room_id: str, participant_id: str) -> bool:
        """Removes a participant's push subscription."""
        if room_id in self._subscriptions and participant_id in self._subscriptions[room_id]:
            del self._subscriptions[room_id][participant_id]
            if not self._subscriptions[room_id]:
                del self._subscriptions[room_id]
            logger.info(
                f"Unsubscribed push for participant {participant_id[:8]} in room {room_id}"
            )
            return True
        return False

    def remove_room(self, room_id: str):
        """Cleans up all push subscriptions when a room is destroyed."""
        if room_id in self._subscriptions:
            del self._subscriptions[room_id]
            logger.info(f"Cleared all push subscriptions for room {room_id}")

    def get_subscription_count(self, room_id: Optional[str] = None) -> int:
        """Returns the total number of active subscriptions."""
        if room_id:
            return len(self._subscriptions.get(room_id, {}))
        return sum(len(subs) for subs in self._subscriptions.values())

    async def notify_room_background(self, room_id: str, exclude_participant_id: Optional[str] = None):
        """Asynchronously dispatches zero-knowledge push notifications to room subscribers."""
        if room_id not in self._subscriptions:
            return

        subs_to_notify = [
            (pid, sub)
            for pid, sub in self._subscriptions[room_id].items()
            if pid != exclude_participant_id
        ]

        if not subs_to_notify:
            return

        # Pure zero-knowledge payload: NO plaintext, NO sender name, NO room secrets
        payload = json.dumps(
            {
                "title": "QuantumShield",
                "body": "New encrypted signal received",
                "tag": "qs-signal",
                "timestamp": int(time.time() * 1000),
                "room_id": room_id,
            }
        )

        for pid, sub in subs_to_notify:
            asyncio.create_task(self._send_push_async(room_id, pid, sub, payload))

    async def _send_push_async(
        self, room_id: str, participant_id: str, subscription_info: Dict[str, Any], payload: str
    ):
        """Dispatches an individual Web Push notification in a worker thread."""
        try:
            claims = {
                "sub": getattr(settings, "vapid_subject", "mailto:security@quantumshield.local")
            }

            def _sync_send():
                return webpush(
                    subscription_info=subscription_info,
                    data=payload,
                    vapid_private_key=self._pem_path,
                    vapid_claims=claims,
                    ttl=60,
                )

            await asyncio.to_thread(_sync_send)
            logger.debug(f"Push signal dispatched to {participant_id[:8]} in {room_id}")

        except WebPushException as ex:
            # If subscription has expired or unsubscribed, remove it
            status_code = getattr(getattr(ex, "response", None), "status_code", None)
            if status_code in (404, 410):
                logger.info(
                    f"Push subscription for {participant_id[:8]} expired ({status_code}), removing"
                )
                self.unsubscribe(room_id, participant_id)
            else:
                logger.warning(f"WebPush error for {participant_id[:8]}: {ex}")
        except Exception as ex:
            logger.debug(f"Push notification error for {participant_id[:8]}: {ex}")


push_manager = PushManager()
