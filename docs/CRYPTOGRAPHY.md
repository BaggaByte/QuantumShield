# QuantumShield — Cryptographic Deep Dive

## 1. Cryptographic Primitive Breakdown

QuantumShield implements a hybrid post-quantum cryptographic scheme conforming to the latest standards from NIST and the IETF.

| Primitive | Standard / Specification | Key / Artifact Size | Security Level | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **X25519** | RFC 7748 | PK: 32B, SK: 32B, SS: 32B | Classical: ~128 bits, Quantum: 0 bits | Classical ECDH Key Exchange |
| **ML-KEM-768** | NIST FIPS 203 (Kyber768) | PK: 1,184B, SK: 2,400B, CT: 1,088B, SS: 32B | Category 3 (AES-192 equivalent, ~160 bit quantum) | Post-Quantum Key Encapsulation |
| **HKDF-SHA-256** | RFC 5869 | Digest: 32B, IKM: 64B (concatenated) | 256-bit PRK expansion | Dual-Secret Key Combiner |
| **AES-256-GCM** | NIST SP 800-38D | Key: 32B (256b), IV: 12B, Tag: 16B | 256 bits classical / 128 bits post-Grover | Authenticated Payload Encryption |

---

## 2. NIST FIPS 203: ML-KEM (Module-Lattice-Based Key-Encapsulation Mechanism)

ML-KEM was selected by NIST as the primary general encryption standard following the six-year Post-Quantum Cryptography Standardization Process (2016–2024).

### Hardness Foundation:
ML-KEM security relies on the hardness of the **Module Learning With Errors (M-LWE)** problem over polynomial rings:

$$R_q = \mathbb{Z}_q[X] / (X^{256} + 1)$$

where:
- Modulus $q = 3329$
- Degree $n = 256$
- Matrix dimension $k = 3$ for ML-KEM-768

Finding the secret vectors from public matrix products with small error distributions requires solving the Shortest Vector Problem (SVP) in high-dimensional Euclidean lattices. The best known quantum algorithms (including sieving and enumeration) run in exponential time:

$$T_{\text{quantum}} = 2^{\mathcal{O}(d)}$$

### Implicit Rejection:
ML-KEM is an IND-CCA2 secure KEM constructed by applying the Fujisaki-Okamoto (FO) transform to an IND-CPA secure public-key encryption scheme. When decapsulating an invalid or modified ciphertext, ML-KEM does not return an error code (which could leak timing information to an active attacker); instead, it pseudorandomly hashes the ciphertext together with a secret rejection value to output a pseudorandom shared secret. Any subsequent decryption attempts will fail uniformly at the symmetric authentication tag layer.

---

## 3. X25519 Elliptic-Curve Diffie–Hellman

X25519 computes scalar multiplication on the Montgomery curve:

$$y^2 = x^3 + 486662 x^2 + x \pmod{2^{255} - 19}$$

using only the $x$-coordinate.
- Provides 128-bit security against all known classical attacks (Pollard's rho).
- Immunity to cache-timing attacks through constant-time Montgomery ladder implementation.
- Small 32-byte public keys and fast microsecond computation.

**Quantum Vulnerability:** Peter Shor's 1994 algorithm solves the Discrete Logarithm Problem (DLP) on elliptic curves in polynomial time:

$$\mathcal{O}\left( (\log N)^3 \right)$$

A quantum computer with approximately $2,500$ to $4,000$ logical qubits could compute the private scalar from the public key in minutes, decrypting any recorded classical traffic.

---

## 4. Rationale for Hybrid Deployment

Why not deploy pure post-quantum ML-KEM-768 immediately?
1. **Maturity & Cryptanalysis Confidence:** Elliptic-curve cryptography has withstood over 35 years of intensive public cryptanalysis. Lattice-based cryptography, while robust, is younger and uses newer algebraic assumptions.
2. **Implementation Flaws & Side-Channels:** New post-quantum algorithms may have undiscovered implementation vulnerabilities, side-channel leakage, or cache vulnerabilities.
3. **Defense-in-Depth Guarantee:** Under the hybrid model, breaking the session key requires an attacker to break **both** X25519 **and** ML-KEM-768 simultaneously.
4. **IETF & Industry Alignment:** The hybrid approach is standardized in TLS 1.3 draft specifications (e.g., `X25519MLKEM768`) and deployed by OpenSSH, Signal, Google Chrome, and Cloudflare.
