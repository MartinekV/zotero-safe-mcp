import { describe, it, expect } from "vitest";
import { listAnnotations } from "../../src/highlight/annotationList";
import listAnnotationsTool from "../../src/tools/list_annotations";

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

describe("list_annotations", () => {
  it("lists annotations in reading order with page, colour name and byLLM from the ownership registry", async () => {
    const isOwned = async (libraryID: number, key: string) => libraryID === 1 && key === "ANNOT001";
    expect(await listAnnotations(attachment, isOwned, COLORS)).toEqual([
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
    ]);
  });

  it("never derives byLLM from an [LLM] comment: nothing recorded means everything is the user's", async () => {
    const rows = await listAnnotations(attachment, () => false, COLORS);
    expect(rows.map((a) => a.byLLM)).toEqual([false, false]);
  });

  it("is a read tool taking a validated attachment key", () => {
    expect(listAnnotationsTool.write).toBe(false);
    expect(listAnnotationsTool.inputSchema.properties?.attachmentKey.pattern).toBe("^[A-Z0-9]{8}$");
  });
});
