# 🛡️ QuantumShield — Post-Quantum Secure Messenger

> **The world's only messenger where not even a quantum computer in 2050 can decrypt your past messages — and you don't need a phone number or email to prove it.**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.128-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Vite + React](https://img.shields.io/badge/Vite-8.3%20%7C%20React%2019-61DAFB?logo=react&logoColor=black)](https://vitejs.dev)
[![NIST FIPS 203](https://img.shields.io/badge/NIST-FIPS%20203%20(ML--KEM--768)-blue)](https://csrc.nist.gov/pubs/fips/203/final)
[![Tests](https://img.shields.io/badge/Tests-17%20Passing%20(100%25)-success)](https://pytest.org)
[![PWA](https://img.shields.io/badge/PWA-Installable%20%7C%20Web%20Push-purple)](https://web.dev/progressive-web-apps/)
[![License](https://img.shields.io/badge/License-Proprietary%20%E2%80%94%20All%20Rights%20Reserved-red)](./LICENSE)

---

## 🌟 The Core Breakthrough

Mainstream messaging platforms such as WhatsApp and Telegram rely on classical Elliptic Curve Diffie-Hellman (Curve25519). Today, nation-state adversaries execute **Harvest Now, Decrypt Later (HNDL)** attacks—recording encrypted network traffic in bulk to decrypt in the future using **Shor's Algorithm** on a quantum computer. While Signal pioneered PQXDH for native mobile clients in late 2023, it still requires mandatory phone number registration and centralized directory infrastructure.

**QuantumShield brings hybrid post-quantum secrecy directly to browser PWAs:**
1. **Hybrid Post-Quantum Key Exchange:** Combines classical X25519 with **NIST FIPS 203 ML-KEM-768** (Module-Lattice Key Encapsulation). An attacker must break *both* discrete logarithms and high-dimensional lattice hardness simultaneously.
2. **Identity Without Accounts:** No phone number, no email, no PII. Identity is an in-browser **Ed25519 signing keypair** (`QS·XXXX·XXXX`) portable via QR code.
3. **Zero-Knowledge Ephemeral Relay:** The server never stores messages, keys, or user directories. All messages and file chunks are encrypted with **AES-256-GCM** before leaving your browser.
4. **Client-Side Hardware Vault at Rest:** Chat history is stored strictly on your device inside an IndexedDB vault encrypted with an AES-256-GCM key derived from your private identity key.
5. **WhatsApp Web Ergonomics:** A pure, production-grade dual-pane layout featuring real-time delivery double checkmarks (`✓`/`✓✓` cyan), vector circuit doodle wallpaper, audio/haptic feedback, and encrypted file streaming.

---

## 📊 Architectural Comparison

| Dimension | Classical Apps (Telegram, Slack) | Signal (PQXDH Mobile) | WhatsApp | **QuantumShield** |
| :--- | :--- | :--- | :--- | :--- |
| **Quantum Immunity (HNDL)** | ❌ Broken (RSA/ECC vulnerable) | ✅ Hybrid PQXDH (Kyber-1024) | ❌ Classical ECC vulnerable | ✅ **Quantum-Safe** (Dual-HKDF X25519 + NIST ML-KEM-768) |
| **Identity & Account Model** | ❌ Email / Username / Phone | ❌ **Mandatory Phone Number / SIM** | ❌ **Mandatory Phone Number** | ✅ **Zero Accounts** (Ed25519 keypair, QR export) |
| **Server Persistence** | ❌ Plaintext or cloud database | ⚠️ Server queues until delivered | ⚠️ Server queues + cloud backups | ✅ **Zero Server Persistence** (Ephemeral relay only) |
| **Encrypted History at Rest** | ❌ Cloud archives | ⚠️ SQLite on device | ⚠️ Unencrypted cloud backups | ✅ **Client AES-256-GCM Vault** in IndexedDB |
| **Group Chat Architecture** | ❌ Server manages and inspects | ⚠️ Server routes fanout via sender keys | ⚠️ Server routes fanout | ✅ **Client-Side Star Topology** (In-browser Hub re-encryption) |
| **Push Notification Privacy** | ❌ Plaintext / sender leaks | ⚠️ Leaks metadata to APNs/FCM | ⚠️ Leaks metadata to APNs/FCM | ✅ **Zero-Knowledge VAPID Push** (Opaque wake-up signals) |
| **Distribution & Platform** | ❌ Centralized corporate silos | ❌ Native iOS/Android app | ❌ Bound to App Stores | ✅ **Standalone PWA** (Runs in any modern browser) |
| **Deployment Mode** | Cloud-hosted | Cloud-hosted | Cloud-hosted | ✅ **Self-Hostable / Zero-Config Docker** |

---

## 🚀 Key Features & Capabilities

### 1. Cryptographic Identity Without Accounts
- **In-Browser Key Generation:** On first launch, the browser generates an **Ed25519 signing keypair** using the native Web Crypto API.
- **Readable Fingerprint:** Your public key is represented by a compact, human-readable fingerprint badge (e.g. `QS·4A2F·B91C`).
- **Seamless Portability:** Export and import your identity across mobile and desktop devices via **encrypted QR codes** or JSON envelopes.
- **Custom Local Alias:** Optional display name stored locally alongside your identity keypair without syncing to any central directory.

### 2. WhatsApp Web Dual-Pane Interface
- **60-30-10 Color Psychology:** Deep obsidian canvas (`#080E14`), slate neutrals (`#111C24` / `#202C33`), and vibrant WhatsApp emerald (`#00A884`) / cyan (`#53BDEB`).
- **Vector Circuit Doodle Wallpaper:** Abstract, high-tech SVG background pattern embedded directly in CSS without external image dependencies.
- **Instant Search & Filter Chips:** Real-time conversation filtering (`All Chats`, `Active Rooms`, `Encrypted Vault`). Typing an 8-character code surfaces a 1-click **Join Room** prompt.
- **Real-Time Delivery Acknowledgments:** Single grey tick `✓` when relayed to the server, and double cyan ticks `✓✓` when acknowledged by the recipient's browser.

### 3. Star Topology Group Messaging (Up to 8 Participants)
- **Ephemeral Hub Election:** The first participant to enter a room is elected the group's in-browser **Hub**.
- **Bilateral Post-Quantum Handshakes:** The Hub negotiates separate hybrid post-quantum sessions with every connected spoke.
- **In-Browser Re-Encryption:** When a spoke transmits a message or file chunk, the Hub decrypts it locally and re-encrypts it for each recipient spoke. The central server sees only opaque ciphertexts.
- **Automatic Failover:** If the Hub disconnects, the remaining participants automatically elect a successor Hub.

### 4. Encrypted File & Image Streaming
- **32KB Chunk Streaming:** Files are sliced, encrypted with AES-256-GCM bound to sequence numbers, and streamed via WebSockets.
- **SHA-256 Digest Verification:** The entire file hash is verified client-side before assembling the file into an in-memory Blob URL.
- **Drag-and-Drop & Inline Preview:** Drop files directly onto the chat canvas; view image previews with click-to-zoom modals and download documents directly.

### 5. Progressive Web App (PWA) & Zero-Knowledge Push Notifications
- **Installable Desktop & Mobile App:** Fully compliant with PWA criteria (`manifest.json`, standalone display, 192px/512px maskable icons).
- **Service Worker Caching:** Offline app shell precaching with network-first fallback (`sw.js`).
- **RFC 8292 VAPID Push Protocol:** Automated NIST P-256 VAPID keypair lifecycle on the FastAPI backend.
- **Zero-Knowledge Signal Guarantee:** Third-party push services (Apple APNs / Google FCM) receive only an opaque wake-up ping (`{"title": "QuantumShield", "body": "New encrypted signal received"}`). Push services have zero access to sender identities, room codes, or message contents.

---

## 📐 Hybrid Cryptographic Pipeline

```
Alice (Initiator)                                            Bob (Responder)
  │                                                            │
  ├─ 1. Generate X25519 (sk_A, pk_A)                           │
  ├─ 2. Handshake Offer (pk_A) ───────────────────────────────>│
  │                                                            ├─ 3. Generate X25519 (sk_B, pk_B)
  │                                                            ├─ 4. Generate ML-KEM-768 (sk_kem, pk_kem)
  │                                                            ├─ 5. Compute X25519 SS: X25519(sk_B, pk_A)
  │                                                            ├─ 6. Encapsulate ML-KEM: Encaps(pk_kem)
  │                                                            ├─ 7. HKDF-SHA-256(SS_classical || SS_pq) -> Key_B
  │<─────────────────── Handshake Answer (pk_B, ct)────────────┤
  ├─ 8. Compute X25519 SS: X25519(sk_A, pk_B)                  │
  ├─ 9. Decapsulate ML-KEM: Decaps(ct, sk_kem)                 │
  ├─ 10. HKDF-SHA-256(SS_classical || SS_pq) -> Key_A          │
  │                                                            │
  │══════════════════ POST-QUANTUM SECURE SESSION ESTABLISHED ═│
  │                                                            │
  ├─ 11. AES-256-GCM Encrypted Message / File Chunk ──────────>├─ 12. Decrypt & Verify AAD
  │<─────────────────── Delivery ACK (Double Cyan Ticks ✓✓)─────┤
```

---

## 📦 Project Structure

```
crypto/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   └── routes.py         # REST endpoints (rooms, health, VAPID push)
│   │   ├── rooms/
│   │   │   └── manager.py        # Ephemeral room manager & Hub election
│   │   ├── websocket/
│   │   │   └── handler.py        # WebSocket routing (messages, files, acks)
│   │   ├── config.py             # Server settings & origins
│   │   ├── push.py               # RFC 8292 VAPID push notification manager
│   │   └── main.py               # FastAPI lifespan & WebSocket mounting
│   ├── tests/
│   │   └── test_backend.py       # 17 comprehensive automated unit tests
│   └── requirements.txt          # Python dependencies (FastAPI, cryptography, pywebpush)
├── frontend/
│   ├── public/
│   │   ├── manifest.json         # PWA Web App Manifest
│   │   ├── sw.js                 # Service worker (offline cache & push)
│   │   ├── icon-192.png          # High-resolution 192px PWA maskable icon
│   │   ├── icon-512.png          # High-resolution 512px PWA maskable icon
│   │   └── favicon.svg           # QuantumShield vector favicon
│   ├── src/
│   │   ├── crypto/
│   │   │   └── hybrid.ts         # X25519, ML-KEM-768, HKDF, AES-256-GCM
│   │   ├── hooks/
│   │   │   ├── useIdentity.ts    # Identity hook (alias, export, reset)
│   │   │   └── useSecureSession.ts # E2E post-quantum state machine & re-encryption
│   │   ├── services/
│   │   │   ├── api.ts            # REST client & WebSocket factory
│   │   │   ├── IdentityService.ts# Ed25519 keypair & QR export
│   │   │   ├── StorageService.ts # Client AES-256-GCM IndexedDB vault
│   │   │   ├── FileTransferService.ts # 32KB chunk streaming & SHA-256 digest
│   │   │   └── PushNotificationService.ts # Service worker & Web Push manager
│   │   ├── components/
│   │   │   ├── IdentityCard.tsx  # Profile card & QR export modal
│   │   │   └── IdentitySetup.tsx # First-time onboarding wizard
│   │   ├── pages/
│   │   │   └── ChatPage.tsx      # WhatsApp Web dual-pane workspace
│   │   ├── types/
│   │   │   └── index.ts          # Strict TypeScript interface definitions
│   │   ├── App.tsx               # Production application entry point
│   │   └── index.css             # WhatsApp color system & vector doodle pattern
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── docs/
│   ├── ARCHITECTURE.md           # System design & Star Topology state machine
│   ├── CRYPTOGRAPHY.md           # Mathematical proofs & NIST FIPS 203 details
│   └── SECURITY_ANALYSIS.md      # Threat model, HNDL analysis, forward secrecy
├── LICENSE                       # Proprietary All Rights Reserved license
└── README.md
```

---

## ⚡ Quickstart

### Prerequisites
- **Python 3.10+**
- **Node.js 18+ & npm**
- *(Optional)* **Docker & Docker Compose**

---

### 🐳 Option 1: Docker Compose (Zero-Configuration)

Runs both the backend relay and the frontend client simultaneously in lightweight containers:

```bash
docker compose up --build
```

- **Frontend Web App (PWA):** [http://localhost:5173](http://localhost:5173)
- **Backend API Docs (Swagger):** [http://localhost:8001/docs](http://localhost:8001/docs)
- **Healthcheck Endpoint:** [http://localhost:8001/health](http://localhost:8001/health)

To shut down:
```bash
docker compose down
```

---

### 💻 Option 2: Local Installation (Manual)

#### 1. Start the Backend Relay:
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

#### 2. Start the Frontend PWA:
```bash
cd frontend
npm install
npm run dev
```

Visit **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## 🧪 Automated Testing

### Backend Test Suite (Pytest)
```bash
cd backend
python -m pytest tests/test_backend.py -v
```
```
======================== 17 passed in 2.61s ========================
```

### Frontend Type Safety & Production Build
```bash
cd frontend
npx tsc --noEmit
npm run build
```
```
✓ built in 4.80s (dist/assets/index.js 357 kB)
```

---

## 📄 License & Intellectual Property

**Copyright (c) 2026 BaggaByte. All Rights Reserved.**

This software is protected under a **Proprietary All Rights Reserved License**.
- Viewing the source code is permitted for reference and audit purposes.
- Copying, cloning, distributing, sublicensing, or commercially exploiting any part of this software without prior written authorization from the copyright holder is **strictly prohibited**.

See the full terms in the [LICENSE](./LICENSE) file.
