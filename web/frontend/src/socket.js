import { io } from 'socket.io-client';

const socket = io(window.location.origin, {
  auth: {
    token: localStorage.getItem('token') || '',
  },
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
});

// Re-authenticate on reconnect (token may have been refreshed)
socket.on('connect_error', (err) => {
  if (err.message === 'Authentication required' || err.message === 'Invalid or expired token') {
    const freshToken = localStorage.getItem('token');
    if (freshToken) {
      socket.auth.token = freshToken;
      setTimeout(() => socket.connect(), 1000);
    }
  }
});

// Connect when a token exists
if (localStorage.getItem('token')) {
  socket.connect();
}

/**
 * Update auth token and reconnect socket.
 * Call this after login or token refresh.
 */
export function reconnectSocket(token) {
  socket.auth.token = token;
  if (socket.connected) socket.disconnect();
  socket.connect();
}

/**
 * Disconnect socket (call on logout).
 */
export function disconnectSocket() {
  socket.auth.token = '';
  socket.disconnect();
}

export default socket;
