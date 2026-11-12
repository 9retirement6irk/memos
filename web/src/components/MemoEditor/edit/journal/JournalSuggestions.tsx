import { create } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@usememos/ui";
import { ImagesIcon } from "lucide-react";
import { useState } from "react";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useImmichConnection } from "@/hooks/useImmichQueries";
import { useDawarichConnection } from "@/hooks/useJournalQueries";
import { fetchImmichOriginal, immichThumbnailUrl, listImmichPhotosTaken } from "@/lib/immich";
import { getRoute, placeAt } from "@/lib/journal/dawarich";
import { drawRouteImage, formatDistance } from "@/lib/journal/route";
import { groupPhotos, type PhotoSuggestion, spreadPick } from "@/lib/journal/suggestions";
import { placeName } from "@/lib/journal/weather";
import { showErrorToast } from "@/lib/toast";
import { LocationSchema } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { useEditorContext } from "../state";
import type { JournalSession } from "./useJournalSession";

/** How many of an outing's photos an entry takes. */
const PHOTOS_PER_ENTRY = 6;
const HIDDEN_KEY = "memos-journal-suggestions-hidden";

const today = () => new Date().toDateString();

const suggestionKey = (suggestion: PhotoSuggestion) => suggestion.start.toISOString();

/** "Yesterday · 2:14–5:02 PM", or the weekday for older days. */
const describeWhen = (suggestion: PhotoSuggestion, yesterdayLabel: string, todayLabel: string) => {
  const day = suggestion.start.toDateString();
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString();
  const dayLabel =
    day === now.toDateString()
      ? todayLabel
      : day === yesterday
        ? yesterdayLabel
        : suggestion.start.toLocaleDateString(undefined, { weekday: "long" });
  const time = (date: Date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dayLabel} · ${time(suggestion.start)}–${time(suggestion.end)}`;
};

/**
 * Suggestions above the composer: the outings in the last two days of the user's Immich
 * photos. Writing about one dates the entry to it, sets its place, and attaches some of its
 * photos and the route Dawarich recorded.
 */
export const JournalSuggestions = ({ journal, onAttachFiles }: { journal: JournalSession; onAttachFiles: (files: File[]) => void }) => {
  const t = useTranslate();
  const user = useCurrentUser();
  const { actions, dispatch } = useEditorContext();
  const { data: immich } = useImmichConnection();
  const { data: dawarich } = useDawarichConnection();
  const { settings, draft, update } = journal;
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem(HIDDEN_KEY) === today();
    } catch {
      return false;
    }
  });
  const [applying, setApplying] = useState<string>();
  const enabled = settings.showSuggestions && Boolean(immich?.configured) && !hidden;

  const { data: suggestions = [] } = useQuery({
    queryKey: ["journal", "suggestions", user?.name ?? "", today()],
    queryFn: async () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const photos = await listImmichPhotosTaken(start, now);
      return groupPhotos(
        photos.map((photo) => ({
          id: photo.id,
          fileName: photo.fileName,
          mimeType: photo.mimeType,
          takenAt: new Date(photo.takenAtUtc || photo.takenAt),
          latitude: photo.latitude,
          longitude: photo.longitude,
          city: photo.city,
        })),
      ).slice(0, 3);
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  if (!enabled || suggestions.length === 0) return null;

  const apply = async (suggestion: PhotoSuggestion) => {
    const key = suggestionKey(suggestion);
    setApplying(key);
    try {
      if (settings.useMomentDate) dispatch(actions.setTimestamps({ createTime: suggestion.start, updateTime: suggestion.start }));
      if (settings.addLocation && suggestion.latitude !== undefined && suggestion.longitude !== undefined) {
        const visit = dawarich?.configured ? await placeAt(suggestion.start).catch(() => undefined) : undefined;
        const name =
          visit?.name ?? (await placeName(suggestion.latitude, suggestion.longitude, navigator.language)) ?? suggestion.city ?? "";
        dispatch(
          actions.setMetadata({
            location: create(LocationSchema, { latitude: suggestion.latitude, longitude: suggestion.longitude, placeholder: name }),
          }),
        );
      }
      update({
        suggestion: key,
        momentNote: t("journal.moment-from-photos", { count: suggestion.photos.length }),
        locationSource: "photos",
      });

      const files = await Promise.all(
        spreadPick(suggestion.photos, PHOTOS_PER_ENTRY).map((photo) =>
          fetchImmichOriginal({ ...photo, takenAt: photo.takenAt.toISOString(), width: 0, height: 0 }),
        ),
      );
      if (settings.addRouteImage && dawarich?.configured) {
        const route = await getRoute(
          new Date(suggestion.start.getTime() - 30 * 60000),
          new Date(suggestion.end.getTime() + 30 * 60000),
        ).catch(() => undefined);
        const image = route
          ? await drawRouteImage(
              route.points,
              { width: 640, height: 400, caption: formatDistance(route.distanceMeters, settings.temperatureUnit) },
              `route-${suggestion.start.toISOString().slice(0, 10)}.png`,
            )
          : undefined;
        if (image) files.push(image);
      }
      onAttachFiles(files);
    } catch (failure) {
      showErrorToast((failure as Error).message);
    } finally {
      setApplying(undefined);
    }
  };

  return (
    <section aria-label={t("journal.suggestions")} className="flex w-full flex-col gap-1.5" data-journal-suggestions="">
      <div className="flex items-center gap-2">
        <span className="mu-label flex-1">{t("journal.suggestions")}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            try {
              window.localStorage.setItem(HIDDEN_KEY, today());
            } catch {
              // Hidden until the page reloads.
            }
            setHidden(true);
          }}
        >
          {t("journal.suggestions-hide")}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {suggestions.map((suggestion) => {
          const key = suggestionKey(suggestion);
          const chosen = draft.suggestion === key;
          return (
            <article
              key={key}
              className="flex flex-col gap-1.5 rounded-mu-md border border-mu-line bg-mu-surface p-2"
              data-chosen={chosen ? "" : undefined}
            >
              <span className="mu-caption text-mu-ink-muted">{describeWhen(suggestion, t("journal.yesterday"), t("journal.today"))}</span>
              <span className="mu-label flex items-center gap-1.5">
                <ImagesIcon className="mu-icon-sm" aria-hidden="true" />
                {suggestion.city
                  ? t("journal.suggestion-photos-at", { count: suggestion.photos.length, place: suggestion.city })
                  : t("journal.suggestion-photos", { count: suggestion.photos.length })}
              </span>
              <div className="flex h-12 gap-1">
                {spreadPick(suggestion.photos, 3).map((photo) => (
                  <img
                    key={photo.id}
                    src={immichThumbnailUrl(photo.id)}
                    alt=""
                    loading="lazy"
                    className="h-full min-w-0 flex-1 rounded-mu-sm object-cover"
                  />
                ))}
              </div>
              <Button
                size="sm"
                variant={chosen ? "primary" : "neutral"}
                loading={applying === key}
                disabled={Boolean(applying)}
                onClick={() => apply(suggestion)}
              >
                {chosen ? t("journal.suggestion-chosen") : t("journal.suggestion-write")}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
};
