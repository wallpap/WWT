import { appSettings } from "../app/settings.ts";
import { gameSettings } from "../game/settings.ts";
import type { AppSettings } from "../app/settings.ts";
import type { GameSettings } from "../game/model.ts";

export interface LegacySettings {
  app: Partial<AppSettings>;
  game: Partial<GameSettings>;
}

export async function importLegacySettings(settings: LegacySettings): Promise<{ addedCount: number; duplicateCount: number }> {
  const app = await appSettings.importMissing(settings.app);
  const game = await gameSettings.importMissing(settings.game);
  return {
    addedCount: app.addedCount + game.addedCount,
    duplicateCount: app.duplicateCount + game.duplicateCount,
  };
}
