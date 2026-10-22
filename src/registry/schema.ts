// Minimal JSON Schema validator for tool arguments (only the keywords in JsonSchema).
import { isPlainObject } from "../util/isPlainObject";
import { JsonSchema } from "./types";

/** Returns a list of human-readable problems; empty when `value` matches `schema`. */
export function validate(schema: JsonSchema, value: unknown, path = "arguments"): string[] {
  const errors: string[] = [];
  if (schema.type && !hasType(schema.type, value)) {
    return [`${path} must be ${article(schema.type)} ${schema.type}`];
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push(`${path} must have at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`${path} must have at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value))
      errors.push(`${path} must match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${path} must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      errors.push(`${path} must have at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items!, v, `${path}[${i}]`)));
  }
  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) errors.push(...validate(props[key], v, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
    }
  }
  return errors;
}


function hasType(type: NonNullable<JsonSchema["type"]>, v: unknown): boolean {
  switch (type) {
    case "object": return isPlainObject(v);
    case "array": return Array.isArray(v);
    case "integer": return Number.isInteger(v);
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "null": return v === null;
    default: return typeof v === type;
  }
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? "an" : "a";
}
