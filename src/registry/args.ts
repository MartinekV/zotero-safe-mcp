// Argument checks JSON Schema (registry/schema.ts) can't express.
import { ToolError } from "./types";

/** Throws `message` unless exactly one of the two optional arguments was given. */
export function requireExactlyOne(a: unknown, b: unknown, message: string): void {
  if ((a === undefined) === (b === undefined)) throw new ToolError(message);
}
