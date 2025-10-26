import { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import {
  ActivePowerupState,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BULLET_DAMAGE,
  BULLET_SPEED,
  BULLET_TTL,
  InputMessage,
  MAX_PLAYERS_PER_ROOM,
  PLAYER_BASE_SPEED,
  PLAYER_FIRE_RATE,
  PLAYER_MAX_HEALTH,
  PLAYER_RADIUS,
  PLAYER_RESPAWN_TIME,
  POWERUP_DURATION,
  POWERUP_RAPID_FIRE_MULTIPLIER,
  POWERUP_RESPAWN_INTERVAL,
  POWERUP_SPEED_MULTIPLIER,
  POWERUP_TTL,
  PowerupState,
  PowerupType,
  Snapshot,
  SnapshotBulletState,
  SnapshotPlayerState,
  SnapshotPowerupState,
  applyInputToPlayer,
  inputToVector,
  ClientToServerEvents,
  ServerToClientEvents,
  PlayerState,
  BulletState
} from "@tank/common";
import { logger } from "./logger";

type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  { roomCode?: string }
>;

interface RoomOptions {
  snapshotInterval: number;
  tickInterval: number;
}

const MAX_INPUT_DT = 100;

export class GameRoom {
  private readonly players = new Map<string, PlayerState>();
  private readonly bullets = new Map<string, BulletState>();
  private readonly powerups = new Map<string, PowerupState>();
  private readonly tickTimer: NodeJS.Timer;
  private tick = 0;
  private lastSnapshotAt = 0;
  private lastPowerupSpawn = Date.now();
  private readonly matchStart = Date.now();

  constructor(
    private readonly io: Server<ClientToServerEvents, ServerToClientEvents>,
    readonly code: string,
    private readonly options: RoomOptions
  ) {
    this.tickTimer = setInterval(() => this.update(), options.tickInterval);
  }

  destroy(): void {
    clearInterval(this.tickTimer);
    this.players.clear();
    this.bullets.clear();
    this.powerups.clear();
  }

  get size(): number {
    return this.players.size;
  }

  addPlayer(socket: GameSocket, name?: string): PlayerState | null {
    if (this.players.size >= MAX_PLAYERS_PER_ROOM) {
      socket.emit("error", "Room is full");
      return null;
    }

    const spawn = this.getSpawnPosition();
    const player: PlayerState = {
      id: socket.id,
      name: name?.slice(0, 16) || `Tank-${socket.id.slice(0, 4)}`,
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      turretAngle: 0,
      vx: 0,
      vy: 0,
      health: PLAYER_MAX_HEALTH,
      maxHealth: PLAYER_MAX_HEALTH,
      score: 0,
      isAlive: true,
      respawnAt: null,
      speedMultiplier: 1,
      rapidFireMultiplier: 1,
      fireRate: PLAYER_FIRE_RATE,
      lastShotAt: 0,
      lastProcessedInput: 0,
      pendingInputs: [],
      activePowerups: []
    };

    socket.data.roomCode = this.code;
    socket.join(this.code);
    this.players.set(player.id, player);
    logger.info({ room: this.code, player: player.id }, "Player joined");
    return player;
  }

  removePlayer(id: string): boolean {
    this.players.delete(id);
    logger.info({ room: this.code, player: id }, "Player left");
    return this.players.size === 0;
  }

  handleInput(playerId: string, input: InputMessage): void {
    const player = this.players.get(playerId);
    if (!player || !player.isAlive) {
      return;
    }
    if (input.seq <= player.lastProcessedInput) {
      return;
    }
    player.pendingInputs.push(input);
    if (player.pendingInputs.length > 32) {
      player.pendingInputs.splice(0, player.pendingInputs.length - 32);
    }
  }

  private update(): void {
    const now = Date.now();
    this.tick += 1;
    for (const player of this.players.values()) {
      this.updatePlayer(player, now);
    }

    this.updateBullets(now);
    this.updatePowerups(now);

    if (now - this.lastSnapshotAt >= this.options.snapshotInterval) {
      this.broadcastSnapshot(now);
      this.lastSnapshotAt = now;
    }
  }

  private updatePlayer(player: PlayerState, now: number): void {
    if (!player.isAlive) {
      if (player.respawnAt && now >= player.respawnAt) {
        this.respawnPlayer(player);
      }
      player.pendingInputs = [];
      return;
    }

    // Update active powerups
    const active: ActivePowerupState[] = [];
    let speedMultiplier = 1;
    let rapidFireMultiplier = 1;
    for (const state of player.activePowerups) {
      if (state.expiresAt > now) {
        active.push(state);
        if (state.type === "speed") {
          speedMultiplier = POWERUP_SPEED_MULTIPLIER;
        } else if (state.type === "rapidFire") {
          rapidFireMultiplier = POWERUP_RAPID_FIRE_MULTIPLIER;
        }
      }
    }
    player.activePowerups = active;
    player.speedMultiplier = speedMultiplier;
    player.rapidFireMultiplier = rapidFireMultiplier;

    if (player.pendingInputs.length > 0) {
      player.pendingInputs.sort((a, b) => a.seq - b.seq);
      for (const input of player.pendingInputs) {
        if (input.seq <= player.lastProcessedInput) {
          continue;
        }
        const dtSeconds = Math.min(Math.max(input.dt, 0), MAX_INPUT_DT) / 1000;
        const moveVec = inputToVector(input);
        player.vx = moveVec.x * PLAYER_BASE_SPEED * player.speedMultiplier;
        player.vy = moveVec.y * PLAYER_BASE_SPEED * player.speedMultiplier;
        applyInputToPlayer(player, input, {
          dt: dtSeconds,
          speed: PLAYER_BASE_SPEED,
          speedMultiplier: player.speedMultiplier
        });
        player.lastProcessedInput = input.seq;
        if (input.shoot) {
          this.tryShoot(player, now);
        }
      }
      player.pendingInputs = [];
    } else {
      player.vx = 0;
      player.vy = 0;
    }
  }

  private tryShoot(player: PlayerState, now: number): void {
    const cooldown = 1000 / (player.fireRate * player.rapidFireMultiplier);
    if (now - player.lastShotAt < cooldown) {
      return;
    }
    player.lastShotAt = now;
    const angle = player.turretAngle;
    const speed = BULLET_SPEED;
    const bullet: BulletState = {
      id: nanoid(10),
      ownerId: player.id,
      x: player.x + Math.cos(angle) * (PLAYER_RADIUS + 8),
      y: player.y + Math.sin(angle) * (PLAYER_RADIUS + 8),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      ttl: BULLET_TTL
    };
    this.bullets.set(bullet.id, bullet);
  }

  private updateBullets(now: number): void {
    const dt = this.options.tickInterval / 1000;
    for (const [id, bullet] of this.bullets) {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.ttl -= this.options.tickInterval;
      if (
        bullet.ttl <= 0 ||
        bullet.x < 0 ||
        bullet.y < 0 ||
        bullet.x > ARENA_WIDTH ||
        bullet.y > ARENA_HEIGHT
      ) {
        this.bullets.delete(id);
        continue;
      }
      for (const player of this.players.values()) {
        if (!player.isAlive || player.id === bullet.ownerId) {
          continue;
        }
        const dx = player.x - bullet.x;
        const dy = player.y - bullet.y;
        if (dx * dx + dy * dy <= PLAYER_RADIUS * PLAYER_RADIUS) {
          this.handleDamage(player, bullet.ownerId, now);
          this.bullets.delete(id);
          break;
        }
      }
    }
  }

  private handleDamage(target: PlayerState, attackerId: string, now: number): void {
    target.health -= BULLET_DAMAGE;
    if (target.health > 0) {
      return;
    }
    target.isAlive = false;
    target.respawnAt = now + PLAYER_RESPAWN_TIME;
    target.health = 0;
    const attacker = this.players.get(attackerId);
    if (attacker && attacker.id !== target.id) {
      attacker.score += 1;
    }
  }

  private respawnPlayer(player: PlayerState): void {
    const spawn = this.getSpawnPosition();
    player.x = spawn.x;
    player.y = spawn.y;
    player.health = PLAYER_MAX_HEALTH;
    player.isAlive = true;
    player.respawnAt = null;
    player.activePowerups = [];
    player.speedMultiplier = 1;
    player.rapidFireMultiplier = 1;
    player.lastShotAt = 0;
  }

  private updatePowerups(now: number): void {
    if (now - this.lastPowerupSpawn >= POWERUP_RESPAWN_INTERVAL && this.powerups.size < 3) {
      this.spawnPowerup(now);
    }

    for (const [id, powerup] of this.powerups) {
      powerup.ttl -= this.options.tickInterval;
      if (powerup.ttl <= 0) {
        this.powerups.delete(id);
        continue;
      }
      for (const player of this.players.values()) {
        if (!player.isAlive) {
          continue;
        }
        const dx = player.x - powerup.x;
        const dy = player.y - powerup.y;
        if (dx * dx + dy * dy <= (PLAYER_RADIUS + 10) * (PLAYER_RADIUS + 10)) {
          this.applyPowerup(player, powerup, now);
          this.powerups.delete(id);
          break;
        }
      }
    }
  }

  private applyPowerup(player: PlayerState, powerup: PowerupState, now: number): void {
    if (powerup.type === "health") {
      player.health = Math.min(player.maxHealth, player.health + PLAYER_MAX_HEALTH * 0.5);
      return;
    }
    const expiresAt = now + POWERUP_DURATION;
    player.activePowerups = player.activePowerups.filter((p) => p.type !== powerup.type);
    player.activePowerups.push({ type: powerup.type, expiresAt });
  }

  private spawnPowerup(now: number): void {
    const type = this.randomPowerupType();
    const id = nanoid(6);
    const x = Math.random() * (ARENA_WIDTH - PLAYER_RADIUS * 4) + PLAYER_RADIUS * 2;
    const y = Math.random() * (ARENA_HEIGHT - PLAYER_RADIUS * 4) + PLAYER_RADIUS * 2;
    this.powerups.set(id, {
      id,
      type,
      x,
      y,
      ttl: POWERUP_TTL
    });
    this.lastPowerupSpawn = now;
  }

  private randomPowerupType(): PowerupType {
    const roll = Math.random();
    if (roll < 0.34) return "health";
    if (roll < 0.67) return "speed";
    return "rapidFire";
  }

  private broadcastSnapshot(now: number): void {
    const snapshot: Snapshot = {
      roomCode: this.code,
      tick: this.tick,
      timestamp: now,
      matchTime: now - this.matchStart,
      players: Array.from(this.players.values()).map<SnapshotPlayerState>((player) => ({
        id: player.id,
        name: player.name,
        x: player.x,
        y: player.y,
        angle: player.angle,
        turretAngle: player.turretAngle,
        health: player.health,
        maxHealth: player.maxHealth,
        score: player.score,
        isAlive: player.isAlive,
        respawnIn: player.respawnAt ? Math.max(0, player.respawnAt - now) : 0,
        speedMultiplier: player.speedMultiplier,
        rapidFireMultiplier: player.rapidFireMultiplier,
        lastProcessedInput: player.lastProcessedInput,
        activePowerups: player.activePowerups
      })),
      bullets: Array.from(this.bullets.values()).map<SnapshotBulletState>((bullet) => ({
        id: bullet.id,
        ownerId: bullet.ownerId,
        x: bullet.x,
        y: bullet.y
      })),
      powerups: Array.from(this.powerups.values()).map<SnapshotPowerupState>((p) => ({
        id: p.id,
        type: p.type,
        x: p.x,
        y: p.y
      }))
    };
    this.io.to(this.code).emit("snapshot", snapshot);
  }

  private getSpawnPosition(): { x: number; y: number } {
    const margin = PLAYER_RADIUS * 2;
    return {
      x: Math.random() * (ARENA_WIDTH - margin * 2) + margin,
      y: Math.random() * (ARENA_HEIGHT - margin * 2) + margin
    };
  }
}
