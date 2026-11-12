import { Button, buttonClasses, Skeleton } from "@usememos/ui";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ExternalLinkIcon, FileTextIcon } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/proto/api/attachment_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { DocumentRow } from "./AttachmentListView";
import { openPdf } from "./pdfDocument";

/** A US Letter page, until the real first page says otherwise. */
const DEFAULT_ASPECT_RATIO = 8.5 / 11;
/** Re-render only when the width changes by this much, not on every pixel of a resize. */
const WIDTH_STEP = 32;

type PdfState = { status: "idle" | "loading" | "error" } | { status: "ready"; pdf: PDFDocumentProxy };

/** Starts work only once the element is on or near the screen, so a long timeline opens no PDF it never shows. */
const useNearViewport = (ref: React.RefObject<HTMLElement | null>): boolean => {
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (near || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
};

const usePdf = (url: string, enabled: boolean): PdfState => {
  const [state, setState] = useState<PdfState>({ status: "idle" });
  useEffect(() => {
    if (!enabled) return;
    setState({ status: "loading" });
    const opened = openPdf(url);
    let active = true;
    opened.document.then(
      (pdf) => active && setState({ status: "ready", pdf }),
      () => active && setState({ status: "error" }),
    );
    return () => {
      active = false;
      opened.close();
    };
  }, [url, enabled]);
  return state;
};

/** Draws one page into the canvas at the frame's width and the screen's pixel density. */
const usePageRender = (
  pdf: PDFDocumentProxy | undefined,
  pageNumber: number,
  frameRef: React.RefObject<HTMLDivElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) => {
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  const [rendered, setRendered] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setWidth(Math.max(WIDTH_STEP, Math.ceil(frame.clientWidth / WIDTH_STEP) * WIDTH_STEP));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frameRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdf || !canvas || width === 0) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | undefined;
    setRendered(false);
    pdf
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        setAspectRatio(base.width / base.height);
        const scale = (width * (window.devicePixelRatio || 1)) / base.width;
        const viewport = page.getViewport({ scale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        renderTask = page.render({ canvas, viewport });
        return renderTask.promise;
      })
      .then(
        () => !cancelled && setRendered(true),
        () => undefined, // A cancelled render rejects; a broken page keeps the placeholder.
      );
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, width, canvasRef]);

  return { aspectRatio, rendered };
};

/**
 * A PDF attachment shown in the memo: its pages, one at a time, on a sheet the width of the
 * memo (up to a readable size), with the page count and controls underneath. It falls back to
 * the file row when the PDF can't be opened (damaged, encrypted, or not a PDF after all).
 */
const PdfAttachment = ({ attachment }: { attachment: Attachment }) => {
  const t = useTranslate();
  const url = getAttachmentUrl(attachment);
  const figureRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const near = useNearViewport(figureRef);
  const state = usePdf(url, near);
  const pdf = state.status === "ready" ? state.pdf : undefined;
  const pageCount = pdf?.numPages ?? 0;
  const [pageNumber, setPageNumber] = useState(1);
  const { aspectRatio, rendered } = usePageRender(pdf, pageNumber, frameRef, canvasRef);

  useEffect(() => {
    setPageNumber(1);
  }, [url]);

  if (state.status === "error") {
    return <DocumentRow attachment={attachment} />;
  }

  const pageLabel = pageCount > 0 ? t("attachment-pdf.page-of", { current: pageNumber, total: pageCount }) : undefined;

  return (
    <figure ref={figureRef} data-pdf-attachment className="m-0 flex w-full max-w-md flex-col gap-1">
      <div
        ref={frameRef}
        data-pdf-page
        className="relative w-full overflow-hidden rounded-mu-md border border-mu-line bg-white shadow-mu-raised"
        style={{ aspectRatio }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={pageLabel ? `${attachment.filename}, ${pageLabel}` : attachment.filename}
          className={cn("block size-full", !rendered && "invisible")}
        />
        {!rendered && <Skeleton className="absolute inset-0 rounded-none" />}
      </div>
      <figcaption className="mu-compact flex min-w-0 items-center gap-1">
        <FileTextIcon aria-hidden="true" className="mu-icon-sm shrink-0 text-mu-ink-muted" />
        <span className="min-w-0 flex-1 truncate mu-caption text-mu-ink" title={attachment.filename}>
          {attachment.filename}
        </span>
        {pageLabel && <span className="shrink-0 mu-caption tabular-nums text-mu-ink-muted">{pageLabel}</span>}
        {pageCount > 1 && (
          <>
            <Button
              variant="ghost"
              size="xs"
              icon={<ChevronLeftIcon className="rtl:rotate-180" />}
              aria-label={t("attachment-pdf.previous-page")}
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            />
            <Button
              variant="ghost"
              size="xs"
              icon={<ChevronRightIcon className="rtl:rotate-180" />}
              aria-label={t("attachment-pdf.next-page")}
              disabled={pageNumber >= pageCount}
              onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
            />
          </>
        )}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={t("common.open-name", { name: attachment.filename })}
          aria-label={t("common.open-name", { name: attachment.filename })}
          className={buttonClasses({ variant: "ghost", size: "xs", iconOnly: true })}
        >
          <ExternalLinkIcon className="mu-icon-sm" />
        </a>
        <a
          href={url}
          download
          title={t("common.download")}
          aria-label={t("common.download-name", { name: attachment.filename })}
          className={buttonClasses({ variant: "ghost", size: "xs", iconOnly: true })}
        >
          <DownloadIcon className="mu-icon-sm" />
        </a>
      </figcaption>
    </figure>
  );
};

export default PdfAttachment;
