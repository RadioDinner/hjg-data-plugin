import type { PdfDocDefinition } from "./db";

// Browser PDF rendering for emailed pay stubs (session 021). pdfmake + its
// embedded Roboto fonts are ~1.5 MB, so they load on first use only (a separate
// chunk) — never on page load. The document layout itself is pure and lives in
// lib/payStubPdf.ts; this file only turns it into bytes.

interface PdfMakeBrowser {
  addVirtualFileSystem(vfs: Record<string, string>): void;
  setUrlAccessPolicy(cb: (url: string) => boolean): void;
  createPdf(doc: unknown): { getBase64(): Promise<string> };
}

let loading: Promise<PdfMakeBrowser> | null = null;

function loadPdfMake(): Promise<PdfMakeBrowser> {
  loading ??= (async () => {
    const [pm, fonts] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      import("pdfmake/build/vfs_fonts"),
    ]);
    const pdfMake = pm.default as unknown as PdfMakeBrowser;
    pdfMake.addVirtualFileSystem(fonts.default);
    // A pay stub never needs a remote image or font — refuse every URL.
    pdfMake.setUrlAccessPolicy(() => false);
    return pdfMake;
  })().catch((e) => {
    loading = null; // let a later click retry (e.g. a flaky network)
    throw e;
  });
  return loading;
}

// The finished PDF as base64 (what the archive stores and the email attaches).
export async function renderPdfBase64(doc: PdfDocDefinition): Promise<string> {
  const pdfMake = await loadPdfMake();
  return pdfMake.createPdf(doc).getBase64();
}

// Show a stored PDF in a window the caller opened synchronously on the click
// (opening it after an await would trip popup blockers).
export function showPdfInWindow(w: Window, base64: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  w.location.href = url;
  // The tab keeps its own reference; free ours once it has had time to load.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
