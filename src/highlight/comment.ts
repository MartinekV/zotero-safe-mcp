// SPEC Hard rule 3: highlight comments start with [LLM].
import { LLM_TAG } from "../config";

/** The comment as stored: prefixed [LLM] (never twice); just [LLM] without a comment. */
export function llmComment(comment: string | undefined): string {
  const c = (comment ?? "").trim();
  if (!c) return LLM_TAG;
  return c.startsWith(LLM_TAG) ? c : `${LLM_TAG} ${c}`;
}
