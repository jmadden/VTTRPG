import { io, type Socket } from 'socket.io-client';
import { EV, type ClientToServerEvents, type ServerToClientEvents } from '@vtt/shared';

// Generic order is <Listen, Emit>: server→client events first, client→server second.
// Empty/unset VITE_SERVER_URL means same-origin (production build served by the
// backend, and the local prod-parity run). Dev falls back to the :4000 backend.
const SERVER_URL = import.meta.env.VITE_SERVER_URL
  || (import.meta.env.DEV ? 'http://localhost:4000' : undefined);

// The `io()` overload does not accept explicit type args, so annotate the
// result instead (the default DefaultEventsMap socket is asserted to our maps).
// With no URL, socket.io connects to the current origin.
export const socket = (SERVER_URL
  ? io(SERVER_URL, { autoConnect: false })
  : io({ autoConnect: false })) as Socket<ServerToClientEvents, ClientToServerEvents>;

/** Connect and announce which map/user we are. Call once the scene is ready. */
export function connect(mapId: string, userId: string): void {
  socket.connect();
  socket.emit(EV.JOIN_MAP, { mapId, userId });
}
