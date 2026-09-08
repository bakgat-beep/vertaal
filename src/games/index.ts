import type { GameAdapter } from "./types";
import { eu5Adapter } from "./eu5";
import { victoria3Adapter } from "./victoria3";
import { ck3Adapter } from "./ck3";
import { imperatorAdapter } from "./imperator";
import { stellarisAdapter } from "./stellaris";
import { hoi4Adapter } from "./hoi4";

export const GAME_ADAPTERS: Record<string, GameAdapter> = {
  eu5: eu5Adapter,
  victoria3: victoria3Adapter,
  ck3: ck3Adapter,
  imperator: imperatorAdapter,
  stellaris: stellarisAdapter,
  hoi4: hoi4Adapter,
};