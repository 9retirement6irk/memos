import type { CanvasHandle } from "@usememos/canvas";
import collegeRuledUrl from "./college-ruled.png";
import dotGridUrl from "./dot-grid.png";
import graphUrl from "./graph.png";
import greggRuledUrl from "./gregg-ruled.png";
import wideRuledUrl from "./wide-ruled.png";

/**
 * Notebook papers to draw on. A paper goes into a drawing the way a picture does when a drawing
 * starts over one: a locked image at the bottom of the scene, saved in the drawing's own PNG and
 * scene, so the drawing is an ordinary `.canvas.png` that stock Memos shows and reopens as it is.
 */
export const PAPERS = [
  { id: "college-ruled", url: collegeRuledUrl },
  { id: "wide-ruled", url: wideRuledUrl },
  { id: "gregg-ruled", url: greggRuledUrl },
  { id: "graph", url: graphUrl },
  { id: "dot-grid", url: dotGridUrl },
] as const;
export type PaperId = (typeof PAPERS)[number]["id"];

/**
 * Every paper is a US Letter page at this size: the largest the canvas keeps a picture without
 * scaling it (1440 px a side), so the rules stay as sharp as they were drawn. The size is also how
 * a paper is told apart from a picture a drawing was started over.
 */
export const PAPER_SIZE = { width: 1113, height: 1440 };

const cache = new Map<PaperId, Promise<Blob>>();

/** The paper's image, fetched once. */
export const loadPaper = (id: PaperId): Promise<Blob> => {
  let blob = cache.get(id);
  if (!blob) {
    const url = PAPERS.find((paper) => paper.id === id)?.url ?? "";
    blob = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Paper ${id} could not be loaded`);
      return response.blob();
    });
    // A failed fetch is tried again next time.
    blob.catch(() => cache.delete(id));
    cache.set(id, blob);
  }
  return blob;
};

interface SceneElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  locked?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The paper under a drawing: the bottom element, when it is a locked picture at the origin of a paper's size. */
export const findPaperElement = (canvas: Pick<CanvasHandle, "getScene">): string | undefined => {
  const bottom = (canvas.getScene().elements as readonly SceneElement[]).find((element) => !element.isDeleted);
  if (!bottom || bottom.type !== "image" || !bottom.locked || bottom.x !== 0 || bottom.y !== 0) return undefined;
  return Math.round(bottom.width) === PAPER_SIZE.width && Math.round(bottom.height) === PAPER_SIZE.height ? bottom.id : undefined;
};
