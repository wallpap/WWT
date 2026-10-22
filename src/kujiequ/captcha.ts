import { bytesPerKibibyte, millisecondsPerMinute } from "../units.ts";

const captchaId = "ec4aa4174277d822d73f2442a165a2cd";
const loopbackAddress = "127.0.0.1";
const ephemeralPort = 0;
const maxCaptchaRequestBytes = 16 * bytesPerKibibyte;
const captchaTimeoutMs = 3 * millisecondsPerMinute;
const httpStatus = {
  badRequest: 400,
  forbidden: 403,
  notFound: 404,
  payloadTooLarge: 413,
} as const;
let active = false;
let cancel: (() => void) | undefined;
export function cancelKuroCaptcha(): void {
  cancel?.();
}

export async function verifyKuroCaptcha(
  open: (url: string) => void | Promise<void> = async (url) => {
    const child = Bun.spawn(["rundll32.exe", "url.dll,FileProtocolHandler", url], { stdout: "ignore", stderr: "ignore", windowsHide: true });
    if ((await child.exited) !== 0) throw new Error("打开滑块验证失败");
  },
): Promise<Record<string, string>> {
  if (active) throw new Error("请先完成已打开的滑块验证");
  active = true;
  const nonce = crypto.randomUUID();
  let complete!: (value: Record<string, string>) => void;
  let reject!: (reason: Error) => void;
  const result = new Promise<Record<string, string>>((resolve, fail) => {
    complete = resolve;
    reject = fail;
  });
  cancel = () => reject(new Error("已取消滑块验证"));
  const html = `<!doctype html><meta charset="utf-8"><title>库街区滑块验证</title><p id="status">正在加载滑块验证…</p><script src="https://static.geetest.com/v4/gt4.js"></script><script>
    const status = document.getElementById('status');
    if (typeof initGeetest4 !== 'function') status.textContent = '验证加载失败，请返回助手重试';
    else initGeetest4({captchaId:'${captchaId}',product:'bind',language:'zho',protocol:'https://'}, captcha => {
      captcha.onReady(() => captcha.showBox()).onSuccess(async () => {
        const data = captcha.getValidate(); data.captcha_id = '${captchaId}';
        try { const response = await fetch('/${nonce}', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
          status.textContent = response.ok ? '验证完成，请返回助手查看短信发送结果。' : '验证回传失败，请重试';
        } catch { status.textContent = '验证已过期，请返回助手重试'; }
      }).onError(() => status.textContent = '滑块验证失败，请刷新重试');
    });</script>`;
  const server = Bun.serve({
    hostname: loopbackAddress,
    port: ephemeralPort,
    maxRequestBodySize: maxCaptchaRequestBytes,
    async fetch(request) {
      if (new URL(request.url).pathname !== `/${nonce}`) return new Response(null, { status: httpStatus.notFound });
      if (request.method === "GET")
        return new Response(html, {
          headers: {
            "Content-Type": "text/html;charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      if (request.method !== "POST" || request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("content-type") !== "application/json") return new Response(null, { status: httpStatus.forbidden });
      const raw = await request.text();
      if (raw.length > maxCaptchaRequestBytes) return new Response(null, { status: httpStatus.payloadTooLarge });
      try {
        const data: unknown = JSON.parse(raw);
        if (typeof data !== "object" || data === null) throw new Error();
        const fields: Record<string, string> = {};
        for (const key of ["captcha_id", "lot_number", "pass_token", "gen_time", "captcha_output"]) {
          const value = (data as Record<string, unknown>)[key];
          if (typeof value !== "string" || !value) throw new Error();
          fields[key] = value;
        }
        if (fields["captcha_id"] !== captchaId) throw new Error();
        complete(fields);
        return new Response("ok");
      } catch {
        return new Response(null, { status: httpStatus.badRequest });
      }
    },
  });
  const timer = setTimeout(() => reject(new Error("滑块验证超时，请重试")), captchaTimeoutMs);
  try {
    void Promise.resolve()
      .then(() => open(`http://${loopbackAddress}:${server.port}/${nonce}`))
      .catch(() => reject(new Error("打开滑块验证失败，请检查默认浏览器")));
    return await result;
  } finally {
    clearTimeout(timer);
    await server.stop();
    active = false;
    cancel = undefined;
  }
}
