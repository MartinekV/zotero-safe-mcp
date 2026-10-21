// Glyph data of a PDF from Zotero's bundled pdf.js (the reader's fork, with getPageData), loaded in a
// chrome window: the same chars the reader selects, without opening a reader tab
// (notes/07-pdf-text.md §4).
import { ToolError } from "../registry/types";
import type { PdfPage, PdfPages } from "./locate";

const PDFJS_URL = "resource://zotero/reader/pdf/build/pdf.mjs";
const WORKER_URL = "resource://zotero/reader/pdf/build/pdf.worker.mjs";

const modules = new WeakMap<object, Promise<any>>();

function chromeWindow(): any {
  const win =
    Zotero.getMainWindow() ||
    Services.wm.getMostRecentWindow(null as any) ||
    (() => {
      try {
        return (Services.appShell as any).hiddenDOMWindow;
      } catch {
        return null;
      }
    })();
  if (!win) throw new ToolError("Zotero has no open window to read the PDF's text layer with; open Zotero's main window.");
  return win;
}

function loadPdfjs(): Promise<any> {
  const win = chromeWindow();
  let p = modules.get(win);
  if (!p) {
    p = (win.eval(`import(${JSON.stringify(PDFJS_URL)})`) as Promise<any>).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
      return pdfjs;
    });
    p.catch(() => modules.delete(win));
    modules.set(win, p);
  }
  return p;
}

export type OpenPdf = PdfPages & {
  /** The label Zotero shows for a page (PDF page labels, else the 1-based number). */
  pageLabel(pageIndex: number): string;
};

/** Opens the PDF at `path`, runs `fn` on it and always releases pdf.js's worker and memory. */
export async function withPdf<T>(path: string, fn: (pdf: OpenPdf) => Promise<T>): Promise<T> {
  const pdfjs = await loadPdfjs();
  const data = await IOUtils.read(path);
  let doc: any;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch (e: any) {
    if (e?.name === "PasswordException") throw new ToolError("The PDF is password-protected; it cannot be highlighted.");
    throw new ToolError(`pdf.js could not open the PDF: ${e?.message ?? e}`);
  }
  try {
    const labels: string[] | null = await doc.getPageLabels().catch(() => null);
    const cache = new Map<number, Promise<PdfPage>>();
    const pdf: OpenPdf = {
      numPages: doc.numPages,
      page(pageIndex) {
        let p = cache.get(pageIndex);
        if (!p) {
          p = doc.getPageData({ pageIndex }).then((pd: any) => ({ chars: pd.chars ?? [], viewBox: pd.viewBox }));
          cache.set(pageIndex, p!);
        }
        return p!;
      },
      pageLabel: (pageIndex) => labels?.[pageIndex] || String(pageIndex + 1),
    };
    return await fn(pdf);
  } finally {
    await doc.destroy();
  }
}
