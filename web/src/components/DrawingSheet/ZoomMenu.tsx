import { type CanvasHandle, MAX_ZOOM, MIN_ZOOM } from "@usememos/canvas";
import { Button, Menu } from "@usememos/ui";
import { MinusIcon, PlusIcon, RotateCcwIcon, ScanSearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslate } from "@/utils/i18n";

/**
 * The zoom of the canvas on show, kept in step with it. `sync` reads it now; `schedule` reads
 * it on the next frame, for wheel and pinch gestures that fire many times a frame.
 */
export const useCanvasZoom = (getCanvas: () => CanvasHandle | null | undefined) => {
  const [zoom, setZoom] = useState(1);
  const frame = useRef<number | undefined>(undefined);
  const read = useRef(getCanvas);
  read.current = getCanvas;

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const sync = () => {
    const canvas = read.current();
    if (canvas) setZoom(canvas.getViewport().zoom);
  };
  const schedule = () => {
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      sync();
    });
  };
  return { zoom, sync, schedule };
};

/**
 * The canvas's zoom as a percentage on a quiet button, which opens Zoom in, Zoom out, Zoom to
 * fit and Reset zoom. The same control when viewing and when editing; zooming never changes
 * the drawing. `onOpenChange` lets the host hold the paper still while the menu is open, so a
 * click on the paper closes the menu without drawing.
 */
export const ZoomMenu = ({
  zoom,
  getCanvas,
  onZoomed,
  size,
  disabled,
  open,
  onOpenChange,
}: {
  zoom: number;
  getCanvas: () => CanvasHandle | null | undefined;
  /** Called after a menu action changed the zoom. */
  onZoomed: () => void;
  size?: "sm";
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useTranslate();
  const percent = `${Math.round(zoom * 100)}%`;
  const act = (change: (canvas: CanvasHandle) => void) => () => {
    const canvas = getCanvas();
    if (!canvas) return;
    change(canvas);
    onZoomed();
  };
  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size={size}
            disabled={disabled}
            className="min-w-14 tabular-nums"
            aria-label={`${t("editor.drawing.zoom")} ${percent}`}
          />
        }
      >
        {percent}
      </Menu.Trigger>
      <Menu.Popup side="top" align="start" data-theme="light" aria-label={t("editor.drawing.zoom")}>
        <Menu.Item
          icon={<PlusIcon />}
          disabled={zoom >= MAX_ZOOM}
          onClick={act((canvas) => canvas.zoomTo(canvas.getViewport().zoom * 1.2))}
        >
          {t("map.zoom-in")}
        </Menu.Item>
        <Menu.Item
          icon={<MinusIcon />}
          disabled={zoom <= MIN_ZOOM}
          onClick={act((canvas) => canvas.zoomTo(canvas.getViewport().zoom / 1.2))}
        >
          {t("map.zoom-out")}
        </Menu.Item>
        <Menu.Separator />
        <Menu.Item icon={<ScanSearchIcon />} onClick={act((canvas) => canvas.zoomToFit())}>
          {t("editor.drawing.zoom-to-fit")}
        </Menu.Item>
        <Menu.Item icon={<RotateCcwIcon />} onClick={act((canvas) => canvas.zoomTo(1))}>
          {t("attachment-preview.reset-zoom")}
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
};
