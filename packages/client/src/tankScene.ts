import Phaser from "phaser";
import { io, Socket } from "socket.io-client";
import {
  ActivePowerupState,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ClientToServerEvents,
  InputMessage,
  PLAYER_BASE_SPEED,
  PLAYER_MAX_HEALTH,
  ServerToClientEvents,
  Snapshot,
  SnapshotBulletState,
  SnapshotPowerupState,
  applyInputToPlayer
} from "@tank/common";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const INTERPOLATION_DELAY = 100;
const MAX_INPUT_DT = 100;

interface PlayerRenderState {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  turretAngle: number;
  health: number;
  maxHealth: number;
  score: number;
  isAlive: boolean;
  respawnIn: number;
  speedMultiplier: number;
  rapidFireMultiplier: number;
  activePowerups: ActivePowerupState[];
  lastProcessedInput: number;
}

interface BufferedState {
  timestamp: number;
  state: PlayerRenderState;
}

export class TankGameScene extends Phaser.Scene {
  private socket?: Socket<ServerToClientEvents, ClientToServerEvents>;
  private graphics!: Phaser.GameObjects.Graphics;
  private hud = {
    hp: document.getElementById("hud-hp"),
    score: document.getElementById("hud-score"),
    ping: document.getElementById("hud-ping"),
    time: document.getElementById("hud-time")
  };
  private localPlayerId?: string;
  private localState?: PlayerRenderState;
  private predictedState?: PlayerRenderState;
  private pendingInputs: InputMessage[] = [];
  private inputSeq = 0;
  private remoteBuffers = new Map<string, BufferedState[]>();
  private bullets: SnapshotBulletState[] = [];
  private powerups: SnapshotPowerupState[] = [];
  private matchTime = 0;
  private ping = 0;
  private serverTimeOffset = 0;
  private hasServerTime = false;
  private pingTimer?: number;
  private keys?: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private matchOffset = 0;
  private hasMatchOffset = false;

  constructor() {
    super("TankGame");
  }

  preload(): void {
    this.cameras.main.setBackgroundColor("#0d1f16");
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.cameras.main.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    if (this.input.keyboard) {
      this.keys = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D
      }) as typeof this.keys;
    }
    this.setupNetwork();
    this.scale.on("resize", this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.shutdown, this);
  }

  shutdown(): void {
    this.scale.off("resize", this.handleResize, this);
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
    }
    this.socket?.disconnect();
  }

  private setupNetwork(): void {
    this.socket = io(SERVER_URL, {
      transports: ["websocket"],
      autoConnect: true
    });

    this.socket.on("connect", () => {
      this.localPlayerId = this.socket?.id;
      this.socket?.emit("join", { roomCode: "arena" });
      this.startLatencyProbe();
    });

    this.socket.on("snapshot", (snapshot) => {
      this.handleSnapshot(snapshot);
    });

    this.socket.on("latency:response", (nonce) => {
      this.updatePing(performance.now() - nonce);
    });

    this.socket.on("error", (message: string) => {
      console.error("Server error", message);
    });

    this.socket.on("disconnect", () => {
      this.remoteBuffers.clear();
      this.pendingInputs = [];
      this.localState = undefined;
      this.predictedState = undefined;
    });
  }

  private startLatencyProbe(): void {
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
    }
    this.pingTimer = window.setInterval(() => {
      if (!this.socket?.connected) return;
      const nonce = performance.now();
      this.socket.emit("latency:ping", nonce);
    }, 2000);
  }

  update(_: number, delta: number): void {
    const dt = Math.min(delta, MAX_INPUT_DT);
    if (this.hasMatchOffset && this.hasServerTime) {
      this.matchTime = this.getCurrentServerTime() - this.matchOffset;
    }
    this.handleInput(dt);
    this.updatePrediction();
    this.renderWorld();
    this.updateCamera();
    this.updateHud();
  }

  private handleInput(dt: number): void {
    if (!this.socket?.connected || !this.localPlayerId || !this.predictedState) {
      return;
    }

    if (!this.predictedState.isAlive) {
      return;
    }

    if (!this.keys) return;

    const pointer = this.input.activePointer;
    const aimX = Phaser.Math.Clamp(pointer.worldX, 0, ARENA_WIDTH);
    const aimY = Phaser.Math.Clamp(pointer.worldY, 0, ARENA_HEIGHT);
    const input: InputMessage = {
      seq: ++this.inputSeq,
      dt,
      up: this.keys.up.isDown,
      down: this.keys.down.isDown,
      left: this.keys.left.isDown,
      right: this.keys.right.isDown,
      shoot: pointer.isDown,
      aimX,
      aimY
    };

    this.pendingInputs.push(input);
    this.socket.emit("input", input);
  }

  private updatePrediction(): void {
    if (!this.localState) {
      return;
    }
    if (!this.localState.isAlive) {
      this.predictedState = { ...this.localState };
      return;
    }
    const stateCopy: PlayerRenderState = { ...this.localState };
    for (const input of this.pendingInputs) {
      const dtSeconds = Math.min(Math.max(input.dt, 0), MAX_INPUT_DT) / 1000;
      applyInputToPlayer(stateCopy, input, {
        dt: dtSeconds,
        speed: PLAYER_BASE_SPEED,
        speedMultiplier: this.localState.speedMultiplier
      });
    }
    this.predictedState = stateCopy;
  }

  private handleSnapshot(snapshot: Snapshot): void {
    this.syncServerTime(snapshot.timestamp);
    if (!this.hasMatchOffset && this.hasServerTime) {
      this.matchOffset = this.getCurrentServerTime() - snapshot.matchTime;
      this.hasMatchOffset = true;
    }
    if (this.hasMatchOffset && this.hasServerTime) {
      this.matchTime = this.getCurrentServerTime() - this.matchOffset;
    } else {
      this.matchTime = snapshot.matchTime;
    }
    this.bullets = snapshot.bullets;
    this.powerups = snapshot.powerups;

    for (const player of snapshot.players) {
      const state: PlayerRenderState = { ...player };
      if (player.id === this.localPlayerId) {
        this.localState = state;
        this.pendingInputs = this.pendingInputs.filter((input) => input.seq > player.lastProcessedInput);
        this.predictedState = { ...state };
      } else {
        const buffer = this.remoteBuffers.get(player.id) ?? [];
        buffer.push({ timestamp: snapshot.timestamp, state });
        while (buffer.length > 20) {
          buffer.shift();
        }
        this.remoteBuffers.set(player.id, buffer);
      }
    }

    // Remove players not in snapshot
    for (const id of Array.from(this.remoteBuffers.keys())) {
      if (!snapshot.players.some((p) => p.id === id) || id === this.localPlayerId) {
        this.remoteBuffers.delete(id);
      }
    }
  }

  private syncServerTime(serverTimestamp: number): void {
    const now = performance.now();
    const offset = now - serverTimestamp;
    if (!this.hasServerTime) {
      this.serverTimeOffset = offset;
      this.hasServerTime = true;
    } else {
      this.serverTimeOffset = Phaser.Math.Linear(this.serverTimeOffset, offset, 0.1);
    }
  }

  private getCurrentServerTime(): number {
    if (!this.hasServerTime) {
      return 0;
    }
    return performance.now() - this.serverTimeOffset;
  }

  private interpolateRemotePlayers(): PlayerRenderState[] {
    const result: PlayerRenderState[] = [];
    if (!this.hasServerTime) {
      for (const buffer of this.remoteBuffers.values()) {
        const latest = buffer.at(-1);
        if (latest) {
          result.push({ ...latest.state });
        }
      }
      return result;
    }

    const targetTime = this.getCurrentServerTime() - INTERPOLATION_DELAY;
    for (const [id, buffer] of this.remoteBuffers.entries()) {
      if (buffer.length === 0) continue;
      while (buffer.length >= 2 && buffer[1].timestamp <= targetTime) {
        buffer.shift();
      }
      if (buffer.length === 1) {
        result.push({ ...buffer[0].state });
        continue;
      }
      const [a, b] = buffer;
      const span = b.timestamp - a.timestamp || 1;
      const t = Phaser.Math.Clamp((targetTime - a.timestamp) / span, 0, 1);
      result.push({
        ...a.state,
        x: Phaser.Math.Linear(a.state.x, b.state.x, t),
        y: Phaser.Math.Linear(a.state.y, b.state.y, t),
        angle: Phaser.Math.Angle.Interpolate(a.state.angle, b.state.angle, t),
        turretAngle: Phaser.Math.Angle.Interpolate(a.state.turretAngle, b.state.turretAngle, t),
        health: Phaser.Math.Linear(a.state.health, b.state.health, t),
        score: Math.round(Phaser.Math.Linear(a.state.score, b.state.score, t)),
        isAlive: t < 0.5 ? a.state.isAlive : b.state.isAlive,
        respawnIn: Phaser.Math.Linear(a.state.respawnIn, b.state.respawnIn, t)
      });
    }
    return result;
  }

  private renderWorld(): void {
    const graphics = this.graphics;
    graphics.clear();
    graphics.fillStyle(0x1f4430, 1);
    graphics.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    // Powerups
    for (const powerup of this.powerups) {
      const color = this.getPowerupColor(powerup.type);
      graphics.fillStyle(color, 1);
      graphics.fillCircle(powerup.x, powerup.y, 14);
    }

    // Bullets
    graphics.fillStyle(0xc5e1a5, 1);
    for (const bullet of this.bullets) {
      graphics.fillCircle(bullet.x, bullet.y, 6);
    }

    const playersToRender: PlayerRenderState[] = [];
    if (this.predictedState) {
      playersToRender.push(this.predictedState);
    } else if (this.localState) {
      playersToRender.push(this.localState);
    }
    playersToRender.push(...this.interpolateRemotePlayers());

    for (const player of playersToRender) {
      this.drawPlayer(graphics, player);
    }
  }

  private drawPlayer(graphics: Phaser.GameObjects.Graphics, player: PlayerRenderState): void {
    const alpha = player.isAlive ? 1 : 0.3;
    graphics.lineStyle(2, 0x0d1f16, alpha);
    graphics.fillStyle(0x4caf50, alpha);
    graphics.fillCircle(player.x, player.y, 24);
    graphics.strokeCircle(player.x, player.y, 24);

    const turretLength = 36;
    const endX = player.x + Math.cos(player.turretAngle) * turretLength;
    const endY = player.y + Math.sin(player.turretAngle) * turretLength;
    graphics.lineStyle(6, 0x6fbf73, alpha);
    graphics.lineBetween(player.x, player.y, endX, endY);

    const hpRatio = Phaser.Math.Clamp(player.health / player.maxHealth, 0, 1);
    const barWidth = 48;
    const barHeight = 6;
    const barX = player.x - barWidth / 2;
    const barY = player.y - 36;
    graphics.fillStyle(0x0d1f16, 0.6 * alpha);
    graphics.fillRect(barX, barY, barWidth, barHeight);
    graphics.fillStyle(0xa5d6a7, alpha);
    graphics.fillRect(barX, barY, barWidth * hpRatio, barHeight);
  }

  private getPowerupColor(type: SnapshotPowerupState["type"]): number {
    switch (type) {
      case "health":
        return 0x81c784;
      case "speed":
        return 0x66bb6a;
      case "rapidFire":
        return 0x388e3c;
      default:
        return 0xffffff;
    }
  }

  private updateCamera(): void {
    if (!this.predictedState) return;
    const cam = this.cameras.main;
    const halfWidth = cam.width / cam.zoom / 2;
    const halfHeight = cam.height / cam.zoom / 2;
    const x = Phaser.Math.Clamp(this.predictedState.x, halfWidth, ARENA_WIDTH - halfWidth);
    const y = Phaser.Math.Clamp(this.predictedState.y, halfHeight, ARENA_HEIGHT - halfHeight);
    cam.centerOn(x, y);
  }

  private updateHud(): void {
    const hp = this.predictedState?.health ?? this.localState?.health ?? PLAYER_MAX_HEALTH;
    const maxHp = this.predictedState?.maxHealth ?? this.localState?.maxHealth ?? PLAYER_MAX_HEALTH;
    const score = this.predictedState?.score ?? this.localState?.score ?? 0;
    if (this.hud.hp) {
      this.hud.hp.textContent = `HP: ${Math.round(hp)}/${Math.round(maxHp)}`;
    }
    if (this.hud.score) {
      this.hud.score.textContent = `Score: ${score}`;
    }
    if (this.hud.ping) {
      this.hud.ping.textContent = `Ping: ${Math.round(this.ping)} ms`;
    }
    if (this.hud.time) {
      const seconds = Math.floor(this.matchTime / 1000);
      const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
      const ss = String(seconds % 60).padStart(2, "0");
      this.hud.time.textContent = `Time: ${mm}:${ss}`;
    }
  }

  private updatePing(value: number): void {
    this.ping = Phaser.Math.Linear(this.ping || value, value, 0.2);
  }

  private handleResize(): void {
    this.cameras.main.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
  }
}
