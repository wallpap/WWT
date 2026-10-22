import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { GachaRecord } from "./model.ts";
import { fourStarQualityLevel, fiveStarQualityLevel, minimumGachaRecordCount, threeStarQualityLevel } from "./constants.ts";
import { gachaPoolCode } from "./pools.ts";
import { bytesPerMebibyte, millisecondsPerDay } from "../units.ts";

const originalHeaders = ["名称", "类型", "星级", "时间", "数量", "资源ID", "卡池"] as const;
const extraHeaders = ["玩家ID", "卡池类型", "唤取名称"] as const;
const uidMarker = "请不要修改此工作表的任何数据";
const maxXlsxBytes = 128 * bytesPerMebibyte;
const maxXlsxEntryCount = 2_000;
const maxZipCommentBytes = 65_535;
const zip64Sentinel = { entryCount: 0xffff, fieldValue: 0xffffffff } as const;
const zipSignature = {
  endOfCentralDirectory: 0x06054b50,
  centralDirectoryHeader: 0x02014b50,
  localFileHeader: 0x04034b50,
} as const;
const zipCompressionMethod = { stored: 0, deflate: 8 } as const;
const zipFlag = { encrypted: 0x0001, utf8: 0x0800 } as const;
const zipEndRecord = {
  size: 22,
  signatureOffset: 0,
  diskEntryCountOffset: 8,
  totalEntryCountOffset: 10,
  centralDirectorySizeOffset: 12,
  centralDirectoryOffset: 16,
} as const;
const zipCentralHeader = {
  size: 46,
  flagsOffset: 8,
  methodOffset: 10,
  compressedSizeOffset: 20,
  uncompressedSizeOffset: 24,
  nameLengthOffset: 28,
  extraLengthOffset: 30,
  commentLengthOffset: 32,
  localHeaderOffset: 42,
  nameOffset: 46,
  signatureOffset: 0,
  versionMadeByOffset: 4,
  versionNeededOffset: 6,
  modificationTimeOffset: 12,
  modificationDateOffset: 14,
  checksumOffset: 16,
  diskNumberOffset: 34,
  internalAttributesOffset: 36,
  externalAttributesOffset: 38,
} as const;
const zipLocalHeader = {
  size: 30,
  signatureOffset: 0,
  versionNeededOffset: 4,
  flagsOffset: 6,
  methodOffset: 8,
  modificationTimeOffset: 10,
  modificationDateOffset: 12,
  checksumOffset: 14,
  compressedSizeOffset: 18,
  uncompressedSizeOffset: 22,
  nameLengthOffset: 26,
  extraLengthOffset: 28,
  nameOffset: 30,
} as const;
const zipVersion20 = 20;
const emptyZipFieldValue = 0;
const crc32Format = {
  tableSize: 256,
  bitsPerByte: 8,
  leastSignificantBitMask: 1,
  polynomial: 0xedb88320,
  initialValue: 0xffffffff,
  byteMask: 0xff,
  shiftBits: 8,
} as const;
const excelDate = {
  maxSerialDay: 2_958_465,
  epoch: Date.UTC(1899, 11, 30),
} as const;
const excelColumn = {
  lettersPerColumn: 26,
  firstLetterCharCode: 65,
  zeroBasedOffset: 1,
} as const;
const excelSheetName = {
  maxLength: 31,
  baseLength: 25,
  minimumLength: 1,
  suffixSeparator: "-",
} as const;
const uidSheetNamePattern = new RegExp(`^\\d{1,${excelSheetName.maxLength}}$`);
const worksheetPathPrefixLength = "xl/".length;
const originalColumn = { name: 0, type: 1, quality: 2, time: 3, count: 4, resourceId: 5, pool: 6 } as const;
const optionalColumn = { playerId: 0, poolType: 1, gachaName: 2 } as const;
const firstWorksheetRowIndex = 0;
const firstDataRowIndex = 1;
const excelRowNumberOffset = 1;
const firstColumnNumber = 1;
const missingColumnIndex = -1;
const minimumInflateOutputBytes = 1;
const xmlBooleanTrue = "1";
const firstSheetNumber = 1;

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

interface SheetInfo {
  name: string;
  path: string;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const start = Math.max(0, bytes.length - zipEndRecord.size - maxZipCommentBytes);
  for (let offset = bytes.length - zipEndRecord.size; offset >= start; offset -= 1) {
    if (offset >= 0 && readUint32(bytes, offset) === zipSignature.endOfCentralDirectory) return offset;
  }
  throw new Error("XLSX 压缩包缺少目录结束标记");
}

function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length > maxXlsxBytes) throw new Error("XLSX 文件过大，未读取");
  const end = findEndOfCentralDirectory(bytes);
  const entryCount = readUint16(bytes, end + zipEndRecord.totalEntryCountOffset);
  if (entryCount > maxXlsxEntryCount) throw new Error("XLSX 压缩包条目过多");
  let expandedBytes = 0;
  const centralSize = readUint32(bytes, end + zipEndRecord.centralDirectorySizeOffset);
  const centralOffset = readUint32(bytes, end + zipEndRecord.centralDirectoryOffset);
  if (entryCount === zip64Sentinel.entryCount || centralSize === zip64Sentinel.fieldValue || centralOffset === zip64Sentinel.fieldValue) {
    throw new Error("暂不支持 ZIP64 XLSX 文件");
  }
  if (centralOffset + centralSize > bytes.length) throw new Error("XLSX 压缩包目录无效");

  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + zipCentralHeader.size > bytes.length || readUint32(bytes, offset + zipCentralHeader.signatureOffset) !== zipSignature.centralDirectoryHeader) {
      throw new Error("XLSX 压缩包目录损坏");
    }
    const flags = readUint16(bytes, offset + zipCentralHeader.flagsOffset);
    const method = readUint16(bytes, offset + zipCentralHeader.methodOffset);
    const compressedSize = readUint32(bytes, offset + zipCentralHeader.compressedSizeOffset);
    const uncompressedSize = readUint32(bytes, offset + zipCentralHeader.uncompressedSizeOffset);
    const nameLength = readUint16(bytes, offset + zipCentralHeader.nameLengthOffset);
    const extraLength = readUint16(bytes, offset + zipCentralHeader.extraLengthOffset);
    const commentLength = readUint16(bytes, offset + zipCentralHeader.commentLengthOffset);
    const localOffset = readUint32(bytes, offset + zipCentralHeader.localHeaderOffset);
    const nameBytes = bytes.subarray(offset + zipCentralHeader.nameOffset, offset + zipCentralHeader.nameOffset + nameLength);
    const name = decoder.decode(nameBytes);
    if (flags & zipFlag.encrypted) throw new Error("不支持加密 XLSX 文件");
    if (uncompressedSize > maxXlsxBytes || localOffset + zipLocalHeader.size > bytes.length) {
      throw new Error("XLSX 压缩包条目无效");
    }
    if (readUint32(bytes, localOffset + zipLocalHeader.signatureOffset) !== zipSignature.localFileHeader) throw new Error("XLSX 本地条目无效");
    const localNameLength = readUint16(bytes, localOffset + zipLocalHeader.nameLengthOffset);
    const localExtraLength = readUint16(bytes, localOffset + zipLocalHeader.extraLengthOffset);
    const dataOffset = localOffset + zipLocalHeader.size + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.length) throw new Error("XLSX 压缩数据超出文件范围");
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let data: Uint8Array;
    if (uncompressedSize + expandedBytes > maxXlsxBytes) throw new Error("XLSX 解压总大小超限");
    if (method === zipCompressionMethod.stored) {
      if (compressed.length > maxXlsxBytes - expandedBytes) throw new Error("XLSX 解压总大小超限");
      data = compressed.slice();
    } else if (method === zipCompressionMethod.deflate) {
      data = new Uint8Array(
        inflateRawSync(compressed, {
          maxOutputLength: Math.max(minimumInflateOutputBytes, Math.min(uncompressedSize, maxXlsxBytes - expandedBytes)),
        }),
      );
    } else {
      throw new Error(`XLSX 使用了不支持的压缩方法：${method}`);
    }
    if (data.length !== uncompressedSize) throw new Error(`XLSX 条目 ${name} 解压大小无效`);
    if (entries.has(name)) throw new Error(`XLSX 包含重复条目：${name}`);
    expandedBytes += data.length;
    entries.set(name, data);
    offset += zipCentralHeader.size + nameLength + extraLength + commentLength;
  }
  return entries;
}

const crcTable = (() => {
  const table = new Uint32Array(crc32Format.tableSize);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < crc32Format.bitsPerByte; bit += 1) value = (value & crc32Format.leastSignificantBitMask) === 0 ? value >>> 1 : (value >>> 1) ^ crc32Format.polynomial;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value: number = crc32Format.initialValue;
  for (const byte of bytes) value = crcTable[(value ^ byte) & crc32Format.byteMask]! ^ (value >>> crc32Format.shiftBits);
  return (value ^ crc32Format.initialValue) >>> 0;
}

function encodeZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const compressed = new Uint8Array(deflateRawSync(entry.data));
    const method = compressed.length < entry.data.length ? zipCompressionMethod.deflate : zipCompressionMethod.stored;
    const body = method === zipCompressionMethod.deflate ? compressed : entry.data;
    const checksum = crc32(entry.data);
    const local = new Uint8Array(zipLocalHeader.size + name.length);
    writeUint32(local, zipLocalHeader.signatureOffset, zipSignature.localFileHeader);
    writeUint16(local, zipLocalHeader.versionNeededOffset, zipVersion20);
    writeUint16(local, zipLocalHeader.flagsOffset, zipFlag.utf8);
    writeUint16(local, zipLocalHeader.methodOffset, method);
    writeUint16(local, zipLocalHeader.modificationTimeOffset, emptyZipFieldValue);
    writeUint16(local, zipLocalHeader.modificationDateOffset, emptyZipFieldValue);
    writeUint32(local, zipLocalHeader.checksumOffset, checksum);
    writeUint32(local, zipLocalHeader.compressedSizeOffset, body.length);
    writeUint32(local, zipLocalHeader.uncompressedSizeOffset, entry.data.length);
    writeUint16(local, zipLocalHeader.nameLengthOffset, name.length);
    writeUint16(local, zipLocalHeader.extraLengthOffset, emptyZipFieldValue);
    local.set(name, zipLocalHeader.nameOffset);
    localParts.push(local, body);

    const central = new Uint8Array(zipCentralHeader.size + name.length);
    writeUint32(central, zipCentralHeader.signatureOffset, zipSignature.centralDirectoryHeader);
    writeUint16(central, zipCentralHeader.versionMadeByOffset, zipVersion20);
    writeUint16(central, zipCentralHeader.versionNeededOffset, zipVersion20);
    writeUint16(central, zipCentralHeader.flagsOffset, zipFlag.utf8);
    writeUint16(central, zipCentralHeader.methodOffset, method);
    writeUint16(central, zipCentralHeader.modificationTimeOffset, emptyZipFieldValue);
    writeUint16(central, zipCentralHeader.modificationDateOffset, emptyZipFieldValue);
    writeUint32(central, zipCentralHeader.checksumOffset, checksum);
    writeUint32(central, zipCentralHeader.compressedSizeOffset, body.length);
    writeUint32(central, zipCentralHeader.uncompressedSizeOffset, entry.data.length);
    writeUint16(central, zipCentralHeader.nameLengthOffset, name.length);
    writeUint16(central, zipCentralHeader.extraLengthOffset, emptyZipFieldValue);
    writeUint16(central, zipCentralHeader.commentLengthOffset, emptyZipFieldValue);
    writeUint16(central, zipCentralHeader.diskNumberOffset, emptyZipFieldValue);
    writeUint16(central, zipCentralHeader.internalAttributesOffset, emptyZipFieldValue);
    writeUint32(central, zipCentralHeader.externalAttributesOffset, emptyZipFieldValue);
    writeUint32(central, zipCentralHeader.localHeaderOffset, localOffset);
    central.set(name, zipCentralHeader.nameOffset);
    centralParts.push(central);
    localOffset += local.length + body.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(zipEndRecord.size);
  writeUint32(end, zipEndRecord.signatureOffset, zipSignature.endOfCentralDirectory);
  writeUint16(end, zipEndRecord.diskEntryCountOffset, entries.length);
  writeUint16(end, zipEndRecord.totalEntryCountOffset, entries.length);
  writeUint32(end, zipEndRecord.centralDirectorySizeOffset, centralDirectory.length);
  writeUint32(end, zipEndRecord.centralDirectoryOffset, localOffset);
  return concatBytes([...localParts, centralDirectory, end]);
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(pattern)) result.set(match[1]!, decodeXml(match[3] ?? match[4] ?? ""));
  return result;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textNodes(fragment: string): string {
  const values = [...fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1] ?? ""));
  return values.length > 0 ? values.join("") : decodeXml(fragment.replace(/<[^>]+>/g, ""));
}

function readRequired(zip: Map<string, Uint8Array>, path: string): string {
  const data = zip.get(path);
  if (!data) throw new Error(`XLSX 缺少 ${path}`);
  return new TextDecoder().decode(data);
}

function parseSharedStrings(zip: Map<string, Uint8Array>): string[] {
  const data = zip.get("xl/sharedStrings.xml");
  if (!data) return [];
  const xml = new TextDecoder().decode(data);
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => textNodes(match[1] ?? ""));
}

function resolveSheetPath(target: string): string {
  const normalized = target.replaceAll("\\", "/");
  if (normalized.startsWith("/")) return normalized.slice(1);
  if (normalized.startsWith("xl/")) return normalized;
  return `xl/${normalized}`;
}

function parseSheets(zip: Map<string, Uint8Array>): SheetInfo[] {
  const workbook = readRequired(zip, "xl/workbook.xml");
  const relationships = readRequired(zip, "xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  for (const match of relationships.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const attrs = attributes(match[0]);
    const id = attrs.get("Id");
    const target = attrs.get("Target");
    if (id && target) targets.set(id, resolveSheetPath(target));
  }
  const sheets: SheetInfo[] = [];
  for (const match of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const attrs = attributes(match[0]);
    const name = attrs.get("name");
    const relation = attrs.get("r:id");
    const path = relation ? targets.get(relation) : undefined;
    if (!name || !path) throw new Error("XLSX 工作表关系无效");
    sheets.push({ name, path });
  }
  return sheets;
}

function columnIndex(reference: string): number {
  const letters = /^([A-Za-z]+)/.exec(reference)?.[1];
  if (!letters) throw new Error(`XLSX 单元格坐标无效：${reference}`);
  let value = 0;
  for (const letter of letters.toUpperCase()) value = value * excelColumn.lettersPerColumn + letter.charCodeAt(0) - (excelColumn.firstLetterCharCode - excelColumn.zeroBasedOffset);
  return value - excelColumn.zeroBasedOffset;
}

function parseWorksheet(xml: string, sharedStrings: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttributes = attributes(rowMatch[1] ?? "");
    const rowIndex = Number(rowAttributes.get("r")) - excelRowNumberOffset;
    const row = rows[rowIndex >= firstWorksheetRowIndex ? rowIndex : rows.length] ?? [];
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttributes = attributes(cellMatch[1] ?? "");
      const reference = cellAttributes.get("r");
      if (!reference) continue;
      const body = cellMatch[2] ?? "";
      const value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const type = cellAttributes.get("t");
      let text: string;
      if (type === "s") {
        const shared = sharedStrings[Number(value)];
        if (shared === undefined) throw new Error("XLSX 共享字符串索引无效");
        text = shared;
      } else if (type === "inlineStr") {
        text = textNodes(body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? body);
      } else if (type === "str") {
        text = decodeXml(value);
      } else if (type === "b") {
        text = value === xmlBooleanTrue ? "TRUE" : "FALSE";
      } else {
        text = decodeXml(value);
      }
      row[columnIndex(reference)] = text;
    }
    rows[rowIndex >= firstWorksheetRowIndex ? rowIndex : rows.length] = row;
  }
  return rows;
}

function integer(value: string, label: string, fail: (message: string) => string): number {
  // 原版 Excel 导出会将数值单元格写成科学计数法，按数值判断是否为整数。
  if (!/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) throw new Error(fail(`${label}必须是非负整数`));
  const parsed = Number(value);
  if (Number.isFinite(parsed) && !Number.isInteger(parsed)) throw new Error(fail(`${label}必须是非负整数`));
  if (!Number.isSafeInteger(parsed)) throw new Error(fail(`${label}超出范围`));
  return parsed;
}

function poolCode(pool: string): string {
  return (
    (
      {
        角色精准调谐: String(gachaPoolCode.characterEvent),
        角色活动唤取: String(gachaPoolCode.characterEvent),
        武器精准调谐: String(gachaPoolCode.weaponEvent),
        武器活动唤取: String(gachaPoolCode.weaponEvent),
        "角色调谐（常驻池）": String(gachaPoolCode.residentCharacter),
        角色常驻唤取: String(gachaPoolCode.residentCharacter),
        "武器调谐（常驻池）": String(gachaPoolCode.residentWeapon),
        武器常驻唤取: String(gachaPoolCode.residentWeapon),
        新手调谐: String(gachaPoolCode.beginner),
        新手唤取: String(gachaPoolCode.beginner),
        新手自选唤取: String(gachaPoolCode.beginnerChoice),
        "新手自选唤取（感恩定向唤取）": String(gachaPoolCode.beginnerGratitudeChoice),
      } as Record<string, string>
    )[pool] ?? pool
  );
}

function excelSerialToTime(value: string): string {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 0 || serial > excelDate.maxSerialDay) throw new Error("Excel 日期无效");
  const date = new Date(excelDate.epoch + Math.round(serial * millisecondsPerDay));
  if (Number.isNaN(date.getTime())) throw new Error("Excel 日期无效");
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")} ${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}:${date.getUTCSeconds().toString().padStart(2, "0")}`;
}

export function parseGachaXlsx(bytes: Uint8Array, fallbackPlayerId?: string): GachaRecord[] {
  const zip = readZip(bytes);
  const sharedStrings = parseSharedStrings(zip);
  const sheets = parseSheets(zip);
  let uid: string | undefined;
  const parsed = sheets.map((sheet) => ({
    sheet,
    rows: parseWorksheet(readRequired(zip, sheet.path), sharedStrings),
  }));
  for (const { sheet, rows } of parsed) {
    if (/^\d+$/.test(sheet.name) && rows[firstWorksheetRowIndex]?.[originalColumn.name] === uidMarker) {
      if (uid !== undefined) throw new Error("工作簿包含多个 UID 标记，无法确定玩家；请分别导入");
      uid = sheet.name;
    }
  }

  const records: GachaRecord[] = [];
  for (const { sheet, rows } of parsed) {
    if (sheet.name === uid) continue;
    const header = rows[firstWorksheetRowIndex] ?? [];
    if (header.length === 0) continue;
    const positions = originalHeaders.map((name) => header.indexOf(name));
    if (positions.some((position) => position === missingColumnIndex)) throw new Error(`工作表 ${sheet.name} 缺少原版列：${originalHeaders.join("、")}`);
    const optional = extraHeaders.map((name) => header.indexOf(name));
    for (let rowIndex = firstDataRowIndex; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      if (row.every((value) => !value?.trim())) continue;
      const fail = (message: string): string => `工作表 ${sheet.name} 第 ${rowIndex + 1} 行：${message}`;
      const cell = (position: number): string => (row[position] ?? "").trim();
      const required = (position: number, label: string): string => {
        const value = cell(position);
        if (!value) throw new Error(fail(`${label}不能为空`));
        return value;
      };
      const player = (optional[optionalColumn.playerId] !== missingColumnIndex ? cell(optional[optionalColumn.playerId]!) : "") || uid || fallbackPlayerId?.trim();
      if (!player) throw new Error(fail("缺少玩家信息，请填写玩家 ID 后导入"));
      if (uid !== undefined && player !== uid) throw new Error(fail("玩家ID列与 UID 标记不一致"));
      const quality = integer(required(positions[originalColumn.quality]!, "星级"), "星级", fail);
      if (quality < threeStarQualityLevel || quality > fiveStarQualityLevel) throw new Error(fail(`星级必须为 ${threeStarQualityLevel}、${fourStarQualityLevel} 或 ${fiveStarQualityLevel}`));
      const count = integer(required(positions[originalColumn.count]!, "数量"), "数量", fail);
      if (count < minimumGachaRecordCount) throw new Error(fail(`数量至少为 ${minimumGachaRecordCount}`));
      const resourceId = integer(required(positions[originalColumn.resourceId]!, "资源ID"), "资源ID", fail);
      const timeValue = required(positions[originalColumn.time]!, "时间");
      const time = /^\d+(?:\.\d+)?$/.test(timeValue) ? excelSerialToTime(timeValue) : timeValue;
      const cardPool = optional[optionalColumn.poolType] !== missingColumnIndex ? cell(optional[optionalColumn.poolType]!) || required(positions[originalColumn.pool]!, "卡池") : required(positions[originalColumn.pool]!, "卡池");
      const gachaName = optional[optionalColumn.gachaName] !== missingColumnIndex ? cell(optional[optionalColumn.gachaName]!) || sheet.name : sheet.name;
      records.push({
        playerId: player,
        gachaName,
        cardPoolType: poolCode(cardPool),
        resourceId,
        qualityLevel: quality,
        resourceType: required(positions[originalColumn.type]!, "类型"),
        name: required(positions[originalColumn.name]!, "名称"),
        count,
        time,
      });
    }
  }
  return records;
}

function columnName(index: number): string {
  let value = index + firstColumnNumber;
  let result = "";
  while (value > 0) {
    const remainder = (value - excelColumn.zeroBasedOffset) % excelColumn.lettersPerColumn;
    result = String.fromCharCode(excelColumn.firstLetterCharCode + remainder) + result;
    value = Math.floor((value - excelColumn.zeroBasedOffset) / excelColumn.lettersPerColumn);
  }
  return result;
}

function inlineCell(reference: string, value: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function numberCell(reference: string, value: number): string {
  return `<c r="${reference}" t="n"><v>${value}</v></c>`;
}

function worksheetXml(rows: readonly (readonly (string | number)[])[]): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const reference = `${columnName(columnIndex)}${rowIndex + excelRowNumberOffset}`;
          return typeof value === "number" ? numberCell(reference, value) : inlineCell(reference, value);
        })
        .join("");
      return `<row r="${rowIndex + excelRowNumberOffset}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function cleanSheetName(value: string): string {
  const cleaned = Array.from(value.replace(/[\[\]:*?/\\']/g, "_").replace(/[\u0000-\u001f]/g, ""))
    .slice(0, excelSheetName.baseLength)
    .join("")
    .trim();
  return cleaned || "抽卡记录";
}

function uniqueSheetName(value: string, used: Set<string>): string {
  const base = cleanSheetName(value);
  let result = base;
  let suffix = 1;
  while (used.has(result.toLowerCase())) {
    const tail = `${excelSheetName.suffixSeparator}${suffix}`;
    result = `${Array.from(base)
      .slice(0, Math.max(excelSheetName.minimumLength, excelSheetName.maxLength - Array.from(tail).length))
      .join("")}${tail}`;
    suffix += 1;
  }
  used.add(result.toLowerCase());
  return result;
}

export function encodeGachaXlsx(records: readonly GachaRecord[]): Uint8Array {
  const groups = new Map<string, GachaRecord[]>();
  for (const record of records) groups.set(record.gachaName, [...(groups.get(record.gachaName) ?? []), record]);
  if (groups.size === 0) groups.set("抽卡记录", []);
  const players = [...new Set(records.map((record) => record.playerId))];
  const uid = players.length === 1 && uidSheetNamePattern.test(players[0] ?? "") ? players[0] : undefined;
  const used = new Set<string>(uid ? [uid.toLowerCase()] : []);
  const files: ZipEntry[] = [];
  const sheets: { name: string; path: string }[] = [];
  let sheetNumber = firstSheetNumber;
  for (const [pool, entries] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "zh-CN"))) {
    const name = uniqueSheetName(pool, used);
    const rows: (string | number)[][] = [[...originalHeaders, ...extraHeaders]];
    for (const record of entries) {
      rows.push([record.name, record.resourceType, record.qualityLevel, record.time, record.count, record.resourceId, record.cardPoolType, record.playerId, record.cardPoolType, record.gachaName]);
    }
    const path = `xl/worksheets/sheet${sheetNumber}.xml`;
    files.push({
      name: path,
      data: new TextEncoder().encode(worksheetXml(rows)),
    });
    sheets.push({ name, path });
    sheetNumber += 1;
  }
  if (uid) {
    const name = uid;
    const path = `xl/worksheets/sheet${sheetNumber}.xml`;
    files.push({
      name: path,
      data: new TextEncoder().encode(worksheetXml([[uidMarker]])),
    });
    sheets.push({ name, path });
  }

  const relationships = sheets.map((sheet, index) => `<Relationship Id="rId${index + firstSheetNumber}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${sheet.path.slice(worksheetPathPrefixLength)}"/>`).join("");
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + firstSheetNumber}" r:id="rId${index + firstSheetNumber}"/>`).join("");
  files.push({
    name: "xl/workbook.xml",
    data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`),
  });
  files.push({
    name: "xl/_rels/workbook.xml.rels",
    data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`),
  });
  files.push({
    name: "_rels/.rels",
    data: new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
  });
  const contentOverrides = [`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`, ...sheets.map((sheet) => `<Override PartName="/${sheet.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)].join("");
  files.push({
    name: "[Content_Types].xml",
    data: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${contentOverrides}</Types>`),
  });
  return encodeZip(files);
}
