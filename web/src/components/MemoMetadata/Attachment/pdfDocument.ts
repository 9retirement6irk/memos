import type { PDFDocumentProxy } from "pdfjs-dist";

type Pdfjs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<Pdfjs> | undefined;

/**
 * Loads pdf.js and its worker on first use, so the app's main bundle carries none of it and a
 * page with no PDF never downloads it.
 */
export const loadPdfjs = (): Promise<Pdfjs> => {
  pdfjsPromise ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")])
    .then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })
    .catch((error) => {
      // Let the next PDF try again, for example after the connection comes back.
      pdfjsPromise = undefined;
      throw error;
    });
  return pdfjsPromise;
};

export interface OpenedPdf {
  document: Promise<PDFDocumentProxy>;
  close: () => void;
}

/**
 * Opens a PDF from this instance's file server. pdf.js reads it with range requests, so the
 * first page shows before a long file has downloaded; the session cookie goes along as for
 * any same-origin request. Forms (XFA) are not rendered.
 */
export const openPdf = (url: string): OpenedPdf => {
  let task: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | undefined;
  let closed = false;
  const document = loadPdfjs().then((pdfjs) => {
    if (closed) throw new Error("closed");
    task = pdfjs.getDocument({ url, enableXfa: false });
    return task.promise;
  });
  return {
    document,
    close: () => {
      closed = true;
      void task?.destroy();
    },
  };
};
