import { describe, it, expect } from "vitest";
import listAnnotations, { createListAnnotationsTool } from "../../src/tools/list_annotations";
import { ToolError } from "../../src/registry/types";

const COLORS = [
  ["general-yellow", "#ffd400"],
  ["general-green", "#5fb236"],
];

function annotation(key: string, fields: Record<string, unknown>) {
  return { key, libraryID: 1, deleted: false, annotationComment: null, annotationText: null, ...fields };
}

const attachment = {
  key: "ATTACH01",
  libraryID: 1,
  getAnnotations: () => [
    annotation("ANNOT002", {
      annotationType: "note",
      annotationColor: "#5fb236",
      annotationComment: "user note",
      annotationPageLabel: "iv",
      annotationPosition: JSON.stringify({ pageIndex: 3, rects: [[1, 2, 3, 4]] }),
      annotationSortIndex: "00003|000010|00100",
    }),
    annotation("ANNOT001", {
      annotationType: "highlight",
      annotationColor: "#ffd400",
      annotationText: "Alice was beginning",
      annotationComment: "[LLM] start",
      annotationPageLabel: null,
      annotationPosition: JSON.stringify({ pageIndex: 1, rects: [[1, 2, 3, 4]] }),
      annotationSortIndex: "00001|000071|00230",
    }),
  ],
};

const ctx = { log: () => {} };

describe("list_annotations", () => {
  it("lists annotations in reading order with page, colour name and byLLM from the ownership registry", async () => {
    const tool = createListAnnotationsTool({
      getAttachment: async () => attachment as any,
      isOwned: async (libraryID, key) => libraryID === 1 && key === "ANNOT001",
      colors: () => COLORS,
    });
    expect(await tool.handler({ attachmentKey: "ATTACH01" }, ctx)).toEqual({
      attachmentKey: "ATTACH01",
      annotations: [
        {
          key: "ANNOT001",
          type: "highlight",
          color: "#ffd400",
          colorName: "yellow",
          text: "Alice was beginning",
          comment: "[LLM] start",
          page: "2",
          pageIndex: 1,
          byLLM: true,
        },
        {
          key: "ANNOT002",
          type: "note",
          color: "#5fb236",
          colorName: "green",
          text: null,
          comment: "user note",
          page: "iv",
          pageIndex: 3,
          byLLM: false,
        },
      ],
    });
  });

  it("never derives byLLM from an [LLM] comment: without a registry everything is the user's", async () => {
    const tool = createListAnnotationsTool({ getAttachment: async () => attachment as any, colors: () => COLORS });
    const result: any = await tool.handler({ attachmentKey: "ATTACH01" }, ctx);
    expect(result.annotations.map((a: any) => a.byLLM)).toEqual([false, false]);
  });

  it("passes lookup errors through", async () => {
    const tool = createListAnnotationsTool({
      getAttachment: async () => {
        throw new ToolError("No item with key ATTACH01");
      },
    });
    await expect(tool.handler({ attachmentKey: "ATTACH01" }, ctx)).rejects.toThrow("No item with key ATTACH01");
  });

  it("is a read tool taking a validated attachment key", () => {
    expect(listAnnotations.write).toBe(false);
    expect(listAnnotations.inputSchema.properties?.attachmentKey.pattern).toBe("^[A-Z0-9]{8}$");
  });
});
