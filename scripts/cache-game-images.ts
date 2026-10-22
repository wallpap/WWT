import { resolve } from "node:path";
import { GameImageCache } from "../src/kujiequ/image-cache.ts";
import { gameResourceCatalog } from "../src/kujiequ/resource-catalog.ts";

const directoryIndex = process.argv.indexOf("--directory");
const directory = directoryIndex < 0 ? undefined : process.argv[directoryIndex + 1];
if (directoryIndex >= 0 && !directory) throw new Error("--directory 需要指定缓存目录");
const cache = new GameImageCache(directory ? resolve(directory) : undefined, undefined, 8);
const urls = [...new Set(gameResourceCatalog.map((item) => item.imageUrl))];
let index = 0;
let completed = 0;
let failed = 0;
const failedUrls: string[] = [];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (index < urls.length) {
    const url = urls[index++]!;
    try {
      await cache.load(url);
    } catch {
      failed++;
      failedUrls.push(url);
    }
    completed++;
    if (completed % 100 === 0) console.log(`图片缓存 ${completed}/${urls.length}，失败 ${failed}`);
  }
}));
console.log(`图片缓存完成：成功 ${completed - failed}，失败 ${failed}，共 ${urls.length}`);
for (const url of failedUrls) console.error(`图片下载失败：${url}`);
if (failed) process.exitCode = 1;
