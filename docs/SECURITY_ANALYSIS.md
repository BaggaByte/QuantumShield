# QuantumShield — Security Analysis & Threat Model

## 1. Threat Model & Adversary Assumptions

QuantumShield evaluates security against two distinct adversary classes:

### Adversary A: Passive Eavesdropper with Storage ("Harvest Now, Decrypt Later")
- **Capabilities:** Can intercept and record all encrypted packets exchanged over the network and WebSocket connections. Currently possesses standard classical computing power.
- **Future Capabilities:** At an unknown point in the future (e.g., $T + 10$ to $T + 20$ years), the adversary gains access to a Cryptanalytically Relevant Quantum Computer (CRQC) capable of executing Shor's Algorithm.
- **Attack Goal:** Retrospectively decrypt stored historical communications.
- **QuantumShield Defense:** Traffic encrypted under the **Hybrid** mode combines X25519 with ML-KEM-768. Even if Shor's algorithm solves the classical ECDH discrete logarithm, the session key remains protected by the quantum-resistant lattice problem. Retrospective decryption fails.

### Adversary B: Active Man-in-the-Middle (MitM) & Malicious Relay
- **Capabilities:** Controls the WebSocket relay server, can inspect headers, delay packets, drop packets, alter ciphertexts, or inject replayed messages.
- **Limitations:** Cannot break the underlying symmetric cipher (AES-256-GCM) without the session key.
- **QuantumShield Defense:**
  - **Ciphertext Tampering:** GCM authentication tag covers both ciphertext and Associated Data (`aad`). Modifying a single bit causes decryption to abort.
  - **Replay Attacks:** Each message carries a unique `message_id` tracked in an ephemeral client-side deduplication set. Replayed messages are rejected before processing.
  - **Session Confusion:** Associated Data binds the specific `session_id` to every ciphertext. Messages cannot be cross-injected into other active sessions.

---

## 2. Forward Secrecy & Key Lifecycles

- **Ephemeral Keypairs:** Every session generates fresh, single-use ephemeral keypairs for both X25519 and ML-KEM-768.
- **No Long-Term Secret Storage:** Neither the browser LocalStorage, IndexedDB, nor session cookies store private key material.
- **Zero Server-Side State:** The FastAPI server maintains only volatile, in-memory WebSocket client connections in ephemeral rooms. Keys never touch disk or log streams.
- **Session Teardown:** When either client disconnects or reloads, all keys in the JavaScript runtime are garbage collected.

---

## 3. Grover's Algorithm & Symmetric Key Sizing

Grover's Quantum Search algorithm provides a quadratic speedup for searching unstructured databases and brute-forcing symmetric keys:

$$T_{\text{Grover}} = \mathcal{O}\left( \sqrt{2^k} \right) = 2^{k/2}$$

- A 128-bit symmetric key is reduced to 64 bits of effective quantum security (vulnerable to high-resource adversaries).
- **QuantumShield Selection:** QuantumShield mandates **AES-256-GCM**. Under Grover's algorithm, AES-256 retains **128 bits of post-quantum security**, well above the threshold of feasible computation ($2^{128}$ operations).

---

## 4. Known Limitations & Future Work

As an educational prototype, QuantumShield explicitly documents the following limitations:
1. **Unauthenticated Public Key Distribution:** In the current prototype, public keys are exchanged during the in-band handshake without out-of-band identity verification (e.g., QR-code fingerprint scanning or public-key certificates). An active MitM present at the initial handshake could substitute their own keys. Future work includes QR-code safety number verification.
2. **Double Ratchet Integration:** While every session has forward secrecy via ephemeral handshakes, individual messages within a session share the derived session key. Future versions could integrate the Signal Double Ratchet with post-quantum KEMs for per-message forward secrecy and break-in recovery.
3. **Browser Memory Scrubbing:** JavaScript garbage collection does not guarantee immediate zeroization of memory buffers. Sensitive keys remain in memory until collected.
