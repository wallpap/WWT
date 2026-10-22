import { parseGachaImport } from "./import.ts";
import { mergeGachaRecords, readGachaRecords, writeGachaRecords } from "./store.ts";
import { OnlineGachaClient, type GachaProgress } from "./online.ts";
import type { GachaRecord } from "./model.ts";

export function createGachaService(store = { read: readGachaRecords, write: writeGachaRecords }, online = new OnlineGachaClient()) {
  let pending: Promise<unknown> = Promise.resolve();
  function save(incoming: GachaRecord[]) {
    // 本地导入和在线查询共用读改写队列，避免并发覆盖记录。
    const operation = pending.then(async () => {
      const existing = await store.read();
      const result = mergeGachaRecords(existing, incoming);
      if (result.addedCount > 0) await store.write(result.records);
      return {
        importedCount: incoming.length,
        addedCount: result.addedCount,
        duplicateCount: incoming.length - result.addedCount,
        records: result.records,
      };
    });
    pending = operation.catch(() => {});
    return operation;
  }

  return {
    importRecords: (json: string, playerId?: string) => save(parseGachaImport(json, playerId)),
    queryRecords: async (link: string, onProgress?: (progress: GachaProgress) => void) => {
      const incoming = await online.queryAll(link, onProgress);
      return save(incoming);
    },
  };
}

const service = createGachaService();
export const importGachaRecords = service.importRecords;
export const queryGachaRecords = service.queryRecords;
