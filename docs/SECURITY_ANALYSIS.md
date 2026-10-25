# QuantumShield — Security Analysis & Threat Model

## 1. Threat Model & Adversary Assumptions

QuantumShield evaluates security against two distinct adversary classes:

### Adversary A: Passive Eavesdropper with Storage ("Harvest Now, Decrypt Later")
- **Capabilities:** Can intercept and record all encrypted packets exchanged over the network and WebSocket connections. Currently possesses standard classical computing power.
- **Future Capabilities:** At an unknown point in the future (e.g., $T + 10$ to $T + 20$ years), the adversary gains access to a Cryptanalytically Relevant Quantum Computer (CRQC) capable of executing Shor's Algorithm.
- **Attack Goal:** Retrospectively decrypt stored historical communications.
- **QuantumShield Defense:** Traffic encrypted under the **Hybrid** mode combines X25519 with ML-KEM-768. Even if Shor's algorithm solves the classical ECDH discrete logarithm, the session key remains protected by the quantum-resistant lattice problem. Retrospective decryption fails.

### Adversary B: Active Man-in-the-Middle (MitM) & Malicious Relay
- **Capabilities:** Controls the WebSocket relay server, can inspect routing headers, delay packets, drop packets, alter ciphertexts, or attempt to substitute ephemeral handshake keys.
- **Limitations:** Cannot break the underlying symmetric cipher (AES-256-GCM) without the session key.
- **QuantumShield Defense:**
  - **Authenticated Handshake:** Ephemeral public keys are signed by each participant's Ed25519 identity key. Handshake offers from unauthenticated peers or rogue spokes are rejected.
  - **Out-of-Band Key Verification (SAS):** Users can cross-verify safety numbers and deterministic Safety Emojis generated from the derived session key to ensure no relay has intercepted the exchange.
  - **Transcript Binding:** HKDF derives the session key by binding the complete transcript—including initiator/responder public keys and the ML-KEM ciphertext.
  - **Ciphertext Tampering:** GCM authentication tag covers both ciphertext and Associated Data (`aad`). Modifying a single bit causes decryption to abort.
  - **Replay Attacks:** Each message carries a unique `message_id` and monotonic sequence number tracked in a client-side deduplication set. Replayed or out-of-order messages are detected and rejected.
  - **Session Confusion:** Associated Data binds the specific `session_id` and `room_id` to every ciphertext. Messages cannot be cross-injected into other active sessions.

---

## 2. Key Lifecycles & Storage Model

- **Ephemeral Handshake Keypairs:** Single-use ephemeral keypairs for X25519 and ML-KEM-768 are generated in volatile memory per session. Ephemeral private keys are actively zeroized (`zeroizeBytes`) immediately following session key derivation.
- **Session Keys:** Symmetric AES-256-GCM session keys exist solely in browser memory and are wiped on session disconnect or tab closure.
- **Long-Term Identity Keypair:** The user's Ed25519 signing keypair is retained in browser local origin storage (`localStorage`) protected by browser origin isolation and a strict Content Security Policy (CSP). Deleting the identity erases the keypair permanently.
- **History at Rest:** Stored chat messages and room history in IndexedDB are client-side encrypted under AES-256-GCM using a storage key deterministically derived from the private identity key with domain-separated salt.
- **Zero Server-Side State:** The FastAPI relay maintains only volatile, in-memory WebSocket connections in ephemeral rooms. Keys and message plaintext never touch server disk, memory caches, or server logs.

---

## 3. Group Messaging & Star Topology Trust Model

In direct two-party rooms, end-to-end encryption is strictly bilateral between the two peers.

In multi-participant rooms (3+ peers), QuantumShield utilizes a client-side **Star-Hub Topology**:
1. The room creator serves as the ephemeral **Client Hub**.
2. Each participant ("Spoke") establishes an authenticated hybrid session key directly with the Hub.
3. All messages and file chunks are relayed via the client Hub, which decrypts from the sender's bilateral key and re-encrypts client-side for each recipient spoke.
4. **Trust Boundary:** The server relay remains zero-knowledge at all times, seeing only opaque ciphertexts. Within the room, participants trust the room's elected client Hub to faithfully re-encrypt without altering content.

---

## 4. Grover's Algorithm & Symmetric Key Sizing

Grover's Quantum Search algorithm provides a quadratic speedup for searching unstructured databases and brute-forcing symmetric keys:

$$T_{\text{Grover}} = \mathcal{O}\left( \sqrt{2^k} \right) = 2^{k/2}$$

- A 128-bit symmetric key is reduced to 64 bits of effective quantum security.
- **QuantumShield Selection:** QuantumShield mandates **AES-256-GCM**. Under Grover's algorithm, AES-256 retains **128 bits of post-quantum security**, well above the threshold of feasible computation ($2^{128}$ operations).

---

## 5. Architectural Comparison with Existing Messengers

- **Signal:** Deployed the hybrid PQXDH protocol (X25519 + Kyber/ML-KEM) in September 2023 for native mobile apps. However, Signal requires phone number registration, centralized server infrastructure, and mobile app installation.
- **WhatsApp / Telegram:** Rely on classical ECC without post-quantum protection for stored message traffic.
- **QuantumShield:** Brings hybrid post-quantum security (X25519 + ML-KEM-768) directly to the web as an accountless, zero-PII Progressive Web Application (PWA) with zero server storage.
