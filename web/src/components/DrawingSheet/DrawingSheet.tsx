import { type CanvasError, type CanvasHandle, drawingFileName, type Scene, type ToolName } from "@usememos/canvas";
import { Canvas } from "@usememos/canvas/react";
import { AlertDialog, Button, Dialog, Menu, Popover, Toggle, ToggleGroup, Tooltip } from "@usememos/ui";
import {
  CircleIcon,
  EraserIcon,
  ImageIcon,
  ImagePlusIcon,
  ImagesIcon,
  MousePointer2Icon,
  MoveUpRightIcon,
  PencilIcon,
  Redo2Icon,
  ScanIcon,
  SquareIcon,
  TypeIcon,
  Undo2Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { type ClipboardEvent, lazy, type ReactElement, Suspense, useEffect, useRef, useState } from "react";
import ImmichPickerDialog from "@/components/ImmichPicker/ImmichPickerDialog";
import { useImmichConnection } from "@/hooks/useImmichQueries";
import useMediaQuery from "@/hooks/useMediaQuery";
import { showErrorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { type Translations, useTranslate } from "@/utils/i18n";
import { primaryModifierGlyph } from "@/utils/platform";
import { DrawingDialogPopup, FloatingAction, FloatingBar, FloatingRow } from "./DrawingFrame";
import kidPixToolsUrl from "./kidpix/assets/tools.png";
import type { KidPixHandle, KidPixView } from "./kidpix/KidPixLayer";
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
  /** The scene read from the drawing's original file. */
  initialScene?: Scene;
  /** A picture to draw on: a file named like a drawing whose scene could not be read. */
  background?: Blob;
  /**
   * The finished drawing, a PNG with the scene embedded, named `drawing-YYYYMMDD-HHMMSS.canvas.png`.
   * A promise keeps Done busy until it settles; a rejection keeps the sheet open to retry.
   */
  onDone: (file: File) => void | Promise<void>;
  onClose: () => void;
}

/**
 * The drawing sheet: the paper fills the drawing dialog, with the controls floating on it.
 * `@usememos/canvas` draws and edits the scene; everything around it (the controls, strings,
 * theme, discard prompt) is memos'. On a phone the tools float at the bottom, in thumb
 * reach, with each control 44 px apart.
 */
const DrawingSheet = ({ mode, initialScene, background, onDone, onClose }: DrawingSheetProps) => {
  const t = useTranslate();
  const isWide = useMediaQuery("sm");
  // Small controls on a desktop; a phone keeps the 32px ones, 44px apart, for touch.
  const size = isWide ? "sm" : undefined;
  const { theme, ink, fontFamily } = useCanvasTheme();
  const canvasRef = useRef<CanvasHandle | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<ToolName>("pen");
  const [history, setHistory] = useState({ undo: false, redo: false });
  // Null follows the theme's ink, so a drawing started in one theme keeps reading in the other.
  const [color, setColor] = useState<string | null>(null);
  const [width, setWidth] = useState(2);
  const [isExporting, setIsExporting] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  // Drawing waits for a background picture, so no stroke can land before it and be marked saved with it.
  const [isPreparing, setIsPreparing] = useState(Boolean(background));
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

  // Runs once the canvas has mounted (see CanvasMounted): the pen is ready, and a
  // picture without a scene becomes the drawing's locked background.
  const setUpCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setTool("pen");
    if (!background) return;
    canvas
      .insertImage(background, { background: true })
      .then(() => {
        // The picture is where the drawing starts, not a change to discard.
        canvas.markSaved();
        canvas.zoomToFit();
      })
      .catch(() => showErrorToast(t("editor.drawing.image-failed")))
      .finally(() => setIsPreparing(false));
  };

  const syncHistory = () => {
    const canvas = canvasRef.current;
    setHistory({ undo: Boolean(canvas?.canUndo()), redo: Boolean(canvas?.canRedo()) });
  };

  const handleCanvasError = (error: CanvasError) => {
    if (error.operation === "insert-image" || error.operation === "load-image") showErrorToast(t("editor.drawing.image-failed"));
    else if (error.operation === "export-png") showErrorToast(t("editor.drawing.export-failed"));
    // A face of the UI font stack that cannot load (a local() alias, say) falls back to the
    // next one in the stack; nothing for the person to act on.
  };

  const chooseTool = (next: ToolName) => {
    setTool(next);
    canvasRef.current?.setTool(next);
  };

  const applyWidth = (strokeWidth: number) => {
    canvasRef.current?.setStyle({ strokeWidth });
    setWidth(strokeWidth);
  };

  const insertImages = (files: File[]) => {
    for (const file of files.filter((candidate) => candidate.type.startsWith("image/"))) {
      canvasRef.current?.insertImage(file).catch(() => showErrorToast(t("editor.drawing.image-failed")));
    }
  };

  /**
   * Adds the photos picked from Immich in the order they were picked. Several fan out from the
   * middle of the view, each a step down and to the right, and end up selected together, so
   * they can be moved as one or spread apart.
   */
  const insertPhotos = async (files: File[]) => {
    const canvas = canvasRef.current;
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
    const canvas = canvasRef.current;
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
    const canvas = canvasRef.current;
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
    if (surfaceRef.current?.contains(event.target as Node)) return;
    insertImages(Array.from(event.clipboardData.files));
  };

  // Cancel, Escape and the system back gesture all ask first when the drawing has changes.
  const requestClose = () => {
    if (canvasRef.current?.isDirty() || kidPixRef.current?.hasPaint()) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const handleDone = async () => {
    const canvas = canvasRef.current;
    if (!canvas || isExporting || isPreparing || isLeavingKidPix) return;
    // Text still being typed is part of the drawing.
    canvas.commitText();
    setIsExporting(true);
    try {
      // Paint still on the Kid Pix layer is part of the drawing.
      if (kidPix) {
        await addKidPixPaint();
        setKidPix(null);
      }
      const blob = await canvas.exportPng();
      await onDone(new File([blob], drawingFileName(), { type: "image/png" }));
      // Only once Done went through: after a failed save, Cancel still asks before discarding.
      // The host may have closed the sheet already.
      canvasRef.current?.markSaved();
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
                        canvasRef.current?.setStyle({ strokeColor: swatch.value });
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
          canvasRef.current?.undo();
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
          canvasRef.current?.redo();
          syncHistory();
        }}
      />
    </>
  );
  const viewControls = (
    <>
      <IconAction size={size} label={t("editor.drawing.zoom-to-fit")} icon={<ScanIcon />} onClick={() => canvasRef.current?.zoomToFit()} />
      {immichAvailable ? (
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
      )}
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
      <Button variant="ghost" size={size} loading={isLeavingKidPix} loadingLabel={t("editor.drawing.kidpix-exit")} onClick={leaveKidPix}>
        {t("editor.drawing.kidpix-exit")}
      </Button>
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
      disabled={isPreparing}
      loading={isExporting}
      loadingLabel={t("editor.drawing.done")}
    >
      {t("editor.drawing.done")}
    </Button>
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
            aria-busy={isPreparing || undefined}
            onPointerUp={syncHistory}
            onKeyUp={syncHistory}
          >
            <Canvas
              ref={canvasRef}
              className="absolute inset-0"
              autoFocus
              ariaLabel={title}
              initialScene={initialScene}
              theme={theme}
              tools={TOOL_NAMES}
              fontFamily={fontFamily}
              onChange={syncHistory}
              onToolChange={setTool}
              onError={handleCanvasError}
            />
            <CanvasMounted onMounted={setUpCanvas} />
          </div>

          {kidPix && (
            <Suspense fallback={null}>
              <KidPixLayer
                ref={kidPixRef}
                view={kidPix}
                paper={theme.paper ?? DRAWING_PAPER}
                muted={!kidPixSounds}
                compact={kidPixCompact}
                backdropSources={() => Array.from(surfaceRef.current?.querySelectorAll("canvas") ?? [])}
                labels={{
                  tools: t("editor.drawing.tools"),
                  color: t("editor.drawing.color"),
                  undo: t("editor.drawing.undo"),
                  clear: t("editor.drawing.kidpix-clear"),
                  previous: t("common.previous"),
                  next: t("common.next"),
                  noBackground: t("editor.drawing.kidpix-no-background"),
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
          ) : (
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
              {/* The way into Kid Pix mode sits alone above the tools: neither phone bar has room for it. */}
              <FloatingRow edge="bottom" className="bottom-[calc(72px+env(safe-area-inset-bottom))] justify-end">
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

/** An icon-only ghost Button named by its Tooltip, as every icon control in memos. */
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
