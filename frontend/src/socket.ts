import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@vtt/shared';
import { getToken } from './api';

// Generic order is <Listen, Emit>: server->client events first, client->server.
// Empty/unset VITE_SERVER_URL means same-origin (production build served by the
// backend); dev falls back to the :4000 backend.
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:4000' : undefined);

// Identity travels in the handshake auth, re-read on every (re)connect so a
// fresh login/logout takes effect without recreating the socket.
const opts = {
  autoConnect: false,
  auth: (cb: (data: { token: string | null }) => void) => cb({ token: getToken() }),
};

export const socket = (SERVER_URL ? io(SERVER_URL, opts) : io(opts)) as Socket<
  ServerToClientEvents,
  ClientToServerEvents
>;
