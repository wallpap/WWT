export const gameLinks = {
  kuroWiki: { name: "库街区 Wiki", url: "https://wiki.kurobbs.com/mc/home" },
  gamekeeWiki: { name: "GameKee Wiki", url: "https://www.gamekee.com/mc/" },
  kuroMap: { name: "库街区地图", url: "https://www.kurobbs.com/mc/map/" },
  communityMap: {
    name: "光环地图",
    url: "https://map.caimogu.cc/ww/main.html",
  },
} as const;
export type GameLink = keyof typeof gameLinks;
export function gameLinkUrl(key: GameLink): string {
  if (!Object.hasOwn(gameLinks, key)) throw new Error("游戏资料入口无效");
  return gameLinks[key].url;
}
