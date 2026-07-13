Act as a Principal Software Engineer and System Architect. I want to plan and scaffold a self-hosted, cloud-deployed, system-agnostic 2D Virtual Tabletop (VTT) system using React, Node.js, WebSockets, and PostgreSQL.

We support two hosting modes from one Docker stack: self-host locally and let players in over the internet via a tunnel (ngrok or Tailscale), or deploy to a DigitalOcean droplet where Caddy provides automatic TLS. Play is remote in both. External tools will handle voice/video. See docs/10 for the deployment design.

Our core architectural constraints are:

1. System-Agnostic data handling using PostgreSQL JSONB for flexible character sheets.
2. Real-time token and state sync using Socket.io (sending tiny JSON deltas, not full state).
3. A manual "click-to-reveal" Grid/Hex Shroud system for Fog of War (no heavy raycasting math).
4. Strict backend-side anti-cheat filtering: hidden monsters/tokens must be stripped from the websocket payload entirely if they reside on unrevealed grid coordinates.

Please execute the planning phase by generating the following artifacts:

### Task 1: Directory Structure & Scaffolding Strategy

Design a clean Monorepo folder layout. The root should house the shared configuration, a `frontend/` directory (Vite + React + TanStack Router + PixiJS), and a `backend/` directory (Node.js + TypeScript + Express + Socket.io). Provide the `package.json` configurations for the root (using `concurrently` or workspaces to spin up both servers with one command).

### Task 2: Local Database Schema Definition

Write the exact PostgreSQL DDL (`schema.sql`) to handle this local architecture. Include:

- A `users` table (simple layout: no complex passwords, just local account profiles).
- A `campaigns` table.
- A `character_sheets` table utilizing a JSONB `system_data` column for system-agnostic tracking.
- A `game_maps` table tracking the map asset path and a JSONB `revealed_tiles` array or matrix.
- A `tokens` table tracking position (x, y), type (player, monster), and visibility status.

### Task 3: WebSocket Event & Data Contract Specification

Outline the exact payload design (JSON contracts) for our real-time messaging system. Focus on minimal network footprints. Provide JSON examples for:

- `token_move`: Client to Server, and Server broadcast.
- `reveal_tiles`: RESTRICTED TO GM ONLY. GM Client to Server telling the backend which hex/grid coordinates the DM has manually uncovered, updating the map grid state.
- `sheet_update`: Client updating a single nested attribute path in a character sheet.

### Task 4: Server-Side Visibility Filter Code Example

Write a concise TypeScript/Node.js middleware or utility function demonstrating the anti-cheat pipeline. Show how the backend filters the array of tokens against the database's `revealed_tiles` array, stripping out hidden monsters _before_ broadcasting the payload to non-GM players.

### Task 5: PixiJS Shroud Rendering Strategy

Explain how the frontend should render the manual grid reveal system using PixiJS. Provide a conceptual layout of the rendering layers (Map Layer -> Token Layer -> Grid Mask/Shroud Layer) and how updating the local state should trigger a re-draw of the fog of war.

Please walk through these planning steps comprehensively so we can immediately begin writing code afterward.
