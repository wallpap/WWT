import type { AppSettings } from "./app/settings.ts";

export function assembleUi(html: string, styles: string, renderer: string, theme: AppSettings["theme"] = "system"): string {
  const themedHtml = html.replace('data-theme="system"', () => `data-theme="${theme}"`);
  // 回调返回原文，避免脚本和样式中的 $ 替换模式被展开成 HTML。
  const styledHtml = themedHtml.replace('<link rel="stylesheet" href="/style.css" />', () => `<style>${styles}</style>`);
  return styledHtml.replace("</body>", () => `<script>${renderer}</script></body>`);
}
