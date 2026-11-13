import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DrawingContent,
  type DrawingPage,
  type DrawingPagesResult,
  fetchDrawingFile,
  isDrawingFilename,
  isNewPageKey,
  newPageKey,
  placeNewPages,
  readDrawing,
} from "@/components/DrawingSheet";
import useCurrentUser from "@/hooks/useCurrentUser";
import { showErrorToast } from "@/lib/toast";
import type { Attachment } from "@/types/proto/api/attachment_service_pb";
import type { User } from "@/types/proto/api/user_service_pb";
import { useTranslate } from "@/utils/i18n";
import { canManageAttachment } from "@/utils/user";
import { type EditorState, useEditorContext } from "../state";
import type { DrawingSource, LocalFile } from "../types/attachment";
import { effectiveOrder, localFileOrderKey, sortByOrder } from "../utils/attachmentOrder";

/**
 * Where a page's finished drawing goes: in place of the draft file it came from, or over
 * the saved attachment it came from. A saved drawing the user may not replace (someone else
 * uploaded it) stays, and the edit is added as a new attachment beside it.
 */
type PageTarget = { kind: "local"; localFile: LocalFile } | { kind: "attachment"; attachment: Attachment; canReplace: boolean };

export interface DrawingSession {
  /** A new session is a new sheet, so the canvas reads its pages again. */
  id: number;
  mode: "new" | "edit";
  /** The draft's drawings, one page each, in the draft's attachment order. */
  pages: DrawingPage[];
  initialPage: string;
}

interface DraftDrawing {
  /** The page's key: the draft file's preview URL, or the saved attachment's name. */
  key: string;
  target: PageTarget;
}

/** The key a drawing holds in the draft's attachment order. */
const orderKeyOf = (target: PageTarget): string => (target.kind === "local" ? localFileOrderKey(target.localFile) : target.attachment.name);

/**
 * The draft's drawings in its attachment order. A saved drawing with an edit waiting to
 * upload over it is that edit. A linked drawing is left out: its file lives elsewhere.
 */
const draftDrawings = (state: EditorState, currentUser: User | undefined): DraftDrawing[] => {
  const { attachments } = state.metadata;
  const edits = new Map(state.localFiles.flatMap((localFile) => (localFile.replaces ? [[localFile.replaces, localFile] as const] : [])));
  const saved = attachments.flatMap((attachment): DraftDrawing[] => {
    if (!isDrawingFilename(attachment.filename) || attachment.externalLink) return [];
    const edit = edits.get(attachment.name);
    return [
      edit
        ? { key: edit.previewUrl, target: { kind: "local", localFile: edit } }
        : { key: attachment.name, target: { kind: "attachment", attachment, canReplace: canManageAttachment(attachment, currentUser) } },
    ];
  });
  const fresh = state.localFiles
    .filter((localFile) => !localFile.replaces && isDrawingFilename(localFile.file.name))
    .map((localFile): DraftDrawing => ({ key: localFile.previewUrl, target: { kind: "local", localFile } }));
  return sortByOrder(
    [...saved, ...fresh],
    (drawing) => [orderKeyOf(drawing.target)],
    effectiveOrder(state.attachmentOrder, attachments, state.localFiles),
  );
};

/**
 * The drawing sheet's session in the editor: a new drawing from the ＋ menu, or "Edit
 * drawing" on an attachment row. Either way the sheet shows every drawing in the draft as a
 * page, so a new drawing is a new page after them. Each page stays its own file: Done joins
 * the draft through the same LocalFile path as a picked image, so the memo's save uploads it.
 * An edited page takes the place of the drawing it came from: a local file is swapped in the
 * draft; a saved attachment stays, and the edit is a local file that replaces its content on
 * save (the attachment keeps its name, so links to it keep working). A new page lands in the
 * draft's order right after the page before it.
 */
export const useDrawing = (toLocalFile: (file: File) => LocalFile) => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const { actions, dispatch, getState } = useEditorContext();
  const [session, setSession] = useState<DrawingSession>();
  // The row whose drawing is being downloaded and read.
  const [opening, setOpening] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  const nextId = useRef(0);
  // The session's pages that came from the draft, and those whose file held no scene: their
  // edit is drawn over the picture, so it joins the draft beside the original.
  const targets = useRef(new Map<string, PageTarget>());
  const pictures = useRef(new Set<string>());

  useEffect(() => () => request.current?.abort(), []);

  const toPage = useCallback(({ key, target }: DraftDrawing, content?: DrawingContent): DrawingPage => {
    const read = async (signal: AbortSignal) => {
      const file = target.kind === "local" ? target.localFile.file : await fetchDrawingFile(target.attachment, signal);
      const result = await readDrawing(file);
      if (!result.scene) pictures.current.add(key);
      return result;
    };
    return content ? { key, content } : { key, load: read };
  }, []);

  /** Opens the sheet on the draft's drawings, with `initial` as the page on show. */
  const openSheet = useCallback(
    (mode: DrawingSession["mode"], drawings: DraftDrawing[], initial: DrawingPage) => {
      targets.current = new Map(drawings.map((drawing) => [drawing.key, drawing.target]));
      pictures.current = new Set(initial.content && !initial.content.scene ? [initial.key] : []);
      const pages = drawings.map((drawing) => (drawing.key === initial.key ? initial : toPage(drawing)));
      setSession({
        id: ++nextId.current,
        mode,
        pages: pages.some((page) => page.key === initial.key) ? pages : [...pages, initial],
        initialPage: initial.key,
      });
    },
    [toPage],
  );

  const openNew = useCallback(() => {
    // A drawing still downloading must not replace the new sheet when it arrives.
    request.current?.abort();
    request.current = undefined;
    setOpening(undefined);
    openSheet("new", draftDrawings(getState(), currentUser), { key: newPageKey() });
  }, [currentUser, getState, openSheet]);

  const openExisting = useCallback(
    async (source: DrawingSource) => {
      if (request.current) return;
      const controller = new AbortController();
      request.current = controller;
      const sourceId = source.kind === "local" ? source.localFile.previewUrl : source.attachment.name;
      setOpening(sourceId);
      try {
        const file = source.kind === "local" ? source.localFile.file : await fetchDrawingFile(source.attachment, controller.signal);
        const content = await readDrawing(file);
        if (controller.signal.aborted) return;
        const drawings = draftDrawings(getState(), currentUser);
        // A drawing the draft no longer lists (removed while it downloaded) still opens, as a page of its own.
        const opened = drawings.find((drawing) => drawing.key === sourceId) ?? {
          key: sourceId,
          target:
            source.kind === "local"
              ? { kind: "local", localFile: source.localFile }
              : { kind: "attachment", attachment: source.attachment, canReplace: canManageAttachment(source.attachment, currentUser) },
        };
        const all = drawings.some((drawing) => drawing.key === sourceId) ? drawings : [...drawings, opened];
        // No scene inside: draw on the picture as a new drawing and leave the original alone.
        openSheet(content.scene ? "edit" : "new", all, toPage(opened, content));
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        showErrorToast(t("editor.drawing.open-failed"));
      } finally {
        if (request.current === controller) request.current = undefined;
        if (!controller.signal.aborted) setOpening(undefined);
      }
    },
    [currentUser, getState, openSheet, t, toPage],
  );

  const close = useCallback(() => setSession(undefined), []);

  const done = useCallback(
    ({ order: pageOrder, files }: DrawingPagesResult) => {
      if (files.length > 0) {
        const state = getState();
        let localFiles = [...state.localFiles];
        // The order keys that changed: a swapped draft file is a new preview URL.
        const renamed = new Map<string, string>();
        // Files that join the draft as new attachments, by the page they belong after.
        const added = new Map<string, string>();
        for (const { key, file } of files) {
          const localFile = toLocalFile(file);
          const target = targets.current.get(key);
          if (!target || isNewPageKey(key) || pictures.current.has(key)) {
            // A new page, or a drawing over a picture: a new file, and the original stays.
            localFiles.push(localFile);
            added.set(key, localFile.previewUrl);
          } else if (target.kind === "local") {
            // A file that is itself an edit of a saved drawing stays one, and keeps that drawing's place.
            const previous = target.localFile;
            localFiles = localFiles.map((item) =>
              item.previewUrl === previous.previewUrl ? { ...localFile, replaces: item.replaces } : item,
            );
            if (!previous.replaces) renamed.set(previous.previewUrl, localFile.previewUrl);
          } else if (target.canReplace) {
            // The saved drawing keeps its place; its edit uploads over it when the memo is saved.
            localFiles = [
              ...localFiles.filter((item) => item.replaces !== target.attachment.name),
              { ...localFile, replaces: target.attachment.name },
            ];
          } else {
            // An edit of a drawing the user may not replace (someone else uploaded it, and only
            // they or an admin may remove it): the edit joins the memo beside it.
            localFiles.push(localFile);
            added.set(key, localFile.previewUrl);
          }
        }
        dispatch(actions.setLocalFiles(localFiles));

        if (added.size > 0 || (renamed.size > 0 && state.attachmentOrder.length > 0)) {
          // The sheet's pages as order keys, each added file right after the page it belongs to.
          const pageKeys = pageOrder.flatMap((key) => {
            const target = targets.current.get(key);
            const own = target && !isNewPageKey(key) ? [renamed.get(orderKeyOf(target)) ?? orderKeyOf(target)] : [];
            const extra = added.get(key);
            return extra ? [...own, extra] : own;
          });
          const addedKeys = new Set(added.values());
          const current = effectiveOrder(state.attachmentOrder, state.metadata.attachments, state.localFiles).map(
            (key) => renamed.get(key) ?? key,
          );
          dispatch(actions.setAttachmentOrder(placeNewPages(current, pageKeys, (key) => addedKeys.has(key))));
        }
      }
      setSession(undefined);
    },
    [actions, dispatch, getState, toLocalFile],
  );

  return { session, opening, openNew, openExisting, close, done };
};
