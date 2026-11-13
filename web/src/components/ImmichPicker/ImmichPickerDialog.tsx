import { Button, Dialog, Field, Select, Spinner } from "@usememos/ui";
import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useImmichAlbums, useImmichConnection, useImmichPhotos } from "@/hooks/useImmichQueries";
import { fetchImmichOriginal, fetchImmichPreview, type ImmichPhoto, immichThumbnailUrl } from "@/lib/immich";
import { showErrorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

const ALL_PHOTOS = "";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the chosen photos' files, in the order they were picked. */
  onPick: (files: File[]) => void;
  /**
   * `original` (the default) copies each photo as it is in Immich, for a memo to keep;
   * `preview` takes Immich's 1440 px JPEG, for a picture placed in a drawing.
   */
  size?: "original" | "preview";
}

/**
 * Browse the user's own Immich library (everything, or one album) and pick photos for the memo
 * or a drawing. The files are copied into Memos, so the memo keeps them even if Immich goes
 * away; nothing is changed in Immich.
 */
const ImmichPickerDialog = ({ open, onOpenChange, onPick, size = "original" }: Props) => {
  const t = useTranslate();
  const { data: connection, isLoading: connectionLoading } = useImmichConnection();
  const connected = Boolean(connection?.configured);
  const [albumId, setAlbumId] = useState(ALL_PHOTOS);
  const [selected, setSelected] = useState<ImmichPhoto[]>([]);
  const [adding, setAdding] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const albums = useImmichAlbums(open && connected);
  const photos = useImmichPhotos(albumId, open && connected);
  const photoList = useMemo(() => photos.data?.pages.flatMap((page) => page.photos) ?? [], [photos.data]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setSelected([]);
      setAdding(false);
    }
  }, [open]);

  const albumItems = useMemo(
    () => ({
      [ALL_PHOTOS]: t("immich.all-photos"),
      ...Object.fromEntries((albums.data ?? []).map((album) => [album.id, album.name])),
    }),
    [albums.data, t],
  );

  const toggle = (photo: ImmichPhoto) =>
    setSelected((current) =>
      current.some((item) => item.id === photo.id) ? current.filter((item) => item.id !== photo.id) : [...current, photo],
    );

  const handleAdd = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setAdding(true);
    const fetchPhoto = size === "preview" ? fetchImmichPreview : fetchImmichOriginal;
    const results = await Promise.allSettled(selected.map((photo) => fetchPhoto(photo, controller.signal)));
    if (controller.signal.aborted) return;
    const files = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    if (files.length < results.length) showErrorToast(t("immich.add-failed"));
    if (files.length > 0) onPick(files);
    setAdding(false);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup className="sm:max-w-3xl" closeLabel={t("common.close")}>
        <Dialog.Title>{t("immich.title")}</Dialog.Title>

        {!connectionLoading && !connected ? (
          <div className="flex flex-col items-start gap-3">
            <p className="mu-body text-mu-ink-muted">{t("immich.not-connected")}</p>
            <Link to="/setting#immich" onClick={() => onOpenChange(false)} className="mu-link mu-body">
              {t("common.settings")}
            </Link>
          </div>
        ) : (
          <>
            <Field.Root className="max-w-xs">
              <Field.Label>{t("immich.album")}</Field.Label>
              <Select.Root
                items={albumItems}
                value={albumId}
                onValueChange={(value) => {
                  if (value === null) return;
                  setAlbumId(value);
                }}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Popup>
                  <Select.Item value={ALL_PHOTOS}>{t("immich.all-photos")}</Select.Item>
                  {(albums.data ?? []).map((album) => (
                    <Select.Item key={album.id} value={album.id}>
                      {album.name}
                    </Select.Item>
                  ))}
                </Select.Popup>
              </Select.Root>
            </Field.Root>

            <div className="max-h-[55vh] min-h-40 overflow-y-auto">
              {photos.isLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <Spinner />
                </div>
              ) : photos.isError ? (
                <p className="mu-body text-mu-danger">{photos.error.message}</p>
              ) : photoList.length === 0 ? (
                <p className="mu-body text-mu-ink-muted">{t("immich.empty")}</p>
              ) : (
                <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-5" aria-label={t("immich.title")}>
                  {photoList.map((photo) => {
                    const order = selected.findIndex((item) => item.id === photo.id);
                    const isSelected = order >= 0;
                    return (
                      <li key={photo.id}>
                        <button
                          type="button"
                          data-immich-photo
                          aria-pressed={isSelected}
                          aria-label={photo.fileName}
                          onClick={() => toggle(photo)}
                          className={cn(
                            "relative block aspect-square w-full overflow-hidden rounded-mu-md bg-mu-well mu-focus",
                            isSelected && "outline-2 outline-offset-2 outline-mu-primary",
                          )}
                        >
                          <img
                            src={immichThumbnailUrl(photo.id)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="size-full object-cover"
                          />
                          {isSelected && (
                            <span className="absolute end-1 top-1 flex size-5 items-center justify-center rounded-full bg-mu-primary text-mu-on-primary">
                              <CheckIcon aria-hidden="true" className="mu-icon-xs" />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {photos.hasNextPage && (
                <div className="mt-3 flex justify-center">
                  <Button variant="neutral" size="sm" loading={photos.isFetchingNextPage} onClick={() => void photos.fetchNextPage()}>
                    {t("immich.load-more")}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        <Dialog.Footer>
          <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
          {connected && (
            <Button variant="primary" disabled={selected.length === 0} loading={adding} onClick={() => void handleAdd()}>
              {t("immich.add-photos", { count: selected.length })}
            </Button>
          )}
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
};

export default ImmichPickerDialog;
