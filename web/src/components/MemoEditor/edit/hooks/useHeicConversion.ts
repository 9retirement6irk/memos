import { useCallback, useRef } from "react";
import { convertHeicToJpeg, isHeicFile } from "@/lib/heic";
import { showErrorToast, toast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import { useEditorContext } from "../state";

/**
 * Converts the HEIC photos among picked, pasted or dropped files to JPEG (see lib/heic.ts), keeping the files'
 * order. Save waits while it runs. A photo that can't be converted is kept as it is, with a warning.
 */
export const useHeicConversion = () => {
  const t = useTranslate();
  const { actions, dispatch } = useEditorContext();
  const running = useRef(0);

  return useCallback(
    async (files: File[]): Promise<File[]> => {
      const count = files.filter(isHeicFile).length;
      if (count === 0) return files;
      running.current += 1;
      dispatch(actions.setLoading("converting", true));
      const toastId = toast.add({ title: t("editor.heic.converting", { count }), timeout: 0 });
      let failed = 0;
      try {
        const converted: File[] = [];
        // One at a time: each full-size decode holds a large picture in memory.
        for (const file of files) {
          if (!isHeicFile(file)) {
            converted.push(file);
            continue;
          }
          try {
            converted.push(await convertHeicToJpeg(file));
          } catch (error) {
            console.warn("Could not convert a HEIC photo", error);
            failed += 1;
            converted.push(file);
          }
        }
        return converted;
      } finally {
        toast.close(toastId);
        if (failed > 0) showErrorToast(t("editor.heic.failed", { count: failed }));
        running.current -= 1;
        if (running.current === 0) dispatch(actions.setLoading("converting", false));
      }
    },
    [actions, dispatch, t],
  );
};
