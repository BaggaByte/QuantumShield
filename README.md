# 🛡️ QuantumShield — Hybrid Post-Quantum Secure Messaging

> **An interactive, full-stack educational platform demonstrating hybrid classical & post-quantum cryptography (X25519 + ML-KEM-768) defending against Harvest-Now-Decrypt-Later (HNDL) attacks.**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Vite + React](https://img.shields.io/badge/Vite-8.3%20%7C%20React%2019-61DAFB?logo=react&logoColor=black)](https://vitejs.dev)
[![FIPS 203](https://img.shields.io/badge/NIST-FIPS%20203%20(ML--KEM--768)-blue)](https://csrc.nist.gov/pubs/fips/203/final)
[![Tests](https://img.shields.io/badge/Tests-15%20Passing%20(100%25)-success)](https://pytest.org)

---

## 🚀 Key Features

- **Hybrid Post-Quantum Key Exchange:** Combines classical **X25519 ECDH** (RFC 7748) with post-quantum lattice-based **ML-KEM-768** (NIST FIPS 203 / Kyber768).
- **Dual-Secret HKDF Combiner:** Concatenates both shared secrets ($SS_{\text{classical}} \mathbin{\Vert} SS_{\text{pq}}$) into RFC 5869 HKDF-SHA-256 with room session IDs as salt.
- **Symmetric Authenticated Encryption:** AES-256-GCM with fresh 96-bit random IVs and Associated Authenticated Data (AAD) binding.
- **Interactive Secure Chat:** Two-tab peer-to-peer style live chat with real-time handshake stepper, wire inspection modal, and message integrity verification.
- **Simulated Quantum Interceptor:** Live simulation demonstrating **Harvest Now, Decrypt Later (HNDL)** attacks — showing how classical sessions are compromised by Shor's algorithm while hybrid sessions remain secure.
- **Crypto Explorer Lab:** Step-by-step key generation, encapsulation, decapsulation, and live hexadecimal inspector with mathematical explanations.
- **Benchmark & Performance Lab:** In-browser microbenchmarks measuring computation time (keygen, encaps, decaps, HKDF, AES) and payload overhead (key sizes, wire bandwidth) with JSON/CSV export.
- **Automated Security Test Suite:** 11 built-in security tests verifying key agreement, ciphertext tamper detection, tag truncation, replay protection, and zero key storage.
- **Zero-Trust Relay Server:** Ephemeral in-memory FastAPI WebSocket rooms that never log, store, or inspect plaintexts or keys.

---

## 📐 Architecture & Key Exchange Flow

```
Alice (Initiator)                               Bob (Responder)
  │                                               │
  ├─ Generate X25519 (sk_A, pk_A)                 │
  ├─ Handshake Init (pk_A) ──────────────────────>│
  │                                               ├─ Generate X25519 (sk_B, pk_B)
  │                                               ├─ Generate ML-KEM-768 (sk_kem, pk_kem)
  │                                               ├─ Compute X25519 SS: X25519(sk_B, pk_A)
  │                                               ├─ Encapsulate ML-KEM: Encaps(pk_kem)
  │                                               ├─ HKDF(SS_classical || SS_pq) -> Key
  │<──────────────────── Handshake Resp (pk_B, ct)┤
  ├─ Compute X25519 SS: X25519(sk_A, pk_B)        │
  ├─ Decapsulate ML-KEM: Decaps(ct, sk_kem)       │
  ├─ HKDF(SS_classical || SS_pq) -> Key          │
  │                                               │
  │════════════════ SECURE SESSION ESTABLISHED ═══│
  ├─ AES-256-GCM Encrypted Message ─────────────>├─ Decrypt & Verify Tag
```

---

## 📦 Project Structure

```
crypto/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI application, CORS, routers
│   │   ├── config.py        # Configuration settings
│   │   ├── relay.py         # Room manager & WebSocket message forwarding
│   │   └── schemas.py       # Pydantic models for envelopes and handshake
│   ├── tests/
│   │   └── test_backend.py  # 15 comprehensive unit & integration tests
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── crypto/
│   │   │   └── hybrid.ts    # X25519, ML-KEM-768, HKDF, AES-256-GCM implementation
│   │   ├── hooks/
│   │   │   └── useSecureSession.ts # State machine for connection & crypto
│   │   ├── pages/
│   │   │   ├── OverviewPage.tsx    # High-level architecture & posture
│   │   │   ├── ChatPage.tsx        # Live secure chat & quantum attack simulation
│   │   │   ├── ExplorerPage.tsx    # Step-by-step crypto breakdown & hex inspect
│   │   │   ├── BenchmarkPage.tsx   # Latency & size benchmarking suite
│   │   │   └── SecurityTestPage.tsx# 11 automated in-browser security tests
│   │   ├── services/
│   │   │   └── api.ts       # REST client for backend relay
│   │   ├── types/
│   │   │   └── index.ts     # TypeScript interface definitions
│   │   ├── App.tsx          # Main shell with sidebar navigation
│   │   └── index.css        # Tailwind directives & glassmorphic styling
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── docs/
│   ├── ARCHITECTURE.md      # Detailed system architecture and state machine
│   ├── CRYPTOGRAPHY.md      # Mathematical foundations & NIST FIPS 203 details
│   └── SECURITY_ANALYSIS.md # Threat model, HNDL analysis, forward secrecy
├── scripts/
│   ├── run_dev.ps1          # Single-command launcher (PowerShell)
│   ├── run_dev.sh           # Single-command launcher (Bash)
│   ├── run_tests.ps1        # Test suite executor (PowerShell)
│   └── run_tests.sh         # Test suite executor (Bash)
└── README.md
```

---

## ⚡ Quickstart

### Prerequisites
- **Python 3.10+**
- **Node.js 18+ & npm**

### 1. Launch Everything in One Command

**Windows (PowerShell):**
```powershell
.\scripts\run_dev.ps1
```

**Linux / macOS (Bash):**
```bash
chmod +x scripts/*.sh
./scripts/run_dev.sh
```

---

### 2. Manual Startup (Alternative)

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
- API is available at `http://localhost:8000`
- Swagger Interactive Docs at `http://localhost:8000/docs`

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```
- Web Application is available at `http://localhost:5173`

---

## 🧪 Running Tests

### Execute All Automated Tests
**Windows:**
```powershell
.\scripts\run_tests.ps1
```

**Linux / macOS:**
```bash
./scripts/run_tests.sh
```

### Backend Test Results
```
tests/test_backend.py::test_health_endpoint PASSED                       [  6%]
tests/test_backend.py::test_create_room PASSED                           [ 13%]
tests/test_backend.py::test_get_nonexistent_room PASSED                  [ 20%]
tests/test_backend.py::test_get_created_room PASSED                      [ 26%]
tests/test_backend.py::test_room_manager_create PASSED                   [ 33%]
tests/test_backend.py::test_room_manager_max_rooms PASSED                [ 40%]
tests/test_backend.py::test_room_not_full_initially PASSED               [ 46%]
tests/test_backend.py::test_room_isolation PASSED                        [ 53%]
tests/test_backend.py::test_room_full_after_two_join PASSED              [ 60%]
tests/test_backend.py::test_join_full_room_raises PASSED                 [ 66%]
tests/test_backend.py::test_leave_room_cleanup PASSED                    [ 73%]
tests/test_backend.py::test_participant_roles PASSED                     [ 80%]
tests/test_backend.py::test_security_status PASSED                       [ 86%]
tests/test_backend.py::test_benchmark_config PASSED                      [ 93%]
tests/test_backend.py::test_server_does_not_store_keys PASSED            [100%]
======================== 15 passed in 1.98s ========================
```

---

## 🔬 In-Browser Educational Modules

1. **Secure Chat:** Open two browser windows (or tabs) connecting to the same Room ID. Watch the handshake execute in real time, view raw JSON frames, and simulate a quantum adversary attempting to decrypt classical vs hybrid messages.
2. **Crypto Explorer:** Inspect every step of the cryptographic pipeline with live hex inspection of public keys, secret keys, encapsulated ciphertexts, and HKDF output.
3. **Benchmark Lab:** Run live benchmarks in your browser comparing keygen time, encapsulation time, and payload sizes between Classical and Hybrid modes.
4. **Security Test Suite:** Run 11 client-side unit tests directly in your browser with pass/fail indicators and latency measurements.

---

## ⚠️ Disclaimer

QuantumShield is an **educational prototype** created to demonstrate the mechanics and threat model of hybrid post-quantum cryptography. It is **not** intended for production or classified communications.
