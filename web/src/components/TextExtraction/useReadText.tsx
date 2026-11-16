import { type ReactNode, useState } from "react";
import { useTextExtractionEnabled } from "@/hooks/useTextExtractionQueries";
import type { Attachment } from "@/types/proto/api/attachment_service_pb";
import TextExtractionDialog from "./TextExtractionDialog";

/** Files whose text can be read: images (drawings included) and PDFs stored on this server. */
export const canReadText = (attachment: Attachment | undefined): attachment is Attachment =>
  Boolean(
    attachment &&
      !attachment.externalLink &&
      ((attachment.type.startsWith("image/") && attachment.type !== "image/svg+xml") || attachment.type === "application/pdf"),
  );

/**
 * "Read text" for one file: whether to offer it (text extraction is on and the file can be read), a function that
 * opens the dialog, and the dialog to render while it's open.
 */
export const useReadText = (
  attachment: Attachment | undefined,
  memo: { memoName?: string; canEdit: boolean },
): { available: boolean; open: () => void; dialog: ReactNode } => {
  const enabled = useTextExtractionEnabled();
  const [opened, setOpened] = useState<Attachment>();
  const available = enabled && canReadText(attachment);
  return {
    available,
    open: () => available && setOpened(attachment),
    dialog: opened ? (
      <TextExtractionDialog
        key={opened.name}
        attachment={opened}
        memoName={memo.memoName}
        canEdit={memo.canEdit}
        onClose={() => setOpened(undefined)}
      />
    ) : null,
  };
};
