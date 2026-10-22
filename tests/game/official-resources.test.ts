import { describe, expect, test } from "bun:test";
import { fetchOfficialResourceManifest, officialResourceConfigUrls } from "../../src/game/official-resources.ts";
import { createHash } from "node:crypto";

const update = {
  cdnList: [{ url: "https://cdn.example.invalid/" }],
  config: { version: "3.7.1", indexFile: "indexFile.json" },
  resources: "release/resource.json",
  resourcesBasePath: "release/zip",
};

function fixtureFetcher(resource: unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => Response.json(String(input).endsWith("resource.json") ? { resource } : { default: update })) as typeof fetch;
}

describe("official resources", () => {
  test("parses public resource metadata into normalized download URLs", async () => {
    const manifest = await fetchOfficialResourceManifest(
      "mainland",
      false,
      fixtureFetcher([
        {
          dest: "Client\\Content\\a.pak",
          size: 3,
          md5: "22AF645D1859CB5CA6DA0C484F1F37EA",
        },
      ]),
    );
    expect(manifest).toMatchObject({
      version: "3.7.1",
      predownload: false,
      totalBytes: 3,
    });
    expect(manifest.files).toEqual([
      {
        path: "Client/Content/a.pak",
        size: 3,
        md5: "22af645d1859cb5ca6da0c484f1f37ea",
        url: "https://cdn.example.invalid/release/zip/Client/Content/a.pak",
      },
    ]);
  });

  test("rejects duplicate Windows targets and missing predownload metadata", async () => {
    await expect(
      fetchOfficialResourceManifest(
        "mainland",
        false,
        fixtureFetcher([
          { dest: "a", size: 1 },
          { dest: "A", size: 1 },
        ]),
      ),
    ).rejects.toThrow("重复路径");
    await expect(fetchOfficialResourceManifest("mainland", true, fixtureFetcher([]))).rejects.toThrow("没有开放预下载");
  });

  test("provides distinct HTTPS configuration endpoints per channel", () => {
    for (const [source, marker] of [
      ["mainland", "10003"],
      ["bilibili", "10004"],
    ] as const) {
      const urls = officialResourceConfigUrls(source);
      expect(urls[0]).not.toBe(urls[1]);
      expect(urls.every((url) => url.startsWith("https://") && url.includes(marker))).toBe(true);
    }
  });

  test("selects the last matching version and resolves grouped patches and per-file download folders", async () => {
    const md5 = "22af645d1859cb5ca6da0c484f1f37ea";
    const patchIndex = {
      resource: [
        { dest: "group.krpdiff", size: 10, md5 },
        { dest: "fix.dll", size: 2, md5, fromFolder: "hotfix/zip/" },
      ],
      groupInfos: [
        {
          dest: "group.krpdiff",
          srcFiles: [{ dest: "old.pak" }],
          dstFiles: [{ dest: "new.pak" }],
        },
      ],
      deleteFiles: ["old.pak"],
    };
    const body = JSON.stringify(patchIndex);
    const patch = {
      version: "3.6.0.0",
      indexFile: "patch/index.json",
      indexFileMd5: createHash("md5").update(body).digest("hex"),
      baseUrl: "patch/files/",
    };
    const requests: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("patch/index.json")) return new Response(body);
      if (url.endsWith("resource.json"))
        return Response.json({
          resource: [
            { dest: "new.pak", size: 20, md5 },
            { dest: "fix.dll", size: 2, md5 },
          ],
        });
      return Response.json({
        default: {
          ...update,
          config: {
            ...update.config,
            patchConfig: [{ ...patch, indexFile: "wrong.json" }, patch],
          },
        },
      });
    };
    const manifest = await fetchOfficialResourceManifest("mainland", false, fetcher, "3.6.0");
    expect(manifest.patch).toMatchObject({
      fromVersion: "3.6.0",
      deleteFiles: ["old.pak"],
      groups: [{ patchPath: "group.krpdiff", files: [{ path: "new.pak" }] }],
    });
    expect(manifest.patch!.files.map((file) => file.url)).toEqual(["https://cdn.example.invalid/patch/files/group.krpdiff", "https://cdn.example.invalid/hotfix/zip/fix.dll"]);
    expect(requests.some((url) => url.endsWith("wrong.json"))).toBe(false);
    const corrupt = await fetchOfficialResourceManifest("mainland", false, async (input, init) => (String(input).endsWith("patch/index.json") ? new Response("{}") : fetcher(input)), "3.6.0");
    expect(corrupt.patch).toBeUndefined();
    expect(corrupt.patchNotice).toContain("完整文件");
  });
});
