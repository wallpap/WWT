import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { buildBrowser } from "../../scripts/browser-build.ts";

const build = await buildBrowser({
  entrypoints: [fileURLToPath(new URL("../../src/gacha/controls.ts", import.meta.url))],
  format: "cjs",
});
const script = await build.outputs[0]!.text();

test("clears the credential, prevents duplicate submissions, displays progress and updates records", async () => {
  const elements = new Map<
    string,
    {
      value: string;
      disabled: boolean;
      textContent: string;
      dataset: Record<string, string>;
      addEventListener?: (name: string, listener: (event: Event) => Promise<void>) => void;
    }
  >();
  let submit!: (event: Event) => Promise<void>;
  let progress!: (event: { detail: { completedPools: number; totalPools: number } }) => void;
  let finish!: (value: unknown) => void;
  let calls = 0;
  let rendered = false;
  for (const id of ["#online-gacha-form", "#gacha-link", "#query-gacha", "#gacha-query-notice"])
    elements.set(id, {
      value: "",
      disabled: false,
      textContent: "",
      dataset: {},
    });
  elements.get("#online-gacha-form")!.addEventListener = (_name, listener) => {
    submit = listener;
  };
  runInNewContext(`${script}\nmodule.exports.initializeOnlineGacha(async () => { rendered(); });`, {
    module: { exports: {} },
    document: { querySelector: (id: string) => elements.get(id) },
    window: {
      addEventListener: (_name: string, listener: typeof progress) => {
        progress = listener;
      },
      queryGachaRecords: async (link: string) => {
        expect(link).toBe("fixture credential");
        calls++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
    rendered: () => {
      rendered = true;
    },
  });
  elements.get("#gacha-link")!.value = "fixture credential";
  const event = { preventDefault() {} } as Event;
  const pending = submit(event);
  expect(elements.get("#gacha-link")!.value).toBe("");
  expect(elements.get("#query-gacha")!.disabled).toBe(true);
  await submit(event);
  expect(calls).toBe(1);
  progress({ detail: { completedPools: 5, totalPools: 13 } });
  expect(elements.get("#gacha-query-notice")!.textContent).toContain("5 / 13");
  finish({ records: [], addedCount: 2, duplicateCount: 1 });
  await pending;
  expect(rendered).toBe(true);
  expect(elements.get("#query-gacha")!.disabled).toBe(false);
  expect(elements.get("#gacha-query-notice")!.textContent).toContain("新增 2 条");
});
