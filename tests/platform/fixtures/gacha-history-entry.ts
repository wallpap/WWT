import { initializeGachaHistory } from "../../../src/gacha/history-controls.ts";
initializeGachaHistory()(await window.loadRecords().then((result) => result.records));
window.dispatchEvent(new Event("gacha-history-ready"));
