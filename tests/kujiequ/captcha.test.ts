import { expect, test } from "bun:test";
import { verifyKuroCaptcha } from "../../src/kujiequ/captcha.ts";

test("captcha bridge accepts a valid same-origin result and rejects other origins and routes", async () => {
  let url = "";
  const pending = verifyKuroCaptcha((value) => {
    url = value;
  });
  await Promise.resolve();
  const page = await fetch(url);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("static.geetest.com/v4/gt4.js");
  expect((await fetch(new URL("/wrong", url))).status).toBe(404);
  expect(
    (
      await fetch(url, {
        method: "POST",
        headers: {
          origin: "https://example.invalid",
          "content-type": "application/json",
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
  await expect(verifyKuroCaptcha(() => {})).rejects.toThrow("已打开");
  const body = Object.fromEntries(["lot_number", "pass_token", "gen_time", "captcha_output"].map((key) => [key, "fixture"]));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      origin: new URL(url).origin,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...body,
      captcha_id: "ec4aa4174277d822d73f2442a165a2cd",
    }),
  });
  expect(response.status).toBe(200);
  expect((await pending)["lot_number"]).toBe("fixture");
});

test("browser startup failure releases captcha session for retry", async () => {
  await expect(
    verifyKuroCaptcha(() => {
      throw new Error("fixture browser error");
    }),
  ).rejects.toThrow("检查默认浏览器");
  await expect(
    verifyKuroCaptcha(async () => {
      throw new Error("fixture browser error");
    }),
  ).rejects.toThrow("检查默认浏览器");
});
