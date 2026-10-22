import { parseAppSettings, type AppSettings, type AppSettingsStore } from "./settings.ts";

export class PreferenceService {
  #queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: Pick<AppSettingsStore, "read" | "update">,
    private readonly configure: (settings: AppSettings) => void,
    private readonly setStartup: (enabled: boolean) => Promise<void>,
  ) {}
  update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const operation = this.#queue.then(async () => {
      const previous = await this.store.read(),
        next = parseAppSettings({ ...previous, ...patch });
      this.configure(next);
      let startupChanged = false;
      try {
        if (Object.hasOwn(patch, "startWithWindows") && next.startWithWindows !== previous.startWithWindows) {
          startupChanged = true;
          await this.setStartup(next.startWithWindows);
        }
        return await this.store.update(patch);
      } catch (error) {
        const failures: unknown[] = [error];
        try {
          this.configure(previous);
        } catch (restoreError) {
          failures.push(restoreError);
        }
        if (startupChanged)
          try {
            await this.setStartup(previous.startWithWindows);
          } catch (restoreError) {
            failures.push(restoreError);
          }
        if (failures.length > 1) throw new AggregateError(failures, "设置未能保存，恢复桌面或登录启动状态失败，请重新检查设置");
        throw error;
      }
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }
}
