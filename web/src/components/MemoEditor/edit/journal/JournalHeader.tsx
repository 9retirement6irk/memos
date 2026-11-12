import { create } from "@bufbuild/protobuf";
import { Button, Input, Menu, Popover } from "@usememos/ui";
import {
  BookHeartIcon,
  ChevronDownIcon,
  LocateFixedIcon,
  MapPinIcon,
  MapPinOffIcon,
  NotebookPenIcon,
  SearchIcon,
  Settings2Icon,
  SunIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDawarichConnection, useSaveJournalSettings } from "@/hooks/useJournalQueries";
import { placeAt } from "@/lib/journal/dawarich";
import { findCity, placeName, searchPlace, weatherAt } from "@/lib/journal/weather";
import { showErrorToast } from "@/lib/toast";
import { LocationSchema } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { useEditorContext, useEditorSelector } from "../state";
import type { JournalSession, LocationSource } from "./useJournalSession";

const language = () => (typeof navigator !== "undefined" ? navigator.language : "en");

/** The badge that says journaling mode is on, and its menu for leaving it. */
const ModeBadge = ({ journal }: { journal: JournalSession }) => {
  const t = useTranslate();
  const navigate = useNavigate();
  const saveSettings = useSaveJournalSettings();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger render={<Button variant="neutral" size="sm" icon={<BookHeartIcon />} iconEnd={<ChevronDownIcon />} />}>
        {t("journal.mode")}
      </Menu.Trigger>
      <Menu.Popup align="end">
        <Menu.Item icon={<NotebookPenIcon />} description={t("journal.exit.plain-description")} onClick={() => journal.setActive(false)}>
          {t("journal.exit.plain")}
        </Menu.Item>
        {journal.inJournalSpace && (
          <Menu.Item
            icon={<BookHeartIcon />}
            description={t("journal.exit.space-description")}
            onClick={() =>
              saveSettings.mutate(
                { ...journal.settings, openInJournalMode: false },
                { onSuccess: () => journal.update({ override: undefined }), onError: (failure) => showErrorToast(failure.message) },
              )
            }
          >
            {t("journal.exit.space")}
          </Menu.Item>
        )}
        <Menu.Separator />
        <Menu.Item icon={<Settings2Icon />} onClick={() => navigate("/setting#journal")}>
          {t("journal.exit.settings")}
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
};

/** Chooses the entry's location: here and now, where Dawarich had the user, a place by name, or none. */
const LocationMenu = ({ journal, moment }: { journal: JournalSession; moment: Date }) => {
  const t = useTranslate();
  const { actions, dispatch } = useEditorContext();
  const { data: dawarich } = useDawarichConnection();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  const setPlace = (lat: number, lon: number, name: string | undefined, source: LocationSource) => {
    dispatch(actions.setMetadata({ location: create(LocationSchema, { latitude: lat, longitude: lon, placeholder: name ?? "" }) }));
    journal.update({ locationSource: source });
  };

  const run = async (task: () => Promise<boolean>) => {
    setBusy(true);
    try {
      if (!(await task())) showErrorToast(t("journal.location.not-found"));
    } catch (failure) {
      showErrorToast((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const useCurrent = () =>
    run(
      () =>
        new Promise<boolean>((resolve) => {
          if (!navigator.geolocation) return resolve(false);
          navigator.geolocation.getCurrentPosition(
            async (position) => {
              const { latitude, longitude } = position.coords;
              setPlace(latitude, longitude, await placeName(latitude, longitude, language()), "current");
              resolve(true);
            },
            () => resolve(false),
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
          );
        }),
    );

  const useDawarich = () =>
    run(async () => {
      const place = await placeAt(moment);
      if (!place) return false;
      setPlace(place.lat, place.lon, place.name ?? (await placeName(place.lat, place.lon, language())), "dawarich");
      return true;
    });

  const useSearch = () =>
    run(async () => {
      const place = await searchPlace(query.trim(), language());
      if (!place) return false;
      setPlace(place.lat, place.lon, place.name, "search");
      setSearching(false);
      setQuery("");
      return true;
    });

  const time = moment.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger
          render={<Button ref={anchor} variant="ghost" size="sm" icon={<MapPinIcon />} iconEnd={<ChevronDownIcon />} loading={busy} />}
        >
          {t("journal.location.label")}
        </Menu.Trigger>
        <Menu.Popup align="start">
          <Menu.Item icon={<LocateFixedIcon />} description={t("journal.location.current-description")} onClick={useCurrent}>
            {t("journal.location.current")}
          </Menu.Item>
          {dawarich?.configured && (
            <Menu.Item icon={<MapPinIcon />} description={t("journal.location.dawarich-description")} onClick={useDawarich}>
              {t("journal.location.dawarich", { time })}
            </Menu.Item>
          )}
          <Menu.Item icon={<SearchIcon />} onClick={() => setSearching(true)}>
            {t("journal.location.search")}
          </Menu.Item>
          <Menu.Item
            icon={<MapPinOffIcon />}
            description={t("journal.location.none-description")}
            onClick={() => {
              dispatch(actions.setMetadata({ location: undefined }));
              journal.update({ locationSource: "none" });
            }}
          >
            {t("journal.location.none")}
          </Menu.Item>
        </Menu.Popup>
      </Menu.Root>
      <Popover.Root open={searching} onOpenChange={setSearching}>
        <Popover.Popup anchor={anchor} align="start" className="flex w-72 flex-col gap-2 p-3">
          <Popover.Title className="mu-label">{t("journal.location.search")}</Popover.Title>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (query.trim()) void useSearch();
            }}
          >
            <Input autoFocus aria-label={t("journal.location.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
            <Button type="submit" variant="primary" icon={<SearchIcon />} aria-label={t("journal.location.search")} loading={busy} />
          </form>
        </Popover.Popup>
      </Popover.Root>
    </>
  );
};

/**
 * Journaling mode's line above the text: the mode badge, the location menu, the weather
 * for the entry's place and moment, and where the moment came from.
 */
export const JournalHeader = ({ journal }: { journal: JournalSession }) => {
  const t = useTranslate();
  const { actions, dispatch } = useEditorContext();
  const location = useEditorSelector((s) => s.metadata.location);
  const createTime = useEditorSelector((s) => s.timestamps.createTime);
  const { data: dawarich } = useDawarichConnection();
  const { settings, draft, update } = journal;
  // The moment, to the hour; a new entry with no time of its own is about now.
  const [now] = useState(() => new Date());
  const moment = createTime ?? now;
  const hour = Math.floor(moment.getTime() / 3600000);

  // A new entry starts where Dawarich has the user, when they want that and nothing is set.
  useEffect(() => {
    if (!settings.addLocation || !dawarich?.configured || location || draft.locationSource) return;
    let cancelled = false;
    void placeAt(moment)
      .then(async (place) => {
        if (cancelled || !place) return;
        const name = place.name ?? (await placeName(place.lat, place.lon, language()));
        if (cancelled) return;
        dispatch(
          actions.setMetadata({ location: create(LocationSchema, { latitude: place.lat, longitude: place.lon, placeholder: name ?? "" }) }),
        );
        update({ locationSource: "dawarich" });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // The moment's hour is enough; a few minutes don't move anyone.
  }, [settings.addLocation, dawarich?.configured, location, draft.locationSource, hour]);

  // The weather follows the entry's location, or the default city when it has none.
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  useEffect(() => {
    if (!settings.addWeather) {
      if (draft.weather) update({ weather: undefined });
      return;
    }
    let cancelled = false;
    void (async () => {
      const place =
        latitude !== undefined && longitude !== undefined && (latitude !== 0 || longitude !== 0)
          ? { lat: latitude, lon: longitude }
          : settings.defaultCity
            ? await findCity(settings.defaultCity, language())
            : undefined;
      const weather = place ? await weatherAt(place.lat, place.lon, new Date(hour * 3600000), settings.temperatureUnit) : undefined;
      if (!cancelled) update({ weather });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // The hour stands in for the moment here too.
  }, [settings.addWeather, settings.defaultCity, settings.temperatureUnit, latitude, longitude, hour]);

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5" data-journal-header="">
      <LocationMenu journal={journal} moment={moment} />
      {draft.weather && (
        <span className="mu-caption flex items-center gap-1 text-mu-ink-muted">
          <SunIcon className="mu-icon-sm" aria-hidden="true" />
          {draft.weather.temperature}°{draft.weather.unit === "fahrenheit" ? "F" : "C"},{" "}
          {t(`journal.weather.${draft.weather.kind}` as never)}
        </span>
      )}
      {draft.momentNote && <span className="mu-caption text-mu-ink-muted">{draft.momentNote}</span>}
      <span className="ms-auto">
        <ModeBadge journal={journal} />
      </span>
    </div>
  );
};
