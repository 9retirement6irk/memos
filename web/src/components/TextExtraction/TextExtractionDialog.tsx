import { Button, Dialog, Field, Spinner, Textarea } from "@usememos/ui";
import copy from "copy-to-clipboard";
import { useEffect, useState } from "react";
import { memoServiceClient } from "@/connect";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { extractText } from "@/lib/textExtraction";
import { assembleText, picturesOf, prepareImage, preparePdf, TooManyPagesError } from "@/lib/textExtractionPages";
import { showErrorToast, toast } from "@/lib/toast";
import type { Attachment } from "@/types/proto/api/attachment_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { appendBlock, textBlock } from "./memoBlock";

export interface TextExtractionDialogProps {
  attachment: Attachment;
  /** The memo the file belongs to; with `canEdit`, Add to memo appends the text to it. */
  memoName?: string;
  canEdit: boolean;
  onClose: () => void;
}

type ReadState =
  | { status: "preparing" | "reading" }
  | { status: "failed"; message?: string; pageLimit?: number }
  | { status: "done"; text: string; local: boolean; truncated: boolean };

/**
 * Reads the text in an image, drawing or PDF and shows it to edit, copy or add to the memo. The file is prepared
 * here: a PDF's own text is read in the browser, and only pictures (images, drawings, scanned pages) go to the AI
 * an admin chose. A PDF with text on every page never leaves the browser.
 */
const TextExtractionDialog = ({ attachment, memoName, canEdit, onClose }: TextExtractionDialogProps) => {
  const t = useTranslate();
  const [state, setState] = useState<ReadState>({ status: "preparing" });
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { mutateAsync: updateMemo } = useUpdateMemo(memoName);
  const title = t("text-extraction.text-from", { name: attachment.filename });

  useEffect(() => {
    void attempt;
    const controller = new AbortController();
    const read = async () => {
      setState({ status: "preparing" });
      const url = getAttachmentUrl(attachment);
      const pages =
        attachment.type === "application/pdf" ? await preparePdf(url, controller.signal) : await prepareImage(url, controller.signal);
      const pictures = picturesOf(pages);
      if (pictures.length === 0) return { text: assembleText(pages), local: true, truncated: false };
      setState({ status: "reading" });
      const result = await extractText(attachment.name, pictures, controller.signal);
      return { text: assembleText(pages, result), local: false, truncated: result.truncated };
    };
    read().then(
      (done) => {
        if (controller.signal.aborted) return;
        setText(done.text);
        setState({ status: "done", ...done });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof TooManyPagesError) setState({ status: "failed", pageLimit: error.limit });
        else setState({ status: "failed", message: error instanceof Error ? error.message : undefined });
      },
    );
    return () => controller.abort();
  }, [attachment, attempt]);

  const handleCopy = () => {
    copy(text);
    toast.add({ title: t("message.copied"), type: "success" });
  };

  const handleAdd = async () => {
    if (!memoName) return;
    setAdding(true);
    try {
      // The memo as it is now, so text written since it was shown isn't lost.
      const current = await memoServiceClient.getMemo({ name: memoName });
      await updateMemo({
        update: { name: memoName, content: appendBlock(current.content, textBlock(title, text)) },
        updateMask: ["content"],
      });
      toast.add({ title: t("text-extraction.added"), type: "success" });
      onClose();
    } catch (error) {
      showErrorToast(error instanceof Error && error.message ? error.message : t("text-extraction.add-failed"));
    } finally {
      setAdding(false);
    }
  };

  const busy = state.status === "preparing" || state.status === "reading";
  const hasText = state.status === "done" && text.trim() !== "";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !adding && onClose()}>
      <Dialog.Popup className="sm:max-w-2xl">
        <Dialog.Title className="truncate">{title}</Dialog.Title>
        {busy && (
          <div className="flex min-h-40 items-center justify-center">
            <Spinner label={t(state.status === "preparing" ? "text-extraction.preparing" : "text-extraction.reading")} />
          </div>
        )}
        {state.status === "failed" && (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="mu-body text-mu-text">
              {state.pageLimit
                ? t("text-extraction.too-many-pages", { count: state.pageLimit })
                : state.message || t("text-extraction.failed")}
            </p>
            <Button onClick={() => setAttempt((current) => current + 1)}>{t("common.retry")}</Button>
          </div>
        )}
        {state.status === "done" &&
          (state.text.trim() === "" ? (
            <p className="mu-body text-mu-text-secondary">{t("text-extraction.no-text")}</p>
          ) : (
            <Field.Root>
              <Field.Label>{t("text-extraction.text")}</Field.Label>
              <Textarea rows={14} value={text} onChange={(event) => setText(event.target.value)} className="font-mono" />
              {(state.truncated || state.local) && (
                <Field.Description>
                  {state.truncated ? t("text-extraction.truncated") : t("text-extraction.read-locally")}
                </Field.Description>
              )}
            </Field.Root>
          ))}
        <Dialog.Footer>
          <Button variant="ghost" disabled={adding} onClick={onClose}>
            {t("common.close")}
          </Button>
          {hasText && <Button onClick={handleCopy}>{t("common.copy")}</Button>}
          {hasText && canEdit && memoName && (
            <Button variant="primary" loading={adding} loadingLabel={t("text-extraction.add-to-memo")} onClick={handleAdd}>
              {t("text-extraction.add-to-memo")}
            </Button>
          )}
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
};

export default TextExtractionDialog;
