import dotenv from "dotenv";

dotenv.config();

export const PORT = Number(process.env.PORT ?? 3001);
export const HOST = process.env.HOST ?? "0.0.0.0";
export const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
export const TICK_RATE_OVERRIDE = process.env.TICK_RATE
  ? Number(process.env.TICK_RATE)
  : undefined;
