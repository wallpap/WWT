import { readFile } from "node:fs/promises";
import { parseGachaLink } from "./online.ts";
import { decodeGameLog } from "../game/log-text.ts";
import { bytesPerMebibyte } from "../units.ts";
export { decryptGameLog as decryptGachaLog } from "../game/log-text.ts";

const urlPattern = /https:\/\/[^\s"']+\/aki\/gacha\/index\.html#\/record[^\s"']+/g;
const unicodeEscape = /\\u([0-9a-fA-F]{4})/g;
const maxLogBytes = 64 * bytesPerMebibyte;

export function decodeUnicodeEscapes(value: string): string {
  return value.replace(unicodeEscape, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

export function extractGachaLink(text: string): string {
  const matches = text.match(urlPattern);
  if (!matches || matches.length === 0) throw new Error("日志中没有找到抽卡记录链接");
  const link = decodeUnicodeEscapes(matches[matches.length - 1]!);
  parseGachaLink(link);
  return link;
}

export async function extractGachaLinkFromLog(path: string): Promise<string> {
  const file = Bun.file(path);
  if (file.size > maxLogBytes) throw new Error("抽卡日志文件过大，未读取");
  return extractGachaLink(decodeGameLog(await file.bytes()));
}
