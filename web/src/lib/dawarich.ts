import { apiJSON } from "./journal/api";

/** What the server shares about the user's Dawarich connection: never the API key. */
export interface DawarichConnection {
  configured: boolean;
  url: string;
}

export interface RoutePoint {
  lat: number;
  lon: number;
  time: string;
}

export interface Route {
  points: RoutePoint[];
  distanceMeters: number;
}

export interface Visit {
  name: string;
  start: string;
  end: string;
  lat?: number;
  lon?: number;
}

const BASE = "/api/dawarich";

export const getDawarichConnection = () => apiJSON<DawarichConnection>(`${BASE}/connection`);

/** Saves the connection; the server checks it first. An empty key keeps the saved one. */
export const saveDawarichConnection = (url: string, apiKey: string) =>
  apiJSON<DawarichConnection>(`${BASE}/connection`, { method: "PUT", body: JSON.stringify({ url, apiKey }) });

export const deleteDawarichConnection = () => apiJSON<DawarichConnection>(`${BASE}/connection`, { method: "DELETE" });

const range = (start: Date, end: Date) =>
  new URLSearchParams({ start: start.toISOString().replace(/\.\d{3}Z$/, "Z"), end: end.toISOString().replace(/\.\d{3}Z$/, "Z") });

/** Where the user went between start and end, at most eight days apart. */
export const getRoute = (start: Date, end: Date) => apiJSON<Route>(`${BASE}/points?${range(start, end)}`);

/** The places the user stayed at between start and end. */
export const getVisits = async (start: Date, end: Date) =>
  (await apiJSON<{ visits: Visit[] }>(`${BASE}/visits?${range(start, end)}`)).visits;

/** Where the user was at `at`: the visit covering it, else the nearest point within half an hour. */
export const placeAt = async (at: Date): Promise<{ lat: number; lon: number; name?: string } | undefined> => {
  const start = new Date(at.getTime() - 30 * 60 * 1000);
  const end = new Date(at.getTime() + 30 * 60 * 1000);
  const [visits, route] = await Promise.all([getVisits(start, end).catch(() => [] as Visit[]), getRoute(start, end)]);
  const visit = visits.find((v) => new Date(v.start) <= at && at <= new Date(v.end) && v.lat !== undefined && v.lon !== undefined);
  if (visit?.lat !== undefined && visit.lon !== undefined) return { lat: visit.lat, lon: visit.lon, name: visit.name };
  let nearest: RoutePoint | undefined;
  for (const point of route.points) {
    if (!nearest || Math.abs(new Date(point.time).getTime() - at.getTime()) < Math.abs(new Date(nearest.time).getTime() - at.getTime())) {
      nearest = point;
    }
  }
  return nearest ? { lat: nearest.lat, lon: nearest.lon } : undefined;
};

/** One journey Dawarich cut from the user's points. */
export interface Track {
  id: number;
  start: string;
  end: string;
  distanceMeters: number;
  /** Like "walking" or "driving"; absent when Dawarich doesn't know. */
  mode?: string;
  points: { lat: number; lon: number }[];
}

/**
 * The journeys overlapping start..end, oldest first. `supported` is false on a Dawarich too old
 * to list tracks; the whole day's points still make a route then.
 */
export const getTracks = (start: Date, end: Date) =>
  apiJSON<{ tracks: Track[]; supported: boolean }>(`${BASE}/tracks?${range(start, end)}`);

const MAP_TILES_KEY = "memos-route-map-tiles";

/** Whether route images get OpenStreetMap's map underneath: on unless the user turned it off. */
export const routeMapTiles = (): boolean => {
  try {
    return localStorage.getItem(MAP_TILES_KEY) !== "off";
  } catch {
    return true;
  }
};

export const setRouteMapTiles = (on: boolean) => {
  try {
    localStorage.setItem(MAP_TILES_KEY, on ? "on" : "off");
  } catch {
    // Not remembered in this browser; the choice still applies now.
  }
};
