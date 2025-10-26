import { createServer } from "http";
import { Server } from "socket.io";
import type { Socket } from "socket.io";
import {
  ClientToServerEvents,
  DEFAULT_ROOM_CODE,
  SNAPSHOT_INTERVAL,
  TICK_RATE,
  ServerToClientEvents
} from "@tank/common";
import { logger } from "./logger";
import { GameRoom } from "./gameRoom";
import { HOST, PORT, TICK_RATE_OVERRIDE } from "./config";

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Tank Game server running");
});

type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  { roomCode?: string }
>;

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: "*"
  }
});

const tickRate = TICK_RATE_OVERRIDE ?? TICK_RATE;
const tickInterval = 1000 / tickRate;
const snapshotInterval = SNAPSHOT_INTERVAL;

const rooms = new Map<string, GameRoom>();

function getRoom(code: string): GameRoom {
  let room = rooms.get(code);
  if (!room) {
    room = new GameRoom(io, code, {
      tickInterval,
      snapshotInterval
    });
    rooms.set(code, room);
    logger.info({ room: code }, "Room created");
  }
  return room;
}

io.on("connection", (socket: GameSocket) => {
  logger.info({ socket: socket.id }, "Client connected");

  socket.on("join", ({ roomCode, name }) => {
    const code = (roomCode?.trim().toLowerCase() || DEFAULT_ROOM_CODE).replace(/[^a-z0-9-]/g, "");
    const room = getRoom(code.length > 0 ? code : DEFAULT_ROOM_CODE);
    const player = room.addPlayer(socket, name);
    if (!player) {
      return;
    }
    socket.data.roomCode = room.code;
  });

  socket.on("input", (input) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) {
      return;
    }
    const room = rooms.get(roomCode);
    room?.handleInput(socket.id, input);
  });

  socket.on("latency:ping", (nonce) => {
    socket.emit("latency:response", nonce);
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) {
      return;
    }
    const room = rooms.get(roomCode);
    if (!room) {
      return;
    }
    const becameEmpty = room.removePlayer(socket.id);
    if (becameEmpty && room.code !== DEFAULT_ROOM_CODE) {
      room.destroy();
      rooms.delete(room.code);
      logger.info({ room: room.code }, "Room destroyed");
    }
  });
});

httpServer.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST, tickRate }, "Tank Game server ready");
});
