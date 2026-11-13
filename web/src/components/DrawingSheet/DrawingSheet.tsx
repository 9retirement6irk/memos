import { type CanvasError, type CanvasHandle, drawingFileName, type ToolName } from "@usememos/canvas";
import { Canvas } from "@usememos/canvas/react";
import { AlertDialog, Button, Dialog, Menu, Popover, Spinner, Toggle, ToggleGroup, Tooltip } from "@usememos/ui";
import {
  CircleIcon,
  EraserIcon,
  FilePlusIcon,
  ImageIcon,
  ImagePlusIcon,
  ImagesIcon,
  MousePointer2Icon,
  MoveUpRightIcon,
  NotebookTextIcon,
  PencilIcon,
  Redo2Icon,
  ScanIcon,
  SquareIcon,
  TypeIcon,
  Undo2Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { type ClipboardEvent, type ComponentProps, lazy, type ReactElement, Suspense, useEffect, useRef, useState } from "react";
import ImmichPickerDialog from "@/components/ImmichPicker/ImmichPickerDialog";
import { useImmichConnection } from "@/hooks/useImmichQueries";
import useMediaQuery from "@/hooks/useMediaQuery";
import { showErrorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { type Translations, useTranslate } from "@/utils/i18n";
import { primaryModifierGlyph } from "@/utils/platform";
import { DrawingDialogPopup, FloatingAction, FloatingBar, FloatingRow } from "./DrawingFrame";
import type { DrawingContent } from "./drawing";
import kidPixToolsUrl from "./kidpix/assets/tools.png";
import type { KidPixHandle, KidPixView } from "./kidpix/KidPixLayer";
import { PageTabs } from "./PageTabs";
import { type DrawingPage, type DrawingPagesResult, newPageKey } from "./pages";
import { findPaperElement, loadPaper, PAPERS, type PaperId } from "./paper/papers";
import { DRAWING_HUES, DRAWING_PAPER, useCanvasTheme } from "./useCanvasTheme";

const TOOLS: { name: ToolName; label: Translations; shortcut: string; icon: ReactElement }[] = [
  { name: "select", label: "editor.drawing.tool-select", shortcut: "V", icon: <MousePointer2Icon /> },
  { name: "pen", label: "editor.drawing.tool-pen", shortcut: "P", icon: <PencilIcon /> },
  { name: "eraser", label: "editor.drawing.tool-eraser", shortcut: "E", icon: <EraserIcon /> },
  { name: "rectangle", label: "editor.drawing.tool-rectangle", shortcut: "R", icon: <SquareIcon /> },
  { name: "ellipse", label: "editor.drawing.tool-ellipse", shortcut: "O", icon: <CircleIcon /> },
  { name: "arrow", label: "editor.drawing.tool-arrow", shortcut: "A", icon: <MoveUpRightIcon /> },
  { name: "text", label: "editor.drawing.tool-text", shortcut: "T", icon: <TypeIcon /> },
];
// One stable list, so the canvas does not reset its tools on every render.
const TOOL_NAMES = TOOLS.map((tool) => tool.name);

/** Kid Pix mode and its art load on first use, not with the sheet. */
const KidPixLayer = lazy(() => import("./kidpix/KidPixLayer"));

/** Below this height the tube and tray do not fit; Kid Pix mode uses its one-panel chrome, as on a phone. */
const KIDPIX_FULL_CHROME_HEIGHT = 620;

/** The canvas shrinks any picture over 1440 px a side, and one over 80% of the view. */
const KIDPIX_TILE_LIMIT = 1440;

/** Screen px between photos added together, so none hides the one before it. */
const PHOTO_CASCADE = 32;

const WIDTHS: { value: number; label: Translations }[] = [
  { value: 1, label: "editor.drawing.width-thin" },
  { value: 2, label: "editor.drawing.width-medium" },
  { value: 4, label: "editor.drawing.width-thick" },
];

export interface DrawingSheetProps {
  /** `edit` reopens a saved drawing; it changes the sheet's name and the discard prompt. */
  mode: "new" | "edit";
  /**
   * The memo's drawings, one page each, in the memo's order. A page's content is a scene
   * read from its file or, for a file whose scene could not be read, a picture to draw on.
   */
  pages: DrawingPage[];
  /** The key of the page the sheet opens on. */
  initialPage: string;
  /**
   * The finished drawings: each page that changed, and each added page drawn on, as a PNG with
   * its scene embedded, named `drawing-YYYYMMDD-HHMMSS.canvas.png`, with the sheet's page order.
   * A promise keeps Done busy until it settles; a rejection keeps the sheet open to retry.
   */
  onDone: (result: DrawingPagesResult) => void | Promise<void>;
  onClose: () => void;
}

/** A page's content: not read yet, being read, failed to read, or ready (blank when `content` is absent). */
type PageState = { status: "loading" } | { status: "failed" } | { status: "ready"; content?: DrawingContent };

const initialPageState = (page: DrawingPage): PageState | undefined =>
  page.content || !page.load ? { status: "ready", content: page.content } : undefined;

/**
 * The drawing sheet: the paper fills the drawing dialog, with the controls floating on it.
 * `@usememos/canvas` draws and edits the scene; everything around it (the controls, strings,
 * theme, discard prompt) is memos'. On a phone the tools float at the bottom, in thumb
 * reach, with each control 44 px apart.
 *
 * Pages: the memo's drawings, one canvas each, switched by the page tabs. A page's content is
 * read when it is first shown, and its canvas stays mounted (hidden) after that, so its undo
 * history survives a switch. Done exports only the pages that changed.
 */
const DrawingSheet = ({ mode, pages: initialPages, initialPage, onDone, onClose }: DrawingSheetProps) => {
  const t = useTranslate();
  const isWide = useMediaQuery("sm");
  // Small controls on a desktop; a phone keeps the 32px ones, 44px apart, for touch.
  const size = isWide ? "sm" : undefined;
  const { theme, ink, fontFamily } = useCanvasTheme();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<ToolName>("pen");
  const [history, setHistory] = useState({ undo: false, redo: false });
  // Null follows the theme's ink, so a drawing started in one theme keeps reading in the other.
  const [color, setColor] = useState<string | null>(null);
  const [width, setWidth] = useState(2);
  const [isExporting, setIsExporting] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pages, setPages] = useState(initialPages);
  const [pageStates, setPageStates] = useState<Record<string, PageState | undefined>>(() =>
    Object.fromEntries(initialPages.map((page) => [page.key, initialPageState(page)])),
  );
  const [activeKey, setActiveKey] = useState(initialPage);
  // The paper chosen for each page in this sheet, so an added page can follow the page before it.
  const [paperOf, setPaperOf] = useState<Record<string, PaperId | undefined>>({});
  // Read synchronously by the handlers, which may run before the switch renders.
  const activeRef = useRef(initialPage);
  // Pages shown at least once: their canvases stay mounted.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([initialPage]));
  const canvases = useRef(new Map<string, CanvasHandle>());
  const loads = useRef(new Map<string, AbortController>());
  // Drawing on a page waits for its background picture, so no stroke can land before it and be marked saved with it.
  const [preparing, setPreparing] = useState<ReadonlySet<string>>(() => new Set());
  const isPreparing = preparing.has(activeKey);
  // Kid Pix mode: a paint layer over the drawing, added to it as a picture when the mode ends.
  const kidPixRef = useRef<KidPixHandle | null>(null);
  const [kidPix, setKidPix] = useState<KidPixView | null>(null);
  const [kidPixSounds, setKidPixSounds] = useState(true);
  const [isLeavingKidPix, setIsLeavingKidPix] = useState(false);
  // Photos from Immich, offered only to a user who has connected it in Settings.
  const { data: immichConnection } = useImmichConnection();
  const immichAvailable = Boolean(immichConnection?.configured);
  const [immichOpen, setImmichOpen] = useState(false);
  const kidPixCompact = !isWide || (kidPix !== null && kidPix.height < KIDPIX_FULL_CHROME_HEIGHT);
  const title = t(mode === "edit" ? "editor.drawing.edit" : "editor.drawing.new-title");
  const currentColor = color ?? ink;
  const activeState = pageStates[activeKey];

  /** The canvas of the page on show. */
  const activeCanvas = () => canvases.current.get(activeRef.current);

  const syncHistory = () => {
    const canvas = activeCanvas();
    setHistory({ undo: Boolean(canvas?.canUndo()), redo: Boolean(canvas?.canRedo()) });
  };

  /** The tool and style chosen on another page carry over. The canvas has no selection here, so nothing is restyled. */
  const applyControls = (canvas: CanvasHandle) => {
    canvas.setTool(tool);
    canvas.setStyle(color ? { strokeColor: color, strokeWidth: width } : { strokeWidth: width });
  };

  // Runs once a page's canvas has mounted (see CanvasMounted): the tools are ready, and a
  // picture without a scene becomes the drawing's locked background.
  const setUpCanvas = (key: string, canvas: CanvasHandle, background?: Blob) => {
    canvases.current.set(key, canvas);
    applyControls(canvas);
    if (key === activeRef.current) syncHistory();
    if (!background) return;
    setPreparing((current) => new Set(current).add(key));
    canvas
      .insertImage(background, { background: true })
      .then(() => {
        // The picture is where the drawing starts, not a change to discard.
        canvas.markSaved();
        canvas.zoomToFit();
      })
      .catch(() => showErrorToast(t("editor.drawing.image-failed")))
      .finally(() =>
        setPreparing((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        }),
      );
  };

  const loadPage = (page: DrawingPage) => {
    if (!page.load || loads.current.has(page.key)) return;
    const controller = new AbortController();
    loads.current.set(page.key, controller);
    setPageStates((current) => ({ ...current, [page.key]: { status: "loading" } }));
    page
      .load(controller.signal)
      .then((content) => {
        if (!controller.signal.aborted) setPageStates((current) => ({ ...current, [page.key]: { status: "ready", content } }));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
        showErrorToast(t("editor.drawing.open-failed"));
        setPageStates((current) => ({ ...current, [page.key]: { status: "failed" } }));
      })
      .finally(() => {
        if (loads.current.get(page.key) === controller) loads.current.delete(page.key);
      });
  };

  // The page on show is read when it is first shown.
  const activePage = pages.find((page) => page.key === activeKey);
  useEffect(() => {
    if (activePage && pageStates[activePage.key] === undefined) loadPage(activePage);
  });
  useEffect(() => {
    const pending = loads.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
    };
  }, []);

  const showPage = (key: string) => {
    if (key === activeRef.current || kidPix) return;
    // Text still being typed stays on its page; a selection there must not take the next page's style.
    const leaving = activeCanvas();
    leaving?.commitText();
    leaving?.setSelection([]);
    activeRef.current = key;
    setActiveKey(key);
    setVisited((current) => new Set(current).add(key));
    const next = canvases.current.get(key);
    if (next) {
      applyControls(next);
      next.focus();
    }
    syncHistory();
  };

  // A new page goes right after the one on show, on the same paper, as in a notebook. The paper
  // goes in as the page's starting picture, so a page left blank is still dropped at Done.
  const addPage = () => {
    if (kidPix) return;
    const key = newPageKey();
    // Read now: the update runs after showPage below has made the new page the one on show.
    const after = activeRef.current;
    const paper = paperOf[after];
    setPages((current) => {
      const at = current.findIndex((page) => page.key === after);
      const next = [...current];
      next.splice(at + 1, 0, { key });
      return next;
    });
    if (paper) {
      setPaperOf((current) => ({ ...current, [key]: paper }));
      setPageStates((current) => ({ ...current, [key]: { status: "loading" } }));
      loadPaper(paper)
        .then((background) => setPageStates((current) => ({ ...current, [key]: { status: "ready", content: { background } } })))
        .catch(() => {
          showErrorToast(t("editor.drawing.image-failed"));
          setPageStates((current) => ({ ...current, [key]: { status: "ready" } }));
        });
    } else {
      setPageStates((current) => ({ ...current, [key]: { status: "ready" } }));
    }
    showPage(key);
  };

  /**
   * Puts a paper under the page on show, in place of the paper it has, or takes the paper away.
   * A picture the drawing was started over stays: only a paper is replaced.
   */
  const choosePaper = async (id: PaperId | null) => {
    const key = activeRef.current;
    const canvas = activeCanvas();
    if (!canvas || kidPix || preparing.has(key)) return;
    canvas.commitText();
    const wasEmpty = canvas.isEmpty();
    setPreparing((current) => new Set(current).add(key));
    try {
      // Fetched first, so a paper that fails to load leaves the page as it was.
      const blob = id ? await loadPaper(id) : undefined;
      const current = findPaperElement(canvas);
      if (current) {
        canvas.setLocked([current], false);
        canvas.setSelection([current]);
        canvas.deleteSelection();
      }
      if (blob) {
        await canvas.insertImage(blob, { background: true });
        canvas.setSelection([]);
        if (wasEmpty) canvas.zoomToFit();
      }
      // Selecting the old paper switched to the select tool.
      canvas.setTool(tool);
      setPaperOf((papers) => ({ ...papers, [key]: id ?? undefined }));
    } catch {
      showErrorToast(t("editor.drawing.image-failed"));
    } finally {
      setPreparing((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      syncHistory();
    }
  };

  const handleCanvasError = (error: CanvasError) => {
    if (error.operation === "insert-image" || error.operation === "load-image") showErrorToast(t("editor.drawing.image-failed"));
    else if (error.operation === "export-png") showErrorToast(t("editor.drawing.export-failed"));
    // A face of the UI font stack that cannot load (a local() alias, say) falls back to the
    // next one in the stack; nothing for the person to act on.
  };

  const chooseTool = (next: ToolName) => {
    setTool(next);
    activeCanvas()?.setTool(next);
  };

  const applyWidth = (strokeWidth: number) => {
    activeCanvas()?.setStyle({ strokeWidth });
    setWidth(strokeWidth);
  };

  // In Kid Pix mode a picture goes onto the paint layer, in a frame to move, resize and flip.
  const addKidPixPictures = (files: File[]) => {
    kidPixRef.current
      ?.addPictures(files)
      .then((failed) => {
        if (failed > 0) showErrorToast(t("editor.drawing.image-failed"));
      })
      .catch(() => showErrorToast(t("editor.drawing.image-failed")));
  };

  const insertImages = (files: File[]) => {
    const images = files.filter((candidate) => candidate.type.startsWith("image/"));
    if (kidPix) {
      if (images.length > 0) addKidPixPictures(images);
      return;
    }
    for (const file of files.filter((candidate) => candidate.type.startsWith("image/"))) {
      activeCanvas()
        ?.insertImage(file)
        .catch(() => showErrorToast(t("editor.drawing.image-failed")));
    }
  };

  /**
   * Adds the photos picked from Immich in the order they were picked. Several fan out from the
   * middle of the view, each a step down and to the right, and end up selected together, so
   * they can be moved as one or spread apart.
   */
  const insertPhotos = async (files: File[]) => {
    if (kidPix) {
      addKidPixPictures(files);
      return;
    }
    const canvas = activeCanvas();
    const surface = surfaceRef.current;
    if (!canvas || !surface) return;
    const { zoom, scrollX, scrollY } = canvas.getViewport();
    const centerX = surface.clientWidth / 2 / zoom - scrollX;
    const centerY = surface.clientHeight / 2 / zoom - scrollY;
    const step = PHOTO_CASCADE / zoom;
    const ids: string[] = [];
    let failed = false;
    for (const [index, file] of files.entries()) {
      const offset = (index - (files.length - 1) / 2) * step;
      try {
        const id = await canvas.insertImage(file, files.length > 1 ? { at: [centerX + offset, centerY + offset] } : undefined);
        if (id) ids.push(id);
      } catch {
        failed = true;
      }
    }
    if (failed) showErrorToast(t("editor.drawing.image-failed"));
    if (ids.length > 1) canvas.setSelection(ids);
    syncHistory();
  };

  const enterKidPix = () => {
    const canvas = activeCanvas();
    const surface = surfaceRef.current;
    if (!canvas || !surface || isPreparing) return;
    // Text still being typed is part of the drawing, and handles are not part of the picture.
    canvas.commitText();
    canvas.setSelection([]);
    // One layer pixel is one drawing px; zoomed out, the layer would be larger than the screen.
    if (canvas.getViewport().zoom < 1) canvas.zoomTo(1);
    setKidPix({ ...canvas.getViewport(), width: surface.clientWidth, height: surface.clientHeight });
  };

  /**
   * Lifts the Kid Pix paint off its layer and adds it to the drawing, where it painted. The
   * canvas places a picture by its center, at its own pixel size unless it is over 80% of the
   * view, so the paint goes in as tiles small enough to keep their size, grouped as one.
   */
  const addKidPixPaint = async () => {
    const canvas = activeCanvas();
    const layer = kidPixRef.current;
    if (!canvas || !layer || !kidPix) return;
    const maxSide = Math.max(64, Math.min(KIDPIX_TILE_LIMIT, Math.floor((0.8 * Math.min(kidPix.width, kidPix.height)) / kidPix.zoom)));
    const ids: string[] = [];
    for (const tile of await layer.takeTiles(maxSide)) {
      const id = await canvas.insertImage(tile.blob, {
        at: [tile.x + tile.width / 2 - kidPix.scrollX, tile.y + tile.height / 2 - kidPix.scrollY],
      });
      if (id) ids.push(id);
    }
    if (ids.length > 1) {
      canvas.setSelection(ids);
      canvas.groupSelection();
    }
  };

  const leaveKidPix = async () => {
    if (isLeavingKidPix) return;
    setIsLeavingKidPix(true);
    try {
      await addKidPixPaint();
      setKidPix(null);
      syncHistory();
    } catch (error) {
      console.error(error);
      // The mode stays open with the paint on it, to try again.
      showErrorToast(t("editor.drawing.image-failed"));
    } finally {
      setIsLeavingKidPix(false);
    }
  };

  // The drawing surface inserts pasted pictures itself; a paste anywhere else on the sheet lands there too.
  const handlePaste = (event: ClipboardEvent) => {
    // In Kid Pix mode the paint layer has the keys, and a pasted picture belongs to it wherever the paste lands.
    if (!kidPix && surfaceRef.current?.contains(event.target as Node)) return;
    insertImages(Array.from(event.clipboardData.files));
  };

  // Cancel, Escape and the system back gesture all ask first when any page has changes.
  const requestClose = () => {
    if (Array.from(canvases.current.values()).some((canvas) => canvas.isDirty()) || kidPixRef.current?.hasPaint()) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const handleDone = async () => {
    if (isExporting || preparing.size > 0 || isLeavingKidPix) return;
    // Text still being typed is part of its drawing.
    for (const canvas of canvases.current.values()) canvas.commitText();
    setIsExporting(true);
    try {
      // Paint still on the Kid Pix layer is part of the drawing.
      if (kidPix) {
        await addKidPixPaint();
        setKidPix(null);
      }
      // A page never shown, or shown and left as it was, keeps its file. An added page left blank is dropped.
      const changed = pages.flatMap((page) => {
        const canvas = canvases.current.get(page.key);
        return canvas?.isDirty() ? [{ key: page.key, canvas }] : [];
      });
      const files: DrawingPagesResult["files"] = [];
      for (const { key, canvas } of changed) {
        const blob = await canvas.exportPng();
        files.push({ key, file: new File([blob], drawingFileName(), { type: "image/png" }) });
      }
      await onDone({ order: pages.map((page) => page.key), files });
      // Only once Done went through: after a failed save, Cancel still asks before discarding.
      // The host may have closed the sheet already.
      for (const { canvas } of changed) canvas.markSaved();
    } catch (error) {
      console.error(error);
      showErrorToast(t("editor.drawing.export-failed"));
    } finally {
      setIsExporting(false);
    }
  };

  const toolRow = (
    <div role="group" aria-label={t("editor.drawing.tools")} className={cn("flex items-center", isWide ? "gap-0.5" : "gap-3")}>
      {TOOLS.map((item) => (
        <Tooltip.Root key={item.name}>
          <Tooltip.Trigger
            render={
              <Toggle
                size={size}
                aria-label={t(item.label)}
                icon={item.icon}
                pressed={tool === item.name}
                onPressedChange={() => chooseTool(item.name)}
              />
            }
          />
          <Tooltip.Popup shortcut={item.shortcut}>{t(item.label)}</Tooltip.Popup>
        </Tooltip.Root>
      ))}
    </div>
  );

  const swatches = [{ key: "ink", value: ink }, ...DRAWING_HUES.map((hue) => ({ key: hue.key, value: hue.value }))] as const;
  const styleControl = (
    <Popover.Root>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Popover.Trigger
              render={
                <Button
                  variant="ghost"
                  size={size}
                  aria-label={t("editor.drawing.style")}
                  icon={<CircleIcon style={{ color: currentColor, fill: currentColor }} />}
                />
              }
            />
          }
        />
        <Tooltip.Popup>{t("editor.drawing.style")}</Tooltip.Popup>
      </Tooltip.Root>
      <Popover.Popup side={isWide ? "bottom" : "top"} aria-label={t("editor.drawing.style")}>
        <div className="flex flex-col gap-2">
          <span className="mu-label-sm text-mu-ink-muted">{t("editor.drawing.color")}</span>
          <div
            role="group"
            aria-label={t("editor.drawing.color")}
            className={cn("grid justify-items-start", isWide ? "grid-cols-8 gap-0.5" : "grid-cols-4 gap-3")}
          >
            {swatches.map((swatch) => (
              <Tooltip.Root key={swatch.key}>
                <Tooltip.Trigger
                  render={
                    <Toggle
                      aria-label={t(`editor.drawing.color-${swatch.key}`)}
                      pressed={currentColor.toLowerCase() === swatch.value.toLowerCase()}
                      onPressedChange={() => {
                        activeCanvas()?.setStyle({ strokeColor: swatch.value });
                        setColor(swatch.key === "ink" ? null : swatch.value);
                      }}
                      icon={<CircleIcon style={{ color: swatch.value, fill: swatch.value }} />}
                    />
                  }
                />
                <Tooltip.Popup>{t(`editor.drawing.color-${swatch.key}`)}</Tooltip.Popup>
              </Tooltip.Root>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="mu-label-sm text-mu-ink-muted">{t("editor.drawing.width")}</span>
          <ToggleGroup
            fullWidth
            aria-label={t("editor.drawing.width")}
            value={[String(width)]}
            onValueChange={([next]) => next && applyWidth(Number(next))}
          >
            {WIDTHS.map((option) => (
              <Toggle key={option.value} value={String(option.value)}>
                {t(option.label)}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
      </Popover.Popup>
    </Popover.Root>
  );

  const paperControl = (
    <Popover.Root>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Popover.Trigger
              render={
                <Button
                  variant="ghost"
                  size={size}
                  aria-label={t("editor.drawing.paper")}
                  icon={<NotebookTextIcon />}
                  disabled={isPreparing || activeState?.status !== "ready"}
                />
              }
            />
          }
        />
        <Tooltip.Popup>{t("editor.drawing.paper")}</Tooltip.Popup>
      </Tooltip.Root>
      <Popover.Popup side={isWide ? "bottom" : "top"} aria-label={t("editor.drawing.paper")}>
        <PaperChoices
          chosen={() => {
            // The paper chosen here, or, on a drawing that already had one, a paper of unknown kind.
            if (paperOf[activeKey]) return paperOf[activeKey];
            const canvas = canvases.current.get(activeKey);
            return canvas && findPaperElement(canvas) ? undefined : "plain";
          }}
          disabled={isPreparing}
          onChoose={(id) => void choosePaper(id === "plain" ? null : id)}
        />
      </Popover.Popup>
    </Popover.Root>
  );

  const modifier = primaryModifierGlyph();
  const historyControls = (
    <>
      <IconAction
        size={size}
        label={t("editor.drawing.undo")}
        shortcut={`${modifier} Z`}
        icon={<Undo2Icon />}
        disabled={!history.undo}
        onClick={() => {
          activeCanvas()?.undo();
          syncHistory();
        }}
      />
      <IconAction
        size={size}
        label={t("editor.drawing.redo")}
        shortcut={`⇧ ${modifier} Z`}
        icon={<Redo2Icon />}
        disabled={!history.redo}
        onClick={() => {
          activeCanvas()?.redo();
          syncHistory();
        }}
      />
    </>
  );
  const imageControl = immichAvailable ? (
    // With Immich connected, the picture comes from this device or from there.
    <Menu.Root modal={false} size={size ?? "md"}>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Menu.Trigger
              render={<Button variant="ghost" size={size} aria-label={t("editor.insert-menu.insert-image")} icon={<ImagePlusIcon />} />}
            />
          }
        />
        <Tooltip.Popup>{t("editor.insert-menu.insert-image")}</Tooltip.Popup>
      </Tooltip.Root>
      <Menu.Popup>
        <Menu.Item icon={<ImageIcon />} onClick={() => fileInputRef.current?.click()}>
          {t("editor.drawing.image-from-device")}
        </Menu.Item>
        <Menu.Item icon={<ImagesIcon />} onClick={() => setImmichOpen(true)}>
          {t("immich.insert")}
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  ) : (
    <IconAction
      size={size}
      label={t("editor.insert-menu.insert-image")}
      icon={<ImagePlusIcon />}
      onClick={() => fileInputRef.current?.click()}
    />
  );
  const viewControls = (
    <>
      <IconAction size={size} label={t("editor.drawing.zoom-to-fit")} icon={<ScanIcon />} onClick={() => activeCanvas()?.zoomToFit()} />
      {imageControl}
      {paperControl}
    </>
  );
  // The Wacky Brush button from the Kid Pix tube, so the way in looks like where it leads.
  const kidPixIcon = (
    <span aria-hidden className="mu-icon block overflow-hidden rounded-mu-sm">
      <span
        className="block h-[60px] w-[58px] origin-top-left scale-[0.3]"
        style={{ backgroundImage: `url(${kidPixToolsUrl})`, backgroundPosition: "-2px -62px" }}
      />
    </span>
  );
  const kidPixEnter = (
    <IconAction size={size} label={t("editor.drawing.kidpix")} icon={kidPixIcon} disabled={isPreparing} onClick={enterKidPix} />
  );
  const kidPixControls = (
    <>
      {isWide ? (
        <Button variant="ghost" size={size} loading={isLeavingKidPix} loadingLabel={t("editor.drawing.kidpix-exit")} onClick={leaveKidPix}>
          {t("editor.drawing.kidpix-exit")}
        </Button>
      ) : (
        // A phone's top row has no room for the words beside Cancel, the picture button and Done.
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <Button
                variant="ghost"
                size={size}
                aria-label={t("editor.drawing.kidpix-exit")}
                icon={<PencilIcon />}
                loading={isLeavingKidPix}
                loadingLabel={t("editor.drawing.kidpix-exit")}
                onClick={leaveKidPix}
              />
            }
          />
          <Tooltip.Popup>{t("editor.drawing.kidpix-exit")}</Tooltip.Popup>
        </Tooltip.Root>
      )}
      {imageControl}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Toggle
              size={size}
              aria-label={t("editor.drawing.kidpix-sounds")}
              icon={kidPixSounds ? <Volume2Icon /> : <VolumeXIcon />}
              pressed={kidPixSounds}
              onPressedChange={setKidPixSounds}
            />
          }
        />
        <Tooltip.Popup>{t("editor.drawing.kidpix-sounds")}</Tooltip.Popup>
      </Tooltip.Root>
    </>
  );
  const cancelButton = (
    <Button variant="ghost" size={size} onClick={requestClose}>
      {t("common.cancel")}
    </Button>
  );
  const doneButton = (
    <Button
      variant="primary"
      size={size}
      onClick={handleDone}
      disabled={preparing.size > 0}
      loading={isExporting}
      loadingLabel={t("editor.drawing.done")}
    >
      {t("editor.drawing.done")}
    </Button>
  );
  const pageTabs = (
    <PageTabs
      keys={pages.map((page) => page.key)}
      active={activeKey}
      onSelect={showPage}
      size={size}
      disabled={isExporting}
      className={isWide ? undefined : "gap-3"}
    >
      <IconAction size={size} label={t("editor.drawing.add-page")} icon={<FilePlusIcon />} disabled={isExporting} onClick={addPage} />
    </PageTabs>
  );

  return (
    <Dialog.Root
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        // The sheet closes only through requestClose, which asks first when there are changes.
        eventDetails.cancel();
        // Escape on the drawing surface leaves the current tool or selection; it belongs to the canvas.
        const escapeOnSurface = eventDetails.reason === "escape-key" && surfaceRef.current?.contains(eventDetails.event.target as Node);
        if (!escapeOnSurface) requestClose();
      }}
    >
      <DrawingDialogPopup label={title}>
        <div className="relative h-full w-full" style={{ background: theme.paper }} onPaste={handlePaste}>
          <Dialog.Title className="mu-visually-hidden">{title}</Dialog.Title>

          {/* Undo and redo follow every gesture and shortcut as it ends; onChange alone is debounced. */}
          <div
            ref={surfaceRef}
            className={cn("absolute inset-0", isPreparing && "pointer-events-none")}
            aria-busy={isPreparing || activeState?.status === "loading" || undefined}
            onPointerUp={syncHistory}
            onKeyUp={syncHistory}
          >
            {pages.map((page, index) => {
              const state = pageStates[page.key];
              if (!visited.has(page.key) || state?.status !== "ready") return null;
              const shown = page.key === activeKey;
              // Hidden pages keep their size, so their view is where it was when they come back.
              return (
                <div
                  key={page.key}
                  className={cn("absolute inset-0", !shown && "invisible")}
                  inert={!shown}
                  data-drawing-page={shown ? "shown" : undefined}
                >
                  <PageCanvas
                    className="absolute inset-0"
                    autoFocus={page.key === initialPage}
                    ariaLabel={pages.length > 1 ? `${title}, ${t("editor.drawing.page", { number: index + 1 })}` : title}
                    initialScene={state.content?.scene}
                    theme={theme}
                    tools={TOOL_NAMES}
                    fontFamily={fontFamily}
                    onChange={syncHistory}
                    onToolChange={setTool}
                    onError={handleCanvasError}
                    onMounted={(canvas) => setUpCanvas(page.key, canvas, state.content?.background)}
                  />
                </div>
              );
            })}
            {activeState?.status === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner label={t("editor.blocks.loading")} />
              </div>
            )}
            {activeState?.status === "failed" && activePage && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <span className="mu-body text-mu-ink-muted">{t("editor.drawing.open-failed")}</span>
                <Button variant="neutral" size={size} onClick={() => loadPage(activePage)}>
                  {t("common.retry")}
                </Button>
              </div>
            )}
          </div>

          {kidPix && (
            <Suspense fallback={null}>
              <KidPixLayer
                ref={kidPixRef}
                view={kidPix}
                paper={theme.paper ?? DRAWING_PAPER}
                muted={!kidPixSounds}
                compact={kidPixCompact}
                // Only the page on show is under the paint; hidden pages keep their canvases too.
                backdropSources={() => Array.from(surfaceRef.current?.querySelectorAll("[data-drawing-page='shown'] canvas") ?? [])}
                labels={{
                  tools: t("editor.drawing.tools"),
                  color: t("editor.drawing.color"),
                  undo: t("editor.drawing.undo"),
                  clear: t("editor.drawing.kidpix-clear"),
                  previous: t("common.previous"),
                  next: t("common.next"),
                  noBackground: t("editor.drawing.kidpix-no-background"),
                  resize: t("editor.drawing.kidpix-resize"),
                  flipHorizontal: t("editor.drawing.kidpix-flip-horizontal"),
                  flipVertical: t("editor.drawing.kidpix-flip-vertical"),
                  size: t("editor.drawing.width"),
                  sizes: [t("editor.drawing.width-thin"), t("editor.drawing.width-medium"), t("editor.drawing.width-thick")],
                  font: t("editor.drawing.kidpix-font"),
                  fontSize: t("editor.drawing.kidpix-font-size"),
                  bold: t("editor.format.bold"),
                  italic: t("editor.format.italic"),
                  underline: t("editor.drawing.kidpix-underline"),
                  aligns: [
                    t("editor.blocks.image-align-left"),
                    t("editor.blocks.image-align-center"),
                    t("editor.blocks.image-align-right"),
                  ],
                  readAloud: t("editor.drawing.kidpix-read-aloud"),
                  voice: t("editor.drawing.kidpix-voice"),
                }}
              />
            </Suspense>
          )}

          {kidPix ? (
            // Cancel and Done stay memos' own; past the tube when the full chrome is up. Cancel
            // gets a bar here: a Kid Pix background would swallow a bare ghost button.
            <FloatingRow edge="top" className={cn(!kidPixCompact && "left-[148px]")}>
              <FloatingBar>{cancelButton}</FloatingBar>
              <FloatingBar>{kidPixControls}</FloatingBar>
              <FloatingAction>{doneButton}</FloatingAction>
            </FloatingRow>
          ) : isWide ? (
            <FloatingRow edge="top">
              <FloatingAction>{cancelButton}</FloatingAction>
              <FloatingBar>
                {toolRow}
                <Divider />
                {styleControl}
                <Divider />
                {historyControls}
                <Divider />
                {viewControls}
                <Divider />
                {kidPixEnter}
              </FloatingBar>
              <FloatingAction>{doneButton}</FloatingAction>
            </FloatingRow>
          ) : null}
          {!kidPix && isWide && <FloatingRow edge="bottom">{pageTabs}</FloatingRow>}
          {!kidPix && !isWide && (
            <>
              <FloatingRow edge="top">
                <FloatingAction>{cancelButton}</FloatingAction>
                <FloatingBar className="gap-3">
                  {historyControls}
                  {viewControls}
                </FloatingBar>
                <FloatingAction>{doneButton}</FloatingAction>
              </FloatingRow>
              {/* The tools in thumb reach. Under 380px the divider goes and the bar nears the
                  edges, so a 360px screen keeps 44px between targets. */}
              <FloatingRow edge="bottom" className="max-[380px]:inset-x-1.5">
                <FloatingBar className="gap-3">
                  {toolRow}
                  <Divider className="mx-0 max-[380px]:hidden" />
                  {styleControl}
                </FloatingBar>
              </FloatingRow>
              {/* The pages and the way into Kid Pix mode sit above the tools: neither phone bar has room for them. */}
              <FloatingRow edge="bottom" className="bottom-[calc(72px+env(safe-area-inset-bottom))] justify-between">
                {pageTabs}
                <FloatingBar>{kidPixEnter}</FloatingBar>
              </FloatingRow>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              insertImages(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>

        {immichAvailable && (
          <ImmichPickerDialog open={immichOpen} onOpenChange={setImmichOpen} size="preview" onPick={(files) => void insertPhotos(files)} />
        )}

        <AlertDialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
          <AlertDialog.Popup>
            <AlertDialog.Title>
              {t(mode === "edit" ? "editor.drawing.discard-edit-title" : "editor.drawing.discard-title")}
            </AlertDialog.Title>
            <AlertDialog.Description>
              {t(mode === "edit" ? "editor.drawing.discard-edit-description" : "editor.drawing.discard-description")}
            </AlertDialog.Description>
            <AlertDialog.Footer>
              <AlertDialog.Close render={<Button variant="ghost">{t("editor.drawing.keep-drawing")}</Button>} />
              <Button
                variant="danger"
                onClick={() => {
                  setDiscardOpen(false);
                  onClose();
                }}
              >
                {t("editor.drawing.discard")}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Popup>
        </AlertDialog.Root>
      </DrawingDialogPopup>
    </Dialog.Root>
  );
};

/**
 * Calls back once, after the canvas beside it has mounted. The canvas creates its engine in
 * a layout effect inside the dialog's portal, which mounts after the sheet's own effects;
 * a sibling's passive effect runs after every layout effect, so the handle is live by then.
 */
const CanvasMounted = ({ onMounted }: { onMounted: () => void }) => {
  const callback = useRef(onMounted);
  useEffect(() => {
    callback.current();
  }, []);
  return null;
};

/** One page's canvas, handed to the sheet once it has mounted. */
const PageCanvas = ({ onMounted, ...props }: ComponentProps<typeof Canvas> & { onMounted: (canvas: CanvasHandle) => void }) => {
  const ref = useRef<CanvasHandle | null>(null);
  return (
    <>
      <Canvas ref={ref} {...props} />
      <CanvasMounted onMounted={() => ref.current && onMounted(ref.current)} />
    </>
  );
};

/** An icon-only ghost Button named by its Tooltip, as every icon control in memos. */
/** The papers to choose from, read when the menu opens. */
const PaperChoices = ({
  chosen,
  disabled,
  onChoose,
}: {
  chosen: () => PaperId | "plain" | undefined;
  disabled: boolean;
  onChoose: (id: PaperId | "plain") => void;
}) => {
  const t = useTranslate();
  const current = chosen();
  return (
    <div role="group" aria-label={t("editor.drawing.paper")} className="grid grid-cols-3 gap-2" data-drawing-papers="">
      {[{ id: "plain" as const, url: undefined }, ...PAPERS].map((paper) => {
        const on = current === paper.id;
        return (
          <Popover.Close
            key={paper.id}
            render={
              <button
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onChoose(paper.id)}
                className={cn(
                  "mu-focus flex w-20 flex-col items-center gap-1 rounded-mu-md border p-1.5",
                  on ? "border-mu-edge bg-mu-hover" : "border-transparent hover:bg-mu-hover",
                )}
              />
            }
          >
            <span
              aria-hidden
              className="block h-[78px] w-[60px] overflow-hidden rounded-mu-sm border border-mu-line"
              style={{ background: paper.url ? `${DRAWING_PAPER} url(${paper.url}) 0 0 / 200px auto no-repeat` : DRAWING_PAPER }}
            />
            <span className="mu-caption text-center">{t(`editor.drawing.paper-${paper.id}`)}</span>
          </Popover.Close>
        );
      })}
    </div>
  );
};

const IconAction = ({
  label,
  icon,
  size,
  shortcut,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactElement;
  size?: "sm";
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <Tooltip.Root>
    <Tooltip.Trigger render={<Button variant="ghost" size={size} aria-label={label} icon={icon} disabled={disabled} onClick={onClick} />} />
    <Tooltip.Popup shortcut={shortcut}>{label}</Tooltip.Popup>
  </Tooltip.Root>
);

const Divider = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn("mx-1 h-5 w-px shrink-0 bg-mu-line", className)} />
);

export default DrawingSheet;
