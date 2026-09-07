import { all, create, type MathNode } from "mathjs";

const math = create(all!, { number: "number", predictable: true });
const MAX_LINES = 100;
const MAX_VARIABLES = 100;
const forbidden = /(?:import|createUnit|evaluate|compile|parse|function|delete|constructor|prototype|__proto__|process|globalThis|require)/i;
const allowed = /^[0-9A-Za-z_+*/^().,=<>\s\\$-]+$/;

export type SemanticValue = {
  name: string;
  expression: string;
  value: number;
  unit?: string;
  display: string;
  dependencies: string[];
};

export type MathEvaluation = {
  values: SemanticValue[];
  scope: Record<string, number | unknown>;
  error?: string;
};

function cleanExpression(input: string) {
  let value = input
    .replace(/\u00a0/g, " ")
    .replace(/\\(?:,|;|!|quad|qquad)/g, " ")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\left|\\right/g, "")
    .replace(/\\mathrm\{([^}]+)\}/g, "$1")
    .replace(/[{}$]/g, "")
    .trim();
  // Math.js treats a bare `m` in `3 m/s^2` as a symbol if the scope also has
  // a variable named m. Qualify unit literals only when they follow a number.
  value = value.replace(/(\d(?:\.\d+)?)\s+m\b/g, "$1 meter");
  value = value.replace(/(\d(?:\.\d+)?)\s+s\b/g, "$1 second");
  return value.replace(/\s*=\s*$/, "").trim();
}

function safe(input: string) {
  return input.length <= 2_000 && allowed.test(input) && !forbidden.test(input);
}

function safeName(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !forbidden.test(name);
}

function dependencies(expression: string, known: string[]) {
  const names = new Set<string>();
  for (const match of expression.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    if (known.includes(match[0]) && match[0] !== "meter" && match[0] !== "second")
      names.add(match[0]);
  }
  return [...names];
}

function expandImplicitProducts(expression: string, known: string[]) {
  let value = expression;
  const ordered = [...known].sort((a, b) => b.length - a.length);
  for (const left of ordered)
    for (const right of ordered)
      if (left !== right)
        value = value.replace(new RegExp(`\\b${left}${right}\\b`, "g"), `${left}*${right}`);
  return value;
}

function scalar(value: unknown): { value: number; unit?: string; display: string } | null {
  if (typeof value === "number" && Number.isFinite(value))
    return { value, display: formatNumber(value) };
  if (!value || typeof value !== "object" || !("value" in value)) return null;
  const amount = Number((value as { value: unknown }).value);
  if (!Number.isFinite(amount)) return null;
  const display = String(value);
  const unit = display.replace(/^[-+]?\d(?:[\d.,eE+-]*)?\s*/, "").trim();
  return { value: amount, unit: unit || undefined, display };
}

export function formatNumber(value: number) {
  if (Math.abs(value) >= 1e6 || (Math.abs(value) > 0 && Math.abs(value) < 1e-4))
    return value.toExponential(4);
  return Number(value.toPrecision(8)).toString();
}

/** Evaluate a bounded set of student expressions without a model call. */
export function evaluateExpressions(lines: string[]): MathEvaluation {
  // A null-prototype scope prevents a student variable named `__proto__` or
  // `constructor` from mutating the evaluator's object graph.
  const scope: Record<string, number | unknown> = Object.create(null) as Record<string, number | unknown>;
  const values: SemanticValue[] = [];
  try {
    for (const raw of lines.slice(0, MAX_LINES)) {
      const line = raw.trim();
      if (!line) continue;
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      const name = assignment?.[1] ?? "result";
      if (assignment && !safeName(name))
        throw Error("That variable name is reserved.");
      const rhs = cleanExpression(assignment?.[2] ?? line);
      if (!rhs || !safe(rhs)) continue;
      const known = Object.keys(scope);
      const expression = expandImplicitProducts(rhs, known);
      const node = math.parse(expression) as MathNode;
      // mathjs expects a regular object-like scope. Keep our authoritative
      // scope null-prototyped for safety, but hand the evaluator a shallow
      // copy so its internal map helpers cannot choke on the prototype-less
      // object. Expressions are evaluated as values only; assignments happen
      // below after the name has passed the reserved-name guard.
      const result = node.evaluate({ ...scope });
      const output = scalar(result);
      if (!output) continue;
      if (assignment) {
        if (Object.keys(scope).length >= MAX_VARIABLES && !(name in scope))
          throw Error("Too many variables in this note.");
        scope[name] = result;
      }
      values.push({
        name,
        expression: rhs,
        value: output.value,
        ...(output.unit ? { unit: output.unit } : {}),
        display: output.display,
        dependencies: dependencies(expression, known),
      });
    }
    return { values, scope };
  } catch (error) {
    return {
      values,
      scope,
      error: error instanceof Error ? error.message : "Unable to evaluate expression.",
    };
  }
}

export function evaluateExpression(expression: string, scope: Record<string, unknown> = {}) {
  const result = evaluateExpressions([
    ...Object.entries(scope).map(([name, value]) => `${name}=${String(value)}`),
    expression,
  ]).values.at(-1);
  // A failed final expression can otherwise return the last scope assignment
  // because evaluateExpressions preserves earlier values for diagnostics.
  return result?.name === "result" ? result : null;
}
