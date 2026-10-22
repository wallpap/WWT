import { expect, test } from "bun:test";
import { combineCalculatorResults } from "../../src/kujiequ/calculator-result.ts";
import type { CalculatorCost, CalculatorResult } from "../../src/kujiequ/calculator.ts";

test("combined costs sum matching materials in each group without changing source results", () => {
  const material: CalculatorCost = { id: "1", name: "贝币", count: 100, quality: 1, type: 1, iconUrl: "", preview: false };
  const role: CalculatorResult = { roleCount: 1, weaponCount: 0, preview: { allCost: [material], missingCost: [{ ...material, count: 40 }], synthetic: [] }, costList: [] };
  const weapon: CalculatorResult = { roleCount: 0, weaponCount: 1, preview: { allCost: [{ ...material, count: 200 }, { ...material, id: "2", count: 3 }], missingCost: [{ ...material, count: 20 }], synthetic: [{ ...material, count: 2 }] }, costList: [] };
  const before = structuredClone([role, weapon]);
  const result = combineCalculatorResults([role, weapon]);
  expect(result).toMatchObject({ roleCount: 1, weaponCount: 1 });
  expect(result.preview.allCost.map((item) => item.count)).toEqual([300, 3]);
  expect(result.preview.missingCost[0]?.count).toBe(60);
  expect(result.preview.synthetic[0]?.count).toBe(2);
  expect([role, weapon]).toEqual(before);
});
