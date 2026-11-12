import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, Field, Fieldset, Input, Radio, RadioGroup, Spinner, Switch } from "@usememos/ui";
import { BikeIcon, BusIcon, CarIcon, FootprintsIcon, type LucideIcon, PlaneIcon, RouteIcon, ShipIcon, TrainFrontIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useDawarichTracks } from "@/hooks/useDawarichQueries";
import { useJournalSettings } from "@/hooks/useJournalQueries";
import i18n from "@/i18n";
import { getRoute, routeMapTiles, setRouteMapTiles, type Track } from "@/lib/dawarich";
import { drawRouteImage, formatDistance, type LatLon } from "@/lib/routeImage";
import { useTranslate } from "@/utils/i18n";

const WHOLE_DAY = "day";
/** Shorter journeys are standing still with a wobbly signal. */
const MIN_TRACK_METERS = 50;
const IMAGE = { width: 640, height: 400 };

const MODE_ICONS: Record<string, LucideIcon> = {
  walking: FootprintsIcon,
  running: FootprintsIcon,
  cycling: BikeIcon,
  driving: CarIcon,
  motorcycle: CarIcon,
  bus: BusIcon,
  train: TrainFrontIcon,
  flying: PlaneIcon,
  boat: ShipIcon,
};

/** "2026-11-11" for the local day of `date`, as a date input wants. */
export const dayValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** The local day `value` names, from midnight to the next midnight. */
export const dayRange = (value: string): { start: Date; end: Date } | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

/** Journeys worth drawing: moving ones, with a line. */
export const drawableTracks = (tracks: Track[]) =>
  tracks.filter((track) => track.points.length >= 2 && track.distanceMeters >= MIN_TRACK_METERS && track.mode !== "stationary");

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The day to start on, like the memo's own date. Today when absent. */
  day?: Date;
  /** Receives the drawn route as a PNG file. */
  onPick: (files: File[]) => void;
}

/**
 * Pick a day and one of its journeys (or the whole day) from the user's Dawarich, and attach the
 * route as an image. Dawarich's own posters are made in its web app and aren't in its API, so the
 * image is drawn here from the journey's line.
 */
const RoutePickerDialog = ({ open, onOpenChange, day, onPick }: Props) => {
  const t = useTranslate();
  const { settings } = useJournalSettings();
  const [dayText, setDayText] = useState(() => dayValue(day ?? new Date()));
  const [choice, setChoice] = useState(WHOLE_DAY);
  const [mapTiles, setMapTiles] = useState(routeMapTiles);
  const [preview, setPreview] = useState<{ file: File; url: string } | undefined>();
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    if (open) {
      setDayText(dayValue(day ?? new Date()));
      setChoice(WHOLE_DAY);
    }
  }, [open, day]);

  const range = dayRange(dayText);
  const start = range?.start ?? new Date(0);
  const end = range?.end ?? new Date(1);
  const tracksQuery = useDawarichTracks(start, end, open && Boolean(range));
  const routeQuery = useQuery({
    queryKey: ["dawarich", "day-route", start.toISOString(), end.toISOString()],
    queryFn: () => getRoute(start, end),
    enabled: open && Boolean(range),
    staleTime: 60 * 1000,
  });
  const tracks = useMemo(() => drawableTracks(tracksQuery.data?.tracks ?? []), [tracksQuery.data]);

  const language = i18n.language || undefined;
  const time = useMemo(() => new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }), [language]);
  const date = useMemo(() => new Intl.DateTimeFormat(language, { month: "short", day: "numeric", year: "numeric" }), [language]);
  const trackLabel = (track: Track) =>
    `${time.formatRange(new Date(track.start), new Date(track.end))} · ${formatDistance(track.distanceMeters, settings.temperatureUnit)}`;

  // What the chosen option draws: its line, its distance and the caption in the image's corner.
  const selected = useMemo((): { points: LatLon[]; caption: string; name: string } | undefined => {
    if (!range) return undefined;
    const track = tracks.find((item) => String(item.id) === choice);
    if (track) {
      return {
        points: track.points,
        caption: `${date.format(new Date(track.start))}, ${trackLabel(track)}`,
        name: `route-${dayText}-${track.id}.png`,
      };
    }
    const route = routeQuery.data;
    if (choice !== WHOLE_DAY || !route || route.points.length < 2) return undefined;
    return {
      points: route.points,
      caption: `${date.format(range.start)} · ${formatDistance(route.distanceMeters, settings.temperatureUnit)}`,
      name: `route-${dayText}.png`,
    };
  }, [range?.start.getTime(), tracks, choice, routeQuery.data, date, time, settings.temperatureUnit, dayText]);

  useEffect(() => {
    if (!open || !selected) {
      setPreview(undefined);
      return;
    }
    let cancelled = false;
    setDrawing(true);
    void drawRouteImage(selected.points, { ...IMAGE, caption: selected.caption, mapTiles }, selected.name)
      .then((file) => {
        if (cancelled) return;
        setPreview(file ? { file, url: URL.createObjectURL(file) } : undefined);
      })
      .finally(() => {
        if (!cancelled) setDrawing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selected, mapTiles]);

  // Each preview's object URL is let go when the next replaces it.
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview.url) : undefined), [preview]);

  const loading = tracksQuery.isLoading || routeQuery.isLoading;
  const failure = routeQuery.error ?? tracksQuery.error;
  const empty = !loading && !failure && tracks.length === 0 && (routeQuery.data?.points.length ?? 0) < 2;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup className="sm:max-w-2xl" closeLabel={t("common.close")}>
        <Dialog.Title>{t("dawarich.route.title")}</Dialog.Title>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field.Root className="w-44">
              <Field.Label>{t("dawarich.route.day")}</Field.Label>
              <Input
                type="date"
                required
                max={dayValue(new Date())}
                value={dayText}
                onChange={(event) => {
                  setDayText(event.target.value);
                  setChoice(WHOLE_DAY);
                }}
              />
            </Field.Root>
            <Field.Root className="min-w-0 flex-1">
              <Field.Label className="flex items-center gap-2">
                <Switch
                  checked={mapTiles}
                  onCheckedChange={(on) => {
                    setMapTiles(on);
                    setRouteMapTiles(on);
                  }}
                />
                {t("dawarich.route.map")}
              </Field.Label>
              <Field.Description>{t("dawarich.route.map-description")}</Field.Description>
            </Field.Root>
          </div>

          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : failure ? (
            <p className="mu-body text-mu-danger">{failure.message}</p>
          ) : empty ? (
            <p className="mu-body text-mu-ink-muted">{t("dawarich.route.empty")}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <Fieldset.Root render={<RadioGroup value={choice} onValueChange={(value) => setChoice(String(value))} />}>
                <Fieldset.Legend>{t("dawarich.route.which")}</Fieldset.Legend>
                <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  <Field.Item>
                    <Field.Label>
                      <Radio value={WHOLE_DAY} /> {t("dawarich.route.whole-day")}
                    </Field.Label>
                  </Field.Item>
                  {tracks.map((track) => {
                    const ModeIcon = (track.mode && MODE_ICONS[track.mode]) || RouteIcon;
                    return (
                      <Field.Item key={track.id}>
                        <Field.Label className="flex items-center gap-1.5">
                          <Radio value={String(track.id)} />
                          <ModeIcon aria-hidden="true" className="mu-icon-sm shrink-0 text-mu-ink-muted" />
                          <span className="mu-body">{trackLabel(track)}</span>
                        </Field.Label>
                      </Field.Item>
                    );
                  })}
                </div>
              </Fieldset.Root>
              <div className="relative flex aspect-[8/5] items-center justify-center overflow-hidden rounded-mu-md bg-mu-well">
                {preview ? (
                  <img src={preview.url} alt={t("dawarich.route.preview")} className="size-full object-cover" data-route-preview />
                ) : (
                  drawing && <Spinner />
                )}
              </div>
            </div>
          )}
        </div>

        <Dialog.Footer>
          <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
          <Button
            variant="primary"
            disabled={!preview || drawing}
            onClick={() => {
              if (!preview) return;
              onPick([preview.file]);
              onOpenChange(false);
            }}
          >
            {t("dawarich.route.add")}
          </Button>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
};

export default RoutePickerDialog;
