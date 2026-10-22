import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ResourceTransaction, recoverResourceTransactions } from "../../src/game/resource-transaction.ts";

const name = ".wwt-transaction-00000000-0000-0000-0000-000000000001";

test("directory transactions replace complete trees and recover interrupted swaps with the original contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-tree-transaction-"));
  try {
    await mkdir(join(root, "sdk", "bilibili"), { recursive: true });
    await writeFile(join(root, "sdk", "bilibili", "old.dll"), "old");
    const transaction = await ResourceTransaction.begin(root);
    await mkdir(join(transaction.staging, "sdk"));
    await writeFile(join(transaction.staging, "sdk", "new.dll"), "new");
    await transaction.installEntries([{ path: "sdk", kind: "directory" }]);
    await transaction.finish();
    expect(await readdir(join(root, "sdk"))).toEqual(["new.dll"]);
    const journalDirectory = join(root, name);
    await mkdir(join(journalDirectory, "backup", "sdk", "bilibili"), {
      recursive: true,
    });
    await writeFile(join(journalDirectory, "backup", "sdk", "bilibili", "original.dll"), "original");
    await writeFile(
      join(journalDirectory, "journal.json"),
      JSON.stringify({
        version: 1,
        phase: "installing",
        entries: [
          {
            path: "sdk",
            kind: "directory",
            hadOriginal: true,
            replacing: true,
          },
        ],
      }),
    );
    expect(await recoverResourceTransactions(root)).toBe(1);
    expect(await readdir(join(root, "sdk"))).toEqual(["bilibili"]);
    expect(await readFile(join(root, "sdk", "bilibili", "original.dll"), "utf8")).toBe("original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovery rolls back every crash boundary before commit and preserves committed files", async () => {
  for (const phase of ["installing", "committed"] as const) {
    const root = await mkdtemp(join(tmpdir(), "wwt-recovery-"));
    const directory = join(root, name);
    try {
      await mkdir(join(directory, "backup"), { recursive: true });
      await writeFile(join(root, "untouched.dat"), "old-untouched");
      await writeFile(join(root, "before-backup.dat"), "old-before");
      await writeFile(join(directory, "backup", "between-renames.dat"), "old-between");
      await writeFile(join(directory, "backup", "replaced.dat"), "old-replaced");
      await writeFile(join(root, "replaced.dat"), "new-replaced");
      await writeFile(join(root, "new-file.dat"), "new-file");
      const entries = [
        {
          path: "untouched.dat",
          hadOriginal: true,
          replacing: phase === "committed",
        },
        { path: "before-backup.dat", hadOriginal: true, replacing: true },
        { path: "between-renames.dat", hadOriginal: true, replacing: true },
        { path: "replaced.dat", hadOriginal: true, replacing: true },
        { path: "new-file.dat", hadOriginal: false, replacing: true },
      ];
      await writeFile(join(directory, "journal.json"), JSON.stringify({ version: 1, phase, entries }));
      expect(await recoverResourceTransactions(root)).toBe(1);
      expect(await readFile(join(root, "untouched.dat"), "utf8")).toBe("old-untouched");
      expect(await readFile(join(root, "before-backup.dat"), "utf8")).toBe("old-before");
      if (phase === "installing") {
        expect(await readFile(join(root, "between-renames.dat"), "utf8")).toBe("old-between");
        expect(await readFile(join(root, "replaced.dat"), "utf8")).toBe("old-replaced");
        expect(await Bun.file(join(root, "new-file.dat")).exists()).toBe(false);
      } else expect(await readFile(join(root, "replaced.dat"), "utf8")).toBe("new-replaced");
      expect((await readdir(root)).filter((item) => item.startsWith(".wwt-"))).toEqual([]);
      expect(await recoverResourceTransactions(root)).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("malformed journals preserve backups and cannot direct recovery outside the game root", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-recovery-invalid-"));
  try {
    const directory = join(root, name);
    await mkdir(directory);
    await writeFile(
      join(directory, "journal.json"),
      JSON.stringify({
        version: 1,
        phase: "installing",
        entries: [{ path: "../escape", hadOriginal: false, replacing: true }],
      }),
    );
    await expect(recoverResourceTransactions(root)).rejects.toThrow("恢复记录无效");
    expect(await Bun.file(join(directory, "journal.json")).exists()).toBe(true);
    await rm(join(directory, "journal.json"));
    await writeFile(join(directory, "journal-1234.tmp"), "unfinished");
    expect(await recoverResourceTransactions(root)).toBe(1);
    await mkdir(join(directory, "staging"), { recursive: true });
    await writeFile(join(directory, "staging", "partial.dat"), "partial");
    await writeFile(join(directory, "journal.json"), JSON.stringify({ version: 1, phase: "downloading", entries: [] }));
    expect(await recoverResourceTransactions(root)).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("active transactions reject overlapping installers and release the root after finishing", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-transaction-lock-"));
  try {
    const transaction = await ResourceTransaction.begin(root);
    await expect(ResourceTransaction.begin(root)).rejects.toThrow("正在安装");
    await expect(recoverResourceTransactions(root)).rejects.toThrow("正在安装");
    await transaction.finish();
    const next = await ResourceTransaction.begin(root);
    await writeFile(join(next.staging, "new.dat"), "new");
    await next.install(["new.dat"]);
    await next.finish();
    expect(await readFile(join(root, "new.dat"), "utf8")).toBe("new");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("obsolete file removal commits atomically and an interrupted removal restores the original", async () => {
  const root = await mkdtemp(join(tmpdir(), "wwt-delete-transaction-"));
  try {
    await writeFile(join(root, "obsolete.dat"), "old");
    const transaction = await ResourceTransaction.begin(root);
    await transaction.installEntries([{ path: "obsolete.dat", kind: "file", remove: true }]);
    await transaction.finish();
    expect(await Bun.file(join(root, "obsolete.dat")).exists()).toBe(false);
    const directory = join(root, name);
    await mkdir(join(directory, "backup"), { recursive: true });
    await writeFile(join(directory, "backup/obsolete.dat"), "old");
    await writeFile(
      join(directory, "journal.json"),
      JSON.stringify({
        version: 1,
        phase: "installing",
        entries: [
          {
            path: "obsolete.dat",
            kind: "file",
            remove: true,
            hadOriginal: true,
            replacing: true,
          },
        ],
      }),
    );
    await recoverResourceTransactions(root);
    expect(await readFile(join(root, "obsolete.dat"), "utf8")).toBe("old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
