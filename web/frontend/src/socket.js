import { io } from 'socket.io-client';

/**
 * Audit M11 — the socket auth token used to come from
 * localStorage.getItem('token'); now the auth-token cookie set by
 * /api/auth/login attaches automatically on the WS handshake when
 * `withCredentials: true` is set on the socket.io client. Backend's
 * io.use middleware (server.js → extractTokenFromHandshake) reads the
 * cookie first, falling back to handshake.auth.token for clients that
 * still pass one explicitly.
 *
 * `auth.token` is kept as an OPTIONAL escape hatch — set non-empty to
 * have it attached on the next reconnect (desktop app, custom clients).
 * Connect happens unconditionally on module load now: whether or not
 * the user is authenticated is the server's call. If the cookie is
 * absent or expired, the handshake fails and connect_error fires;
 * AuthContext's session-expired listener handles the user-visible side.
 */
const socket = io(window.location.origin, {
  withCredentials: true,           // sends the auth-token cookie on handshake
  auth: { token: '' },             // populated only by reconnectSocket() below
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
});

// Re-authenticate on reconnect. The cookie travels automatically via
// withCredentials; the auth.token override is here in case a caller is
// driving the socket with a Bearer token (desktop / custom client).
socket.on('connect_error', (err) => {
  if (err.message === 'Authentication required' || err.message === 'Invalid or expired token') {
    // Soft retry; the browser will re-send the cookie on the next attempt.
    setTimeout(() => socket.connect(), 1000);
  }
});

// Try to connect on module load. The browser's cookie attaches
// automatically — if there's no auth-token, the handshake fails fast
// and connect_error handles the cleanup.
socket.connect();

/**
 * Update auth token and reconnect socket. Now optional — only callers
 * driving the socket with an explicit Bearer (Electron / custom clients)
 * need this; the panel relies on the cookie. Exported for compat with
 * AuthContext.login() which still calls it after a successful login.
 */
export function reconnectSocket(token) {
  if (typeof token === 'string') socket.auth.token = token;
  if (socket.connected) socket.disconnect();
  socket.connect();
}

/**
 * Disconnect socket (call on logout). Clears any explicit Bearer
 * override so a stale token can't ride along on the next reconnect.
 */
export function disconnectSocket() {
  socket.auth.token = '';
  socket.disconnect();
}

export default socket;
