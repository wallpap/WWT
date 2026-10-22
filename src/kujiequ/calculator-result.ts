import type { CalculatorCost, CalculatorResult } from "./calculator.ts";

export function combineCalculatorResults(results: readonly CalculatorResult[]): CalculatorResult {
  function sumCosts(group: keyof CalculatorResult["preview"]): CalculatorCost[] {
    const costs = new Map<string, CalculatorCost>();
    for (const result of results) {
      for (const item of result.preview[group]) {
        const key = JSON.stringify([item.type, item.id || item.name, item.quality]);
        const previous = costs.get(key);
        if (previous) previous.count += item.count;
        else costs.set(key, { ...item });
      }
    }
    return [...costs.values()];
  }
  return {
    roleCount: results.reduce((sum, result) => sum + result.roleCount, 0),
    weaponCount: results.reduce((sum, result) => sum + result.weaponCount, 0),
    preview: {
      allCost: sumCosts("allCost"),
      missingCost: sumCosts("missingCost"),
      synthetic: sumCosts("synthetic"),
    },
    costList: results.flatMap((result) => result.costList),
  };
}
