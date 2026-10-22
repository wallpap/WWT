import energy from "../assets/game/energy.png";
import storedEnergy from "../assets/game/stored-energy.png";
import liveness from "../assets/game/liveness.png";
import weekly from "../assets/game/weekly.png";
import battlePass from "../assets/game/battle-pass.png";
import rouge from "../assets/game/rouge.png";
import astrite from "../assets/game/astrite.png";
import shellCredit from "../assets/game/shell-credit.png";
import basicChest from "../assets/game/chest-basic.png";
import standardChest from "../assets/game/chest-standard.png";
import advancedChest from "../assets/game/chest-advanced.png";
import premiumChest from "../assets/game/chest-premium.png";
import greenTidal from "../assets/game/tidal-green.png";
import purpleTidal from "../assets/game/tidal-purple.png";
import goldTidal from "../assets/game/tidal-gold.png";
import tower from "../assets/game/tower.png";
import slashTower from "../assets/game/slash-tower.png";
import { lookupGameResource } from "./resource-catalog.ts";

const icons: Record<string, string> = {
  energyData: energy,
  storeEnergyData: storedEnergy,
  livenessData: liveness,
  weeklyData: weekly,
  battlePassData: battlePass,
  weeklyRougeData: rouge,
  towerData: tower,
  slashTowerData: slashTower,
  结晶波片: energy,
  备用结晶波片: storedEnergy,
  每日活跃: liveness,
  周本: weekly,
  先约电台: battlePass,
  周常积分: rouge,
  逆境深塔: tower,
  "逆境深塔·深境区": tower,
  冥歌海墟: slashTower,
  "冥歌海墟·禁忌海域": slashTower,
  星声: astrite,
  贝币: shellCredit,
  朴素奇藏箱: basicChest,
  基准奇藏箱: standardChest,
  精密奇藏箱: advancedChest,
  辉光奇藏箱: premiumChest,
  "潮汐之遗·绿": greenTidal,
  "潮汐之遗·紫": purpleTidal,
  "潮汐之遗·金": goldTidal,
};

export function gameIcon(name: string): string {
  const key = Object.hasOwn(icons, name) ? name : name.split(" · ").at(-1)!;
  return Object.hasOwn(icons, key) ? icons[key]! : lookupGameResource(name)?.imageUrl ?? "";
}

type ImageCacheWindow = Window & {
  loadGameImage?: (url: string) => Promise<string>;
};
const pendingImages = new Map<string, Promise<string>>();

function setImageSource(image: HTMLImageElement, source: string): void {
  if (!/^https:\/\//i.test(source) || typeof window === "undefined") {
    image.src = source;
    return;
  }
  const loadGameImage = (window as ImageCacheWindow).loadGameImage;
  if (!loadGameImage) {
    image.src = source;
    return;
  }
  try {
    let pending = pendingImages.get(source);
    if (!pending) {
      pending = loadGameImage.call(window, source).finally(() => pendingImages.delete(source));
      pendingImages.set(source, pending);
    }
    void pending.then(
      (cached) => {
        image.src = cached.startsWith("data:image/") ? cached : source;
      },
      () => {
        image.src = source;
      },
    );
  } catch {
    image.src = source;
  }
}

export function gameImage(url: string, className: string, fallback = ""): HTMLImageElement | null {
  const source = /^https:\/\//i.test(url) ? url : fallback;
  if (!source) return null;
  const image = document.createElement("img");
  image.className = className;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  let currentSource = source;
  image.addEventListener("error", () => {
    if (fallback && currentSource !== fallback) {
      currentSource = fallback;
      setImageSource(image, fallback);
    }
    else image.hidden = true;
  });
  setImageSource(image, source);
  return image;
}

export function remoteImage(
  url: string,
  className: string,
  alt = "",
  fallbackUrl = "",
  onFailure?: (image: HTMLImageElement) => void,
): HTMLImageElement | null {
  if (!/^https:\/\//i.test(url)) return null;
  const image = document.createElement("img");
  image.className = className;
  image.alt = alt;
  image.loading = "lazy";
  image.decoding = "async";
  let usedFallback = false;
  image.addEventListener("error", () => {
    if (fallbackUrl && fallbackUrl !== url && !usedFallback) {
      usedFallback = true;
      setImageSource(image, fallbackUrl);
    } else if (onFailure) onFailure(image);
    else image.hidden = true;
  });
  setImageSource(image, url);
  return image;
}

export function itemLabel(name: string, iconUrl: string, resourceId?: string | number): HTMLElement {
  const label = document.createElement("span");
  label.className = "game-item-label";
  const fallback = (resourceId === undefined ? undefined : lookupGameResource(resourceId)?.imageUrl) || gameIcon(name);
  const image = gameImage(iconUrl, "game-item-icon", fallback);
  if (image) label.append(image);
  const text = document.createElement("span");
  text.textContent = name;
  label.append(text);
  return label;
}
