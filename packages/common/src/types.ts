export type PowerupType = "health" | "speed" | "rapidFire";

export interface InputMessage {
  seq: number;
  dt: number; // milliseconds since previous input
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
  aimX: number;
  aimY: number;
}

export interface JoinRequest {
  roomCode?: string;
  name?: string;
}

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  turretAngle: number;
  vx: number;
  vy: number;
  health: number;
  maxHealth: number;
  score: number;
  isAlive: boolean;
  respawnAt: number | null;
  speedMultiplier: number;
  rapidFireMultiplier: number;
  fireRate: number;
  lastShotAt: number;
  lastProcessedInput: number;
  pendingInputs: InputMessage[];
  activePowerups: ActivePowerupState[];
}

export interface BulletState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
}

export interface PowerupState {
  id: string;
  type: PowerupType;
  x: number;
  y: number;
  ttl: number;
}

export interface ActivePowerupState {
  type: PowerupType;
  expiresAt: number;
}

export interface SnapshotPlayerState {
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
  lastProcessedInput: number;
  activePowerups: ActivePowerupState[];
}

export interface SnapshotBulletState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
}

export interface SnapshotPowerupState {
  id: string;
  type: PowerupType;
  x: number;
  y: number;
}

export interface Snapshot {
  roomCode: string;
  tick: number;
  timestamp: number;
  matchTime: number;
  players: SnapshotPlayerState[];
  bullets: SnapshotBulletState[];
  powerups: SnapshotPowerupState[];
}

export interface ServerToClientEvents {
  snapshot: (snapshot: Snapshot) => void;
  "latency:response": (nonce: number) => void;
  error: (message: string) => void;
}

export interface ClientToServerEvents {
  join: (payload: JoinRequest) => void;
  input: (payload: InputMessage) => void;
  "latency:ping": (nonce: number) => void;
}
