// pdfmake 0.3 ships no types; this covers the Node entry verify §30 renders with.
declare module "pdfmake" {
  const pdfmake: {
    setFonts(fonts: Record<string, Record<string, string>>): void;
    setUrlAccessPolicy(cb: (url: string) => boolean): void;
    setLocalAccessPolicy(cb: (path: string) => boolean): void;
    createPdf(doc: unknown): { getBuffer(): Promise<Buffer> };
  };
  export default pdfmake;
}
