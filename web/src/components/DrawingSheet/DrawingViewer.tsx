import type { CanvasHandle } from "@usememos/canvas";
import { Canvas } from "@usememos/canvas/react";
import { Button, Dialog, Spinner, Tooltip } from "@usememos/ui";
import { PaletteIcon, XIcon } from "lucide-react";
import { type ReactElement, useEffect, useEffectEvent, useRef, useState } from "react";
import { uploadService } from "@/components/MemoEditor/edit/services/uploadService";
import { memoServiceClient } from "@/connect";
import useCurrentUser from "@/hooks/useCurrentUser";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { showErrorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/proto/api/attachment_service_pb";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { canManageAttachment, canManageMemo } from "@/utils/user";
import { DrawingDialogPopup, FloatingAction, FloatingBar, FloatingRow } from "./DrawingFrame";
import DrawingSheet from "./DrawingSheet";
import { DrawingActionError, type DrawingContent, fetchDrawingFile, isDrawingFilename, readDrawing, sceneContent } from "./drawing";
import { PageTabs } from "./PageTabs";
import { type DrawingPage, type DrawingPagesResult, isNewPageKey, placeNewPages } from "./pages";
import { useCanvasTheme } from "./useCanvasTheme";
import { useCanvasZoom, ZoomMenu } from "./ZoomMenu";

export interface DrawingViewerProps {
  attachment: Attachment;
  /** The memo the drawing belongs to; with `canEdit`, Edit saves the drawing back to it. */
  memo: Pick<Memo, "name" | "attachments">;
  /** Whether the viewer may change the memo: its author or an admin. */
  canEdit: boolean;
  /**
   * Opened on an ordinary image to mark it up: the sheet opens at once with the image as a
   * locked background, and Save copy adds the markup to the memo right after the image.
   */
  annotate?: boolean;
  onClose: () => void;
  /** The file carries no readable scene: show it as the plain image it is. */
  onNoScene: () => void;
}

/** The memo's drawings, the pages of the viewer: images named like drawings, stored on this server. */
const memoDrawings = (attachments: readonly Attachment[]): Attachment[] =>
  attachments.filter((attachment) => isDrawingFilename(attachment.filename) && !attachment.externalLink);

/** A page's content in the viewer: being read, read (a scene, or a picture without one), or failed. */
type PageView = { status: "loading" } | { status: "failed" } | { status: "ready"; content: DrawingContent; version: number };

/**
 * A drawing opened from a memo: the canvas in its read-only mode (pan, zoom, copy), with
 * Zoom to fit and, for whoever may change the memo, Edit. The memo's other drawings are its
 * pages, under page tabs. Edit turns the viewer into the drawing sheet on the same pages;
 * Done replaces each changed drawing's file under the same name, adds each new page right
 * after the page before it, stamps the memo's update time and returns to viewing. An edit of
 * someone else's drawing is added to the memo beside it.
 *
 * With `annotate`, the viewer is the way into marking up an ordinary image: there is nothing
 * to view first, so it opens the sheet on that image alone and closes with it.
 */
const DrawingViewer = ({ attachment: initialAttachment, memo, canEdit, annotate = false, onClose, onNoScene }: DrawingViewerProps) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const isWide = useMediaQuery("sm");
  // Small controls on a desktop; a phone keeps the 32px ones for touch.
  const size = isWide ? "sm" : undefined;
  const { theme, fontFamily } = useCanvasTheme();
  const { mutateAsync: updateMemo } = useUpdateMemo(memo.name);
  const canvasRef = useRef<CanvasHandle>(null);
  const { zoom, sync: syncZoom, schedule: scheduleZoom } = useCanvasZoom(() => canvasRef.current);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [activeName, setActiveName] = useState(initialAttachment.name);
  const [views, setViews] = useState<Record<string, PageView | undefined>>({});
  const [isEditing, setIsEditing] = useState(false);
  // Files saved by an edit whose memo update failed: the user's own, so a retry replaces them
  // instead of uploading more. Keyed by the sheet's page.
  const unlinkedUploads = useRef(new Map<string, Attachment>());
  const loads = useRef(new Map<string, AbortController>());
  // Pages whose file holds no scene: their edit is drawn over the picture, so it joins the memo beside it.
  const pictures = useRef(new Set<string>());
  // Each drawing as it was read, to tell at Save whether its file changed elsewhere meanwhile;
  // one that did is never overwritten: its edit is saved as a copy beside it.
  const baselines = useRef(new Map<string, string>());
  const copies = useRef(new Set<string>());
  const [savesCopy, setSavesCopy] = useState(false);
  const remember = (key: string, content: DrawingContent) => {
    if (content.scene) baselines.current.set(key, sceneContent(content.scene));
  };
  // The pages report through the host's committed callbacks.
  const showNoScene = useEffectEvent(onNoScene);
  const failToOpen = useEffectEvent(() => {
    showErrorToast(t("editor.drawing.open-failed"));
    onClose();
  });

  const listed = memoDrawings(memo.attachments);
  // The drawing opened stays a page even before the memo lists it.
  // An image being marked up is the sheet's only page: the memo's drawings are not its pages.
  const pages = annotate
    ? [initialAttachment]
    : listed.some((item) => item.name === initialAttachment.name)
      ? listed
      : [initialAttachment, ...listed];
  const active = pages.find((item) => item.name === activeName) ?? initialAttachment;
  const activeView = views[active.name];

  const loadPage = useEffectEvent((attachment: Attachment) => {
    if (loads.current.has(attachment.name)) return;
    const controller = new AbortController();
    loads.current.set(attachment.name, controller);
    setViews((current) => ({ ...current, [attachment.name]: { status: "loading" } }));
    fetchDrawingFile(attachment, controller.signal)
      .then(readDrawing)
      .then((content) => {
        if (controller.signal.aborted) return;
        // The drawing opened from the memo without a scene is the plain image it is.
        if (!content.scene && attachment.name === initialAttachment.name && !annotate) showNoScene();
        else {
          // An image to mark up goes straight to the sheet, as a picture to draw on.
          if (!content.scene && annotate) setIsEditing(true);
          if (!content.scene) pictures.current.add(attachment.name);
          remember(attachment.name, content);
          setViews((current) => ({ ...current, [attachment.name]: { status: "ready", content, version: 0 } }));
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
        if (attachment.name === initialAttachment.name) failToOpen();
        else {
          showErrorToast(t("editor.drawing.open-failed"));
          setViews((current) => ({ ...current, [attachment.name]: { status: "failed" } }));
        }
      })
      .finally(() => {
        if (loads.current.get(attachment.name) === controller) loads.current.delete(attachment.name);
      });
  });

  // A page is read when it is first shown.
  useEffect(() => {
    if (activeView === undefined) loadPage(active);
  }, [active, activeView]);
  useEffect(() => {
    const pending = loads.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
    };
  }, []);

  /** Uploads one finished page: over its own file, or as a new file (a new page, or a copy of someone else's drawing). */
  const uploadPage = async (key: string, file: File, over?: Attachment): Promise<{ saved: Attachment; isNew: boolean }> => {
    if (over && canManageAttachment(over, currentUser) && !copies.current.has(key)) {
      // Never over a drawing that changed since it was read here: another tab or person saved it.
      const original = await readDrawing(await fetchDrawingFile(over));
      if (!original.scene || sceneContent(original.scene) !== baselines.current.get(key)) {
        copies.current.add(key);
        setSavesCopy(true);
        throw new DrawingActionError("editor.drawing.changed-save-copy");
      }
      const saved = await uploadService.uploadFile({ file, previewUrl: "", replaces: over.name });
      // The file now holds this edit, so a retry after a later failure compares against it.
      remember(key, await readDrawing(file));
      return { saved, isNew: false };
    }
    const saved = await uploadService.uploadFile({ file, previewUrl: "", replaces: unlinkedUploads.current.get(key)?.name });
    unlinkedUploads.current.set(key, saved);
    return { saved, isNew: true };
  };

  // Done in the sheet: each changed page replaces its drawing's file. A drawing someone else
  // uploaded stays, since only they or an admin may replace or remove it, and its edit joins
  // the memo beside it; a new page joins the memo after the page before it.
  const saveEdit = async ({ order, files }: DrawingPagesResult) => {
    // The memo as it is now, not as it was opened: another tab may have changed its attachments.
    const current = await memoServiceClient.getMemo({ name: memo.name }).catch(() => {
      throw new DrawingActionError("editor.drawing.unavailable");
    });
    const sourceGone = annotate && !current.attachments.some((item) => item.name === initialAttachment.name);
    if (!canEdit || !canManageMemo(current, currentUser) || sourceGone) throw new DrawingActionError("editor.drawing.unavailable");
    const byName = new Map(current.attachments.map((item) => [item.name, item]));
    const saved = new Map<string, Attachment>();
    // Each new file, by the page it belongs after (itself, for a new page).
    const added = new Map<string, Attachment>();
    for (const { key, file } of files) {
      const over =
        isNewPageKey(key) || pictures.current.has(key)
          ? undefined
          : (byName.get(key) ?? (key === initialAttachment.name ? initialAttachment : undefined));
      const result = await uploadPage(key, file, over);
      if (result.isNew) added.set(key, result.saved);
      else saved.set(result.saved.name, result.saved);
    }
    if (added.size > 0) {
      const pageNames = order.flatMap((key) => {
        const extra = added.get(key);
        const own = isNewPageKey(key) ? [] : [key];
        return extra ? [...own, extra.name] : own;
      });
      const addedNames = new Set(Array.from(added.values(), (item) => item.name));
      const all = new Map([...current.attachments, ...added.values(), ...saved.values()].map((item) => [item.name, item]));
      const names = placeNewPages(
        current.attachments.map((item) => item.name),
        pageNames,
        (name) => addedNames.has(name),
      );
      // Whole attachments, not names: the optimistic update shows them until the memo reloads.
      const attachments = names.flatMap((name) => all.get(name) ?? []);
      // The files are uploaded by now; a failure here says so, and a retry reuses them.
      try {
        await updateMemo({ update: { name: memo.name, attachments }, updateMask: ["attachments"] });
      } catch {
        throw new DrawingActionError("editor.drawing.bind-failed");
      }
    } else if (files.length > 0) {
      try {
        await updateMemo({ update: { name: memo.name }, updateMask: ["update_time"] });
      } catch {
        throw new DrawingActionError("editor.drawing.saved-needs-update");
      }
    }
    unlinkedUploads.current.clear();
    // The changed pages show their new drawings; added pages are read when they are first shown.
    const changed = await Promise.all(
      files.flatMap(({ key, file }) =>
        isNewPageKey(key) || added.has(key) ? [] : [readDrawing(file).then((content) => [key, content] as const)],
      ),
    );
    setViews((current) => {
      const next = { ...current };
      for (const [key, content] of changed) {
        const previous = current[key];
        next[key] = { status: "ready", content, version: (previous?.status === "ready" ? previous.version : 0) + 1 };
      }
      return next;
    });
    if (annotate) onClose();
    else setIsEditing(false);
  };

  // A page's canvas mounts with its own view; the percentage follows it.
  const shownScene = activeView?.status === "ready" ? `${active.name}:${activeView.version}` : undefined;
  useEffect(() => {
    if (shownScene && !isEditing) scheduleZoom();
  }, [shownScene, isEditing]);

  if (isEditing && activeView?.status === "ready") {
    const sheetPages: DrawingPage[] = pages.map((item) => {
      const view = views[item.name];
      return view?.status === "ready"
        ? { key: item.name, content: view.content }
        : {
            key: item.name,
            load: async (signal) => {
              const content = await readDrawing(await fetchDrawingFile(item, signal));
              if (!content.scene) pictures.current.add(item.name);
              remember(item.name, content);
              return content;
            },
          };
    });
    return (
      <DrawingSheet
        mode={annotate ? "new" : "edit"}
        pages={sheetPages}
        initialPage={active.name}
        commitLabel={annotate || savesCopy ? "editor.drawing.save-copy" : undefined}
        onDone={saveEdit}
        onClose={annotate ? onClose : () => setIsEditing(false)}
      />
    );
  }

  const title = t("editor.insert-menu.drawing");
  const scene = activeView?.status === "ready" ? activeView.content.scene : undefined;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawingDialogPopup label={title}>
        <div className="relative h-full w-full" style={{ background: theme.paper }}>
          {activeView?.status === "ready" && scene ? (
            // No autofocus: a viewer should not draw a focus ring around the page as it opens.
            // A new key per page and per saved edit: the read-only canvas opens its scene once.
            <div
              className="absolute inset-0"
              // While the zoom menu is open the paper holds still, so a click on it closes the menu without panning.
              inert={zoomMenuOpen}
              onPointerUp={syncZoom}
              onPointerCancel={syncZoom}
              onPointerMove={scheduleZoom}
              onWheel={scheduleZoom}
              onKeyUp={syncZoom}
            >
              <Canvas
                key={`${active.name}:${activeView.version}`}
                ref={canvasRef}
                className="absolute inset-0"
                readOnly
                ariaLabel={pages.length > 1 ? `${title}, ${t("editor.drawing.page", { number: pages.indexOf(active) + 1 })}` : title}
                initialScene={scene}
                theme={theme}
                fontFamily={fontFamily}
              />
            </div>
          ) : activeView?.status === "ready" ? (
            // A page whose file holds no scene is the plain image it is.
            <img
              src={getAttachmentUrl(active)}
              alt={active.filename}
              className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
            />
          ) : activeView?.status === "failed" ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="mu-body text-mu-text-secondary">{t("editor.drawing.open-failed")}</span>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner label={t("editor.blocks.loading")} />
            </div>
          )}
          <FloatingRow edge="top">
            {/* The caption matches the bar's button text: 13px beside small controls, 14px on a phone.
                Not a Dialog.Title, whose heading type is 16px; the popup's aria-label names the dialog. */}
            <FloatingBar className={isWide ? "pr-2" : "pr-3"}>
              <IconAction size={size} label={t("common.close")} icon={<XIcon />} onClick={onClose} />
              <span className={cn("truncate text-mu-text", isWide ? "mu-label-sm" : "mu-label")}>{title}</span>
            </FloatingBar>
            {canEdit && (
              <FloatingBar>
                {/* Flat inside the bar: the bar is the one bordered surface. */}
                <Button variant="ghost" size={size} icon={<PaletteIcon />} disabled={!scene} onClick={() => setIsEditing(true)}>
                  {t("common.edit")}
                </Button>
              </FloatingBar>
            )}
          </FloatingRow>
          {/* The zoom keeps the place it has in the sheet: bottom left, clear of where a phone's tools go. */}
          <FloatingRow edge="bottom" className="justify-start max-sm:bottom-[calc(72px+env(safe-area-inset-bottom))]">
            <FloatingAction>
              <ZoomMenu
                zoom={zoom}
                getCanvas={() => canvasRef.current}
                onZoomed={syncZoom}
                size={size}
                disabled={!scene}
                open={zoomMenuOpen}
                onOpenChange={setZoomMenuOpen}
              />
            </FloatingAction>
          </FloatingRow>
          {pages.length > 1 && (
            <FloatingRow edge="bottom">
              <PageTabs
                keys={pages.map((item) => item.name)}
                active={active.name}
                onSelect={setActiveName}
                size={size}
                className={isWide ? undefined : "gap-3"}
              />
            </FloatingRow>
          )}
        </div>
      </DrawingDialogPopup>
    </Dialog.Root>
  );
};

/** An icon-only ghost Button named by its Tooltip. */
const IconAction = ({ label, icon, size, onClick }: { label: string; icon: ReactElement; size?: "sm"; onClick: () => void }) => (
  <Tooltip.Root>
    <Tooltip.Trigger render={<Button variant="ghost" size={size} aria-label={label} icon={icon} onClick={onClick} />} />
    <Tooltip.Popup>{label}</Tooltip.Popup>
  </Tooltip.Root>
);

export default DrawingViewer;
