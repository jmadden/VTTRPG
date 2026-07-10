import { io, type Socket } from 'socket.io-client';
import { EV, type ClientToServerEvents, type ServerToClientEvents } from '@vtt/shared';

// Generic order is <Listen, Emit>: server→client events first, client→server second.
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000';

// The `io()` overload does not accept explicit type args, so annotate the
// result instead (the default DefaultEventsMap socket is asserted to our maps).
export const socket = io(SERVER_URL, { autoConnect: false }) as Socket<
  ServerToClientEvents,
  ClientToServerEvents
>;

/** Connect and announce which map/user we are. Call once the scene is ready. */
export function connect(mapId: string, userId: string): void {
  socket.connect();
  socket.emit(EV.JOIN_MAP, { mapId, userId });
}
