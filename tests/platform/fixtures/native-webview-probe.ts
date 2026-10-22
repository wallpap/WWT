import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NativeWebview } from "../../../src/platform/native-webview.ts";
import { GameProcessTracker } from "../../../src/game/process-tracker.ts";
import { ResourceUpdateWorkflow } from "../../../src/game/resource-update-workflow.ts";
import { installOfficialResources } from "../../../src/game/resource-update.ts";

const directory = process.argv[2]!;
const events: { name: string; running: boolean; value?: unknown }[] = [];
let running = false;
const record = (name: string, value?: unknown) => {
  events.push({ name, running, value });
};
const worker = new Worker(new URL("./native-webview-server.ts", import.meta.url).href);
const port = await new Promise<number>((resolve, reject) => {
  worker.onmessage = (event) => resolve(event.data);
  worker.onerror = reject;
});
let child: ReturnType<typeof Bun.spawn> | undefined;
const view = new NativeWebview("WWT native regression (auto closes)", 480, 160);
const resourceFiles = [
  {
    path: "resource.dat",
    size: 8,
    md5: null,
    url: `http://127.0.0.1:${port}/resource`,
  },
];
const update = new ResourceUpdateWorkflow(installOfficialResources);
await writeFile(join(directory, "resource.dat"), "old");
try {
  view.bind("cancelInstallProbe", () => {
    record("cancel-request", update.cancel());
  });
  view.bind("installCancelProbe", async () => {
    update.preview(directory, resourceFiles);
    update.confirm(directory, resourceFiles);
    try {
      await update.execute(directory, resourceFiles, (progress) => {
        if (progress.completedBytes > 0) view.evaluate('window.dispatchEvent(new Event("cancel-resource-probe"))');
      });
      throw new Error("Installation should have been cancelled");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "资源安装已取消") throw error;
      record("installation-cancelled", {
        unchanged: (await readFile(join(directory, "resource.dat"), "utf8")) === "old",
        clean: !(await readdir(directory)).some((name) => name.startsWith(".wwt-")),
        unlocked: !update.isInstalling,
      });
      return "cancelled";
    }
  });
  view.bind("report", record);
  view.bind("syncProbe", () => 42);
  view.bind("promiseProbe", async () => {
    await Promise.resolve();
    record("promise");
    return "ok";
  });
  view.bind("fsProbe", async () => {
    const file = join(directory, "fixture.txt");
    await writeFile(file, "ok");
    const value = await readFile(file, "utf8");
    record("fs", value);
    return value;
  });
  view.bind("fetchProbe", async () => {
    const value = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    record("fetch", value);
    return value;
  });
  const tracker = new GameProcessTracker(() => {
    child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(80)"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return child;
  });
  tracker.onExit(() => record("process-exit"));
  view.bind("processProbe", () => {
    tracker.launch({
      executablePath: "probe.exe",
      workingDirectory: directory,
      resourceTier: "hd",
      arguments: ["-krqlv=hd"],
      availableTiers: ["hd"],
    });
  });
  view.bind("errorProbe", () => {
    throw new Error("specific-native-error");
  });
  view.bind("asyncErrorProbe", async () => {
    await Promise.resolve();
    throw new Error("specific-async-error");
  });
  view.bind("evaluateProbe", () => view.evaluate('window.report("evaluated", 7)'));
  view.bind("stopProbe", () => {
    record("stop");
    view.terminate();
  });
  view.setHtml(`<p>Native bridge regression; closes in 2 seconds.</p><script>
    setTimeout(() => window.stopProbe(), 2000);
    window.addEventListener('cancel-resource-probe', () => window.cancelInstallProbe(), { once: true });
    for (const name of ['syncProbe','promiseProbe','fsProbe','fetchProbe','processProbe','evaluateProbe','installCancelProbe']) {
      window[name]().then(value => window.report(name + '-reply', value));
    }
    window.errorProbe().catch(error => window.report('error-reply', { message: error.message, isError: error instanceof Error }));
    window.asyncErrorProbe().catch(error => window.report('async-error-reply', { message: error.message, isError: error instanceof Error }));
  </script>`);
  setTimeout(() => record("timer"), 100);
  running = true;
  await view.run();
  running = false;
  view.evaluate('throw new Error("must be skipped after destruction")');
  await Bun.sleep(150);
} finally {
  view.destroy();
  if (child && child.exitCode === null) {
    child.kill();
    await child.exited;
  }
  worker.terminate();
}
console.log(JSON.stringify(events));
