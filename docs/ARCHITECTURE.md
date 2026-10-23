# QuantumShield — System Architecture & Design

## 1. System Overview

QuantumShield is a browser-based, hybrid post-quantum secure messaging platform. It allows two participants (Alice and Bob) to establish an end-to-end encrypted session over an untrusted WebSocket relay server.

The core cryptographic architecture combines:
- **Classical Key Agreement:** X25519 Elliptic-Curve Diffie–Hellman (RFC 7748)
- **Post-Quantum Key Encapsulation:** ML-KEM-768 / Kyber768 (NIST FIPS 203)
- **Key Derivation Function:** HKDF-SHA-256 (RFC 5869)
- **Authenticated Symmetric Encryption:** AES-256-GCM (NIST SP 800-38D)

```
+-------------------------------------------------------------------------------+
|                                QuantumShield Architecture                     |
+-------------------------------------------------------------------------------+
|                                                                               |
|  +---------------------------+              +---------------------------+     |
|  |       Client: Alice       |              |        Client: Bob        |     |
|  |                           |              |                           |     |
|  |  +---------------------+  |              |  +---------------------+  |     |
|  |  |  Browser WebCrypto  |  |              |  |  Browser WebCrypto  |  |     |
|  |  |  & @noble/pq (KEM)  |  |              |  |  & @noble/pq (KEM)  |  |     |
|  |  +----------+----------+  |              |  +----------+----------+  |     |
|  |             |             |              |             |             |     |
|  +-------------+-------------+              +-------------+-------------+     |
|                |                                          |                   |
|                | WSS (Encrypted Ciphertext Only)          | WSS               |
|                \                    /                     /                   |
|                 \                  /                     /                    |
|                  +----------------+---------------------+                     |
|                  |     Untrusted FastAPI Relay Server   |                     |
|                  |     - In-memory ephemeral rooms      |                     |
|                  |     - Blind JSON envelope forwarding |                     |
|                  |     - Zero key storage / no logging  |                     |
|                  +--------------------------------------+                     |
+-------------------------------------------------------------------------------+
```

---

## 2. Cryptographic State Machine

The key agreement protocol follows a strict two-phase handshake state machine:

```
Alice                                               Bob
  |                                                  |
  | [State: DISCONNECTED]                            | [State: DISCONNECTED]
  |                                                  |
  | Join room (Alice becomes Initiator)              | Join room (Bob becomes Responder)
  | [State: CONNECTED]                               | [State: CONNECTED]
  |                                                  |
  | 1. Generate X25519 (sk_A, pk_A)                 |
  | 2. Send: HANDSHAKE_INIT                          |
  |    { type: "handshake_init",                     |
  |      alice_x25519_pk: pk_A,                      |
  |      session_id: sid }                           |
  | -----------------------------------------------> |
  | [State: HANDSHAKE_SENT]                          |
  |                                                  | 1. Generate X25519 (sk_B, pk_B)
  |                                                  | 2. Generate ML-KEM-768 (sk_kem, pk_kem)
  |                                                  | 3. Compute X25519 SS:
  |                                                  |    SS_classical = X25519(sk_B, pk_A)
  |                                                  | 4. Encapsulate ML-KEM:
  |                                                  |    (ct_kem, SS_pq) = Encaps(pk_kem)
  |                                                  | 5. Combine via HKDF-SHA-256:
  |                                                  |    K = HKDF(SS_classical || SS_pq,
  |                                                  |             salt=sid, info="QuantumShield-v1")
  |                                                  | 6. Send: HANDSHAKE_RESP
  |                                                  |    { type: "handshake_resp",
  |                                                  |      bob_x25519_pk: pk_B,
  |                                                  |      kem_ciphertext: ct_kem,
  |                                                  |      session_id: sid }
  | <----------------------------------------------- |
  |                                                  | [State: SECURE_ESTABLISHED]
  | 1. Compute X25519 SS:                            |
  |    SS_classical = X25519(sk_A, pk_B)             |
  | 2. Decapsulate ML-KEM:                           |
  |    SS_pq = Decaps(ct_kem, sk_kem)                |
  | 3. Combine via HKDF-SHA-256:                     |
  |    K = HKDF(SS_classical || SS_pq,               |
  |             salt=sid, info="QuantumShield-v1")    |
  | [State: SECURE_ESTABLISHED]                      |
  |                                                  |
  | ================= SESSION ACTIVE =============== |
  | Encrypt msg: AES-256-GCM(K, IV, pt, aad=sid)    |
  | -----------------------------------------------> | Decrypt & verify tag
  |                                                  |
```

---

## 3. Hybrid Combiner Specification

The hybrid key combiner prevents vulnerability to failure in either cryptographic primitive:

$$\text{Combined Secret } SS_{\text{hybrid}} = SS_{\text{classical}} \mathbin{\Vert} SS_{\text{pq}}$$

Where:
- $SS_{\text{classical}} \in \{0,1\}^{256}$ (32 bytes from X25519)
- $SS_{\text{pq}} \in \{0,1\}^{256}$ (32 bytes from ML-KEM-768 encapsulation)
- Length of concatenated secret: $32 + 32 = 64\text{ bytes}$

The session encryption key is derived using HKDF (RFC 5869):

$$\text{PRK} = \text{HMAC-SHA256}(\text{salt} = \text{session\_id},\, \text{IKM} = SS_{\text{hybrid}})$$
$$\text{SessionKey} = \text{HKDF-Expand}(\text{PRK},\, \text{info} = \text{"QuantumShield-v1-hybrid"},\, L = 32)$$

### Security Invariant:
If an adversary with a Cryptanalytically Relevant Quantum Computer (CRQC) breaks X25519 via Shor's Algorithm, $SS_{\text{classical}}$ is exposed. However, because $SS_{\text{pq}}$ remains computationally indistinguishable from random under the Module Learning With Errors (M-LWE) hardness assumption, the HKDF output retains 256 bits of pseudo-random security.

Conversely, if an unexpected classical attack emerges against lattice-based ML-KEM-768, the classical ECDH secret $SS_{\text{classical}}$ preserves standard 128-bit classical security.

---

## 4. Replay Attack & Integrity Protection

1. **Unique Message ID Tracking:** Every message envelope carries a cryptographically random UUID (`message_id`). Clients maintain an in-memory `Set<string>` of seen message IDs. Any re-transmitted message ID is immediately rejected before decryption.
2. **Authenticated Additional Data (AAD):** The session identifier (`session_id`) and message sequence numbers are bound into the AES-GCM Associated Data (`aad`). Ciphertexts moved between rooms or injected into another session fail authentication tag verification.
3. **Fresh IV per Message:** A unique 96-bit (12-byte) initialization vector is generated using `crypto.getRandomValues()` for every single message. IVs are never repeated under the same key.
4. **Ephemerality:** All keys are ephemeral. Refreshing the browser destroys all private keys in memory.
