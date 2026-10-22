import { NativeWebview } from "../../../src/platform/native-webview.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 与客户端启动一致，在 Promise 任务中创建窗口并批量注册桥接。
async function start(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "wwt-startup-test-"));
  const view = new NativeWebview("WWT startup bindings (auto closes)", 480, 160);
  let ready = false;
  let timer = false;
  for (let index = 0; index < 100; index += 1) view.bind(`startupBinding${index}`, () => index);
  view.bind("finishStartup", (values: number[]) => {
    ready = values.length === 100 && values.every((value, index) => value === index);
  });
  const htmlPath = join(directory, "index.html");
  await writeFile(htmlPath, `<p>Startup scheduling regression</p><script>
    Promise.all(Array.from({ length: 100 }, (_, index) => window['startupBinding' + index]())).then(window.finishStartup);
  </script>`);
  view.navigate(pathToFileURL(htmlPath).href);
  const watchdog = setTimeout(() => {
    timer = true;
    view.terminate();
  }, 1000);
  try {
    await view.run();
  } finally {
    clearTimeout(watchdog);
    view.destroy();
    await rm(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ready, timer }));
}

void Promise.resolve().then(start);
