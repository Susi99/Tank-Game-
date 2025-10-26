export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 20;
export const MS_PER_TICK = 1000 / TICK_RATE;
export const SNAPSHOT_INTERVAL = 1000 / SNAPSHOT_RATE;

export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 900;
export const ARENA_PADDING = 60;

export const PLAYER_RADIUS = 24;
export const PLAYER_BASE_SPEED = 240; // units per second
export const PLAYER_MAX_HEALTH = 100;

export const BULLET_SPEED = 560;
export const BULLET_TTL = 1200; // milliseconds
export const BULLET_DAMAGE = 25;

export const PLAYER_FIRE_RATE = 4; // shots per second
export const PLAYER_RESPAWN_TIME = 3000; // milliseconds

export const POWERUP_RESPAWN_INTERVAL = 15000;
export const POWERUP_TTL = 20000;
export const POWERUP_SPEED_MULTIPLIER = 1.4;
export const POWERUP_RAPID_FIRE_MULTIPLIER = 2;
export const POWERUP_DURATION = 10000;

export const MAX_PLAYERS_PER_ROOM = 8;
export const DEFAULT_ROOM_CODE = "arena";

export const GREEN_PALETTE = {
  background: 0x0d1f16,
  ground: 0x1f4430,
  tankBody: 0x4caf50,
  tankTurret: 0x6fbf73,
  bullet: 0xc5e1a5,
  hud: "#a5d6a7"
};
