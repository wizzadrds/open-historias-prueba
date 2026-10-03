# Realtime historical strategy layer

This repository now contains a server-authoritative continuous simulation layer under `server/realtimeSimulation.js` and `server/realtimeMultiplayer.js`.

## Clock

The authoritative clock starts at **1920-01-01**. The server advances simulation days from wall-clock time using:

- pause / x0.5 / x1 / x2 / x4 / x8
- one simulation day per five real seconds at x1
- bounded offline catch-up
- one clock per room; clients never advance it locally

The client receives `TIME_UPDATE` messages. A client may display the received date between updates, but cannot mutate the canonical clock.

## WebSocket protocol

Endpoint: `/ws/realtime`.

Client messages:
- `CREATE_ROOM` — create single-player or multiplayer room
- `JOIN_ROOM` — join a room
- `SNAPSHOT` — request an authoritative snapshot
- `COMMAND` — submit a validated game command
- `CHAT` — human-to-human chat
- `DIPLOMACY_REQUEST`
- `DIPLOMACY_RESPONSE`

Server events include:
`TIME_UPDATE`, `WORLD_UPDATE`, `BUILDING_UPDATE`, `RESEARCH_UPDATE`, `UNIT_UPDATE`, `EVENT_CREATED`, `EVENT_RESOLVED`, `DIPLOMACY_REQUEST`, `DIPLOMACY_RESPONSE`, `NOTIFICATION`, `PLAYER_JOINED`, `PLAYER_LEFT`.

Commands never contain raw state mutations. The server validates ownership, resources, host-only time controls, diplomacy recipients, coordinates and command rate.

## Persistence and reconnect

Rooms are persisted below the server data directory. A room loaded after a disconnect advances from its last authoritative wall-clock observation, so construction/research/economy continue while offline unless the host paused the room.

Reconnect by sending `JOIN_ROOM` with the room id and a fresh player id; the snapshot is authoritative.

## AI

All unoccupied countries use the deterministic country AI. It builds, researches and moves units from the same validated state model as human commands. It does not call an LLM per unit.

## Migration

Legacy turn-based scenarios are not rewritten. They can continue through the existing turn engine. Realtime rooms use an explicit 1920 start and their own state schema, making migration additive rather than destructive.
