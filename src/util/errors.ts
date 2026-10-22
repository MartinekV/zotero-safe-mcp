// Turning anything thrown (Errors, Zotero's bare-string rejections …) into text.

/** The message only, for results the agent sees. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The stack if there is one, for logs. */
export function errorDetail(e: unknown): string {
  return e instanceof Error ? e.stack || e.message : String(e);
}
