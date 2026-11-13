import type { CanvasHandle } from "@usememos/canvas";
import { Canvas } from "@usememos/canvas/react";
import { Button, Dialog, Spinner, Tooltip } from "@usememos/ui";
import { PencilLineIcon, ScanIcon, XIcon } from "lucide-react";
import { type ReactElement, useEffect, useEffectEvent, useRef, useState } from "react";
import { uploadService } from "@/components/MemoEditor/edit/services/uploadService";
import useCurrentUser from "@/hooks/useCurrentUser";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { showErrorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/proto/api/attachment_service_pb";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { canManageAttachment } from "@/utils/user";
import { DrawingDialogPopup, FloatingBar, FloatingRow } from "./DrawingFrame";
import DrawingSheet from "./DrawingSheet";
import { type DrawingContent, fetchDrawingFile, isDrawingFilename, readDrawing } from "./drawing";
import { PageTabs } from "./PageTabs";
import { type DrawingPage, type DrawingPagesResult, isNewPageKey, placeNewPages } from "./pages";
import { useCanvasTheme } from "./useCanvasTheme";

export interface DrawingViewerProps {
  attachment: Attachment;
  /** The memo the drawing belongs to; with `canEdit`, Edit saves the drawing back to it. */
  memo: Pick<Memo, "name" | "attachments">;
  /** Whether the viewer may change the memo: its author or an admin. */
  canEdit: boolean;
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
 */
const DrawingViewer = ({ attachment: initialAttachment, memo, canEdit, onClose, onNoScene }: DrawingViewerProps) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const isWide = useMediaQuery("sm");
  // Small controls on a desktop; a phone keeps the 32px ones for touch.
  const size = isWide ? "sm" : undefined;
  const { theme, fontFamily } = useCanvasTheme();
  const { mutateAsync: updateMemo } = useUpdateMemo(memo.name);
  const canvasRef = useRef<CanvasHandle>(null);
  const [activeName, setActiveName] = useState(initialAttachment.name);
  const [views, setViews] = useState<Record<string, PageView | undefined>>({});
  const [isEditing, setIsEditing] = useState(false);
  // Files saved by an edit whose memo update failed: the user's own, so a retry replaces them
  // instead of uploading more. Keyed by the sheet's page.
  const unlinkedUploads = useRef(new Map<string, Attachment>());
  const loads = useRef(new Map<string, AbortController>());
  // Pages whose file holds no scene: their edit is drawn over the picture, so it joins the memo beside it.
  const pictures = useRef(new Set<string>());
  // The pages report through the host's committed callbacks.
  const showNoScene = useEffectEvent(onNoScene);
  const failToOpen = useEffectEvent(() => {
    showErrorToast(t("editor.drawing.open-failed"));
    onClose();
  });

  const listed = memoDrawings(memo.attachments);
  // The drawing opened stays a page even before the memo lists it.
  const pages = listed.some((item) => item.name === initialAttachment.name) ? listed : [initialAttachment, ...listed];
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
        if (!content.scene && attachment.name === initialAttachment.name) showNoScene();
        else {
          if (!content.scene) pictures.current.add(attachment.name);
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
    if (over && canManageAttachment(over, currentUser)) {
      return { saved: await uploadService.uploadFile({ file, previewUrl: "", replaces: over.name }), isNew: false };
    }
    const saved = await uploadService.uploadFile({ file, previewUrl: "", replaces: unlinkedUploads.current.get(key)?.name });
    unlinkedUploads.current.set(key, saved);
    return { saved, isNew: true };
  };

  // Done in the sheet: each changed page replaces its drawing's file. A drawing someone else
  // uploaded stays, since only they or an admin may replace or remove it, and its edit joins
  // the memo beside it; a new page joins the memo after the page before it.
  const saveEdit = async ({ order, files }: DrawingPagesResult) => {
    const byName = new Map(memo.attachments.map((item) => [item.name, item]));
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
      const all = new Map([...memo.attachments, ...added.values(), ...saved.values()].map((item) => [item.name, item]));
      const names = placeNewPages(
        memo.attachments.map((item) => item.name),
        pageNames,
        (name) => addedNames.has(name),
      );
      // Whole attachments, not names: the optimistic update shows them until the memo reloads.
      const attachments = names.flatMap((name) => all.get(name) ?? []);
      await updateMemo({ update: { name: memo.name, attachments }, updateMask: ["attachments"] });
    } else if (files.length > 0) {
      await updateMemo({ update: { name: memo.name }, updateMask: ["update_time"] });
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
    setIsEditing(false);
  };

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
              return content;
            },
          };
    });
    return <DrawingSheet mode="edit" pages={sheetPages} initialPage={active.name} onDone={saveEdit} onClose={() => setIsEditing(false)} />;
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
          ) : activeView?.status === "ready" ? (
            // A page whose file holds no scene is the plain image it is.
            <img
              src={getAttachmentUrl(active)}
              alt={active.filename}
              className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
            />
          ) : activeView?.status === "failed" ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="mu-body text-mu-ink-muted">{t("editor.drawing.open-failed")}</span>
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
              <span className={cn("truncate text-mu-ink", isWide ? "mu-label-sm" : "mu-label")}>{title}</span>
            </FloatingBar>
            <FloatingBar className={isWide ? undefined : "gap-3"}>
              <IconAction
                size={size}
                label={t("editor.drawing.zoom-to-fit")}
                icon={<ScanIcon />}
                onClick={() => canvasRef.current?.zoomToFit()}
              />
              {canEdit && (
                // Flat inside the bar: the bar is the one raised surface.
                <Button variant="ghost" size={size} icon={<PencilLineIcon />} disabled={!scene} onClick={() => setIsEditing(true)}>
                  {t("common.edit")}
                </Button>
              )}
            </FloatingBar>
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
