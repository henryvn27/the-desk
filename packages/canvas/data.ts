import { evaluateExpression } from "./semantic-math";

export type Cell = string | number | null;

export type CalculatedColumn = {
  id: string;
  name: string;
  expression: string;
};

export type DataTable = {
  columns: string[];
  rows: Cell[][];
  calculatedColumns?: CalculatedColumn[];
};

/** Turn a visible column label into the stable identifier used by formulas. */
export function dataColumnAliases(columns: string[], calculatedColumns: CalculatedColumn[] = []) {
  const used = new Set<string>();
  return [...columns, ...calculatedColumns.map((column) => column.name)].map((label, index) => {
    const base = label.trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]+/, "").replace(/_+/g, "_").replace(/_+$/, "") || `column_${index + 1}`;
    let alias = base;
    let suffix = 2;
    while (used.has(alias)) alias = `${base}_${suffix++}`;
    used.add(alias);
    return alias;
  });
}

/** Calculate derived columns without mutating the student's source rows. */
export function calculatedRows(table: DataTable): Cell[][] {
  const calculatedColumns = table.calculatedColumns ?? [];
  if (!calculatedColumns.length) return table.rows.map((row) => [...row]);
  const aliases = dataColumnAliases(table.columns, calculatedColumns);
  const rawAliases = aliases.slice(0, table.columns.length);
  return table.rows.map((row) => {
    const values: Cell[] = [...row];
    const scope: Record<string, number> = {};
    for (const [index, alias] of rawAliases.entries()) {
      const value = row[index];
      if (typeof value === "number" && Number.isFinite(value)) scope[alias] = value;
    }
    for (const [index, column] of calculatedColumns.entries()) {
      const result = evaluateExpression(column.expression, scope);
      const value = result?.value;
      values.push(typeof value === "number" && Number.isFinite(value) ? value : null);
      if (typeof value === "number" && Number.isFinite(value)) scope[aliases[table.columns.length + index]!] = value;
    }
    return values;
  });
}

export type NumericSummary = {
  count: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  standardDeviation: number | null;
};

export function numericColumn(rows: Cell[][], column: number) {
  return rows
    .map((row) => row[column])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function summarize(values: number[]): NumericSummary {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length)
    return { count: 0, mean: null, median: null, min: null, max: null, standardDeviation: null };
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    mean,
    median: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    min: sorted[0]!,
    max: sorted.at(-1)!,
    standardDeviation: Math.sqrt(variance),
  };
}

export function linearRegression(points: Array<{ x: number; y: number }>) {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length < 2) return null;
  const meanX = finite.reduce((sum, point) => sum + point.x, 0) / finite.length;
  const meanY = finite.reduce((sum, point) => sum + point.y, 0) / finite.length;
  const denominator = finite.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (!denominator) return null;
  const slope = finite.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / denominator;
  const intercept = meanY - slope * meanX;
  const ssTot = finite.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const ssRes = finite.reduce((sum, point) => sum + (point.y - (slope * point.x + intercept)) ** 2, 0);
  return { slope, intercept, rSquared: ssTot ? 1 - ssRes / ssTot : 1, count: finite.length };
}

export function histogram(values: number[], bins = 8) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [];
  const count = Math.max(1, Math.min(50, Math.floor(bins)));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const width = max === min ? 1 : (max - min) / count;
  const result = Array.from({ length: count }, (_, index) => ({
    start: min + index * width,
    end: index === count - 1 ? max : min + (index + 1) * width,
    count: 0,
  }));
  for (const value of finite) {
    const index = max === min ? 0 : Math.min(count - 1, Math.floor((value - min) / width));
    result[index]!.count += 1;
  }
  return result;
}

export function boxplot(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const percentile = (p: number) => {
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
  };
  return { min: sorted[0]!, q1: percentile(0.25), median: percentile(0.5), q3: percentile(0.75), max: sorted.at(-1)! };
}
