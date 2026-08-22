import type { GameAdapter } from "./types";
import { eu5Adapter } from "./eu5";

export const GAME_ADAPTERS: Record<string, GameAdapter> = {
  eu5: eu5Adapter,
};