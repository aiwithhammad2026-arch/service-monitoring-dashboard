# System Limitations and Operational Trade-Offs

## Authentication & Security
1. **In-Memory Login Rate Limiting:**
   - Failed login attempt tracking (5 attempts per `(username, IP)` per 5-minute sliding window) is stored in memory.
   - **Trade-off:** Fast and dependency-free, avoiding external cache dependencies (e.g. Redis).
   - **Limitation:** The rate limit counter resets upon process restart. If the backend restarts, previously accumulated failed attempts for an IP/username are cleared.
2. **Session Storage:**
   - Sessions are cryptographically signed and timestamped using `itsdangerous` and stored inside an `HttpOnly`, `SameSite=Lax` cookie.
   - Server-side account state and roles are queried from SQLite on each request, ensuring immediate revocation on role change or deletion without requiring distributed token invalidation lists.
