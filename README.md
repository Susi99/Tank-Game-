# Tank Arena

A real-time multiplayer 2D tank arena built with Phaser 3, Socket.IO, and TypeScript. The server is fully authoritative and handles simulation, collision, and powerups while clients perform prediction and reconciliation for smooth gameplay. The default public lobby is `arena`, but players can also create ad-hoc private rooms by providing a room code.

## Features

- ⚙️ **Server authoritative** simulation with 60 ticks per second and 20 Hz state snapshots
- 🎮 **Client-side prediction** plus reconciliation and interpolation for remote players
- 🕹️ **Responsive controls** – WASD movement, mouse aiming, left-click firing
- 💥 Bullet collisions, health, deaths, and automatic respawn after 3 seconds
- 🔋 Powerups: health refill, speed boost, and rapid fire, each with visual indicators
- 🖥️ Simple HUD showing hit points, score, latency, and elapsed match time
- 🌐 Supports both localhost play and online matches through ngrok forwarding
- 💚 Cohesive green arena aesthetic rendered entirely with vector graphics

## Project structure

```
packages/
  client/   # Vite + Phaser front-end (TypeScript)
  server/   # Node.js + Socket.IO authoritative server (TypeScript)
  common/   # Shared constants, types, and physics helpers
```

## Requirements

- [Node.js 18+](https://nodejs.org/)
- [pnpm](https://pnpm.io/) (package manager)
- Optional: [ngrok](https://ngrok.com/) for exposing the server online

## Setup

1. Install dependencies (this builds the shared `@tank/common` package automatically):

   ```bash
   pnpm install
   ```

2. Copy the environment template and adjust if needed:

   ```bash
   cp .env.example .env
   ```

   Key variables:

   - `PORT`, `HOST`, `PUBLIC_URL` – server host configuration
   - `VITE_SERVER_URL` – Socket.IO endpoint used by the client (defaults to `http://localhost:3001`)

## Development workflow

Start both the server (tsx watch) and the client (Vite dev server) in parallel:

```bash
pnpm dev
```

By default:

- Server listens on `http://localhost:3001`
- Client runs on `http://localhost:5173`

Open the client URL in multiple browser tabs to play together.

## Production build

Build all packages:

```bash
pnpm build
```

- `packages/common` compiles to reusable JS/typings in `dist/`
- `packages/server` emits compiled files to `dist/`
- `packages/client` outputs static assets to `packages/client/dist`

Start the compiled server (after `pnpm build`):

```bash
pnpm --filter @tank/server start
```

To serve the built client, either run `pnpm --filter @tank/client preview` or host the `packages/client/dist` directory with any static file server (e.g., `npx serve packages/client/dist`). Update `VITE_SERVER_URL` in production builds if the Socket.IO endpoint differs.

## Gameplay

- **Movement:** `WASD`
- **Aim:** Mouse cursor
- **Fire:** Left mouse button (hold for continuous fire)
- **Rooms:** Default lobby `arena`, pass a `roomCode` when connecting to create/join a private match (handled automatically by the client)

### Powerups

| Type       | Effect                              | Duration |
|------------|--------------------------------------|----------|
| Health     | Restores 50% max HP immediately      | Instant  |
| Speed      | +40% movement speed                  | 10 s     |
| Rapid Fire | 2× firing rate                       | 10 s     |

Powerups spawn periodically (up to 3 on the map) and despawn if ignored.

### HUD

The heads-up display shows:

- Current HP and max HP
- Score (kills)
- Round-trip latency estimate (ping)
- Match time since room creation

## Using ngrok for online play

1. Start the server locally (`pnpm dev` or `pnpm --filter @tank/server start`).
2. Expose the server port via ngrok:

   ```bash
   ngrok http 3001
   ```

3. Take the HTTPS forwarding URL reported by ngrok (e.g., `https://abc123.ngrok.io`) and set it as the client endpoint:

   ```bash
   export VITE_SERVER_URL=https://abc123.ngrok.io
   pnpm --filter @tank/client dev
   ```

   Or, for a production build, update `VITE_SERVER_URL` in `.env` before running `pnpm build`.

4. Share the ngrok URL with friends; they can open the Vite client URL (or the built static site) and instantly join the arena.

> **Tip:** If you secure ngrok with an auth token, add it to the `.env` file (`NGROK_AUTHTOKEN`) or your shell profile before starting the tunnel.

## Logging & diagnostics

- The server uses [pino](https://github.com/pinojs/pino) with pretty output in development. Adjust `LOG_LEVEL` in the environment for more/less detail.
- A health endpoint is available at `http://localhost:3001/health`.
- Client logs warnings and any server error events to the browser console.

## License

This project is provided as-is for demonstration and educational purposes.
