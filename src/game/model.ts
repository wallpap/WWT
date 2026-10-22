export interface GameSettings {
  executablePath: string;
  resourceTier: ResourceTier | "auto";
}

export type ResourceTier = "uhd" | "hd" | "sd";

export interface GameLaunchPlan {
  executablePath: string;
  workingDirectory: string;
  resourceTier: ResourceTier;
  arguments: [string];
  availableTiers: ResourceTier[];
}

export interface GameResourceStatus {
  executablePath: string;
  workingDirectory: string;
  availableTiers: ResourceTier[];
  missingTiers: ResourceTier[];
}
