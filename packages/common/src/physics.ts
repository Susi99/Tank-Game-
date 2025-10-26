import { InputMessage } from "./types";
import { ARENA_HEIGHT, ARENA_PADDING, ARENA_WIDTH, PLAYER_RADIUS } from "./constants";

export interface MutablePlayerPosition {
  x: number;
  y: number;
  angle: number;
  turretAngle: number;
}

export interface ApplyInputOptions {
  dt: number; // seconds
  speed: number;
  speedMultiplier?: number;
}

export function inputToVector(input: InputMessage): { x: number; y: number } {
  const x = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const y = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (x === 0 && y === 0) {
    return { x: 0, y: 0 };
  }
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

export function applyInputToPlayer(
  player: MutablePlayerPosition,
  input: InputMessage,
  options: ApplyInputOptions
): void {
  const { dt, speed, speedMultiplier = 1 } = options;
  const vec = inputToVector(input);
  player.x += vec.x * speed * speedMultiplier * dt;
  player.y += vec.y * speed * speedMultiplier * dt;

  const dx = input.aimX - player.x;
  const dy = input.aimY - player.y;
  if (dx !== 0 || dy !== 0) {
    player.turretAngle = Math.atan2(dy, dx);
  }
  if (vec.x !== 0 || vec.y !== 0) {
    player.angle = Math.atan2(vec.y, vec.x);
  }

  clampToArena(player);
}

export function clampToArena(player: MutablePlayerPosition): void {
  player.x = Math.min(
    ARENA_WIDTH - ARENA_PADDING - PLAYER_RADIUS,
    Math.max(ARENA_PADDING + PLAYER_RADIUS, player.x)
  );
  player.y = Math.min(
    ARENA_HEIGHT - ARENA_PADDING - PLAYER_RADIUS,
    Math.max(ARENA_PADDING + PLAYER_RADIUS, player.y)
  );
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function angleLerp(a: number, b: number, t: number): number {
  const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}
