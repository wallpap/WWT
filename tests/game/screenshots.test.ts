import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listGameScreenshots, readGameScreenshot, gameScreenshotPath, screenshotDirectory } from "../../src/game/screenshots.ts";
import { gameLinkUrl, type GameLink } from "../../src/game/links.ts";

test("screenshot discovery reads nested game images and constrains preview and opening to image directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-screenshots-"));
  try {
    const executable = join(root, "Game.exe");
    await writeFile(executable, "fixture");
    expect(await listGameScreenshots(executable)).toEqual([]);
    await mkdir(join(root, "Client/Saved/ScreenShot/nested"), {
      recursive: true,
    });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSfoAAAAASUVORK5CYII=", "base64");
    await writeFile(join(root, "Client/Saved/ScreenShot/nested/a.png"), png);
    await writeFile(join(root, "Client/Saved/ScreenShot/b.jpg"), "invalid image");
    await writeFile(join(root, "Client/Saved/ScreenShot/private.txt"), "must not read");
    const images = await listGameScreenshots(executable);
    expect(images).toHaveLength(2);
    expect(images.some((file) => file.path === "ScreenShot/nested/a.png")).toBe(true);
    expect(await readGameScreenshot(executable, "ScreenShot/nested/a.png")).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(await screenshotDirectory(executable)).toBe(join(root, "Client/Saved/ScreenShot"));
    await expect(readGameScreenshot(executable, "ScreenShot/b.jpg")).rejects.toThrow("格式无效");
    await expect(gameScreenshotPath(executable, "ScreenShot/private.txt")).rejects.toThrow("截图路径");
    await expect(gameScreenshotPath(executable, "ScreenShot/../../Game.exe")).rejects.toThrow("不安全路径");
    await expect(gameScreenshotPath(executable, "Logs/a.png")).rejects.toThrow("截图路径");
    const linked = join(root, "Client/Saved/ScreenShot/linked");
    await symlink(root, linked, "junction");
    expect((await listGameScreenshots(executable)).some((file) => file.path.includes("linked"))).toBe(false);
    await expect(gameScreenshotPath(executable, "ScreenShot/linked/Client/Saved/ScreenShot/nested/a.png")).rejects.toThrow("符号链接");
    expect(gameLinkUrl("kuroWiki")).toBe("https://wiki.kurobbs.com/mc/home");
    expect(() => gameLinkUrl("https://example.invalid" as GameLink)).toThrow("入口无效");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
