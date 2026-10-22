import type { BatchSignItem, SignService, SignTarget } from "./sign.ts";
import { chinaTimeZoneOffset, chinaUtcOffsetHours } from "./constants.ts";
import { millisecondsPerDay, millisecondsPerHour, millisecondsPerMinute, minutesPerHour } from "../units.ts";

const autoSignCutoffHour = 0;
const autoSignCutoffMinute = 5;
const autoSignCutoffMinuteOfDay = autoSignCutoffHour * minutesPerHour + autoSignCutoffMinute;
const autoSignCutoffTime = `${String(autoSignCutoffHour).padStart(2, "0")}:${String(autoSignCutoffMinute).padStart(2, "0")}`;

export interface AutoSignStatus {
  enabled: boolean;
  running: boolean;
  nextRun: string | null;
  lastRun: string | null;
  results: BatchSignItem[];
  error: string | null;
}
const targetKey = (target: SignTarget): string => JSON.stringify([target.accountId, target.roleId, target.serverId]);
function chinaDay(now: number): { date: string; minute: number } {
  const shifted = new Date(now + chinaUtcOffsetHours * millisecondsPerHour);
  return {
    date: shifted.toISOString().slice(0, 10),
    minute: shifted.getUTCHours() * minutesPerHour + shifted.getUTCMinutes(),
  };
}
export function nextAutoSignTime(now: number): string {
  const { date, minute } = chinaDay(now);
  const nextCutoff = Date.parse(`${date}T${autoSignCutoffTime}:00${chinaTimeZoneOffset}`);
  return new Date(nextCutoff + (minute >= autoSignCutoffMinuteOfDay ? millisecondsPerDay : 0)).toISOString();
}

export class AutoSignService {
  #timer: ReturnType<typeof setInterval> | null = null;
  #stopped = false;
  #running = false;
  #wasEnabled = false;
  #day = "";
  #attempted = new Set<string>();
  #lastRun: string | null = null;
  #results: BatchSignItem[] = [];
  #error: string | null = null;
  constructor(
    private readonly signs: Pick<SignService, "batchTargets" | "submitBatch">,
    private readonly enabled: () => boolean,
    private readonly notify: (status: AutoSignStatus) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}
  status(): AutoSignStatus {
    const now = this.now(),
      { date } = chinaDay(now);
    const next = this.#day === date && this.#attempted.size ? new Date(Date.parse(`${date}T${autoSignCutoffTime}:00${chinaTimeZoneOffset}`) + millisecondsPerDay).toISOString() : nextAutoSignTime(now);
    return {
      enabled: this.enabled(),
      running: this.#running,
      nextRun: this.enabled() ? next : null,
      lastRun: this.#lastRun,
      results: structuredClone(this.#results),
      error: this.#error,
    };
  }
  start(): void {
    if (this.#timer || this.#stopped) return;
    this.#timer = setInterval(() => {
      void this.tick();
    }, millisecondsPerMinute);
    this.#timer.unref();
    void this.tick();
  }
  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
  async tick(): Promise<void> {
    if (this.#stopped || this.#running) return;
    if (!this.enabled()) {
      this.#wasEnabled = false;
      return;
    }
    const first = !this.#wasEnabled;
    this.#wasEnabled = true;
    const { date, minute } = chinaDay(this.now());
    if (!first && date !== this.#day && minute < autoSignCutoffMinuteOfDay) return;
    if (date !== this.#day) {
      this.#day = date;
      this.#attempted.clear();
    }
    this.#running = true;
    let changed = false;
    try {
      const targets = await this.signs.batchTargets();
      if (!targets.some((target) => !this.#attempted.has(targetKey(target))) || this.#stopped || !this.enabled()) return;
      this.#error = null;
      changed = true;
      this.notify(this.status());
      const results = await this.signs.submitBatch(targets, (target) => !this.#stopped && this.enabled() && !this.#attempted.has(targetKey(target)));
      for (const item of results) this.#attempted.add(targetKey(item.target));
      this.#results = results;
      this.#lastRun = new Date(this.now()).toISOString();
    } catch (error) {
      changed = true;
      this.#error = error instanceof Error ? error.message : "自动签到失败，请在签到页刷新状态";
    } finally {
      this.#running = false;
      if (changed) this.notify(this.status());
    }
  }
}
