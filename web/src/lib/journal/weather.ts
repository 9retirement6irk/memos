/**
 * Weather from Open-Meteo, which needs no key: the temperature and sky at a place
 * and time, past or near future. The browser asks it directly, with only the
 * coordinates and the date.
 */

export type WeatherKind = "clear" | "mostly-clear" | "partly-cloudy" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "thunderstorm";

export interface Weather {
  temperature: number;
  unit: "fahrenheit" | "celsius";
  kind: WeatherKind;
}

export interface Place {
  lat: number;
  lon: number;
  name: string;
}

/** What a WMO weather code describes. */
export const weatherKind = (code: number): WeatherKind => {
  if (code === 0) return "clear";
  if (code === 1) return "mostly-clear";
  if (code === 2) return "partly-cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunderstorm";
  return "cloudy";
};

const day = (date: Date) => date.toISOString().slice(0, 10);

/** The forecast service covers about three months back; the archive covers everything older. */
const ARCHIVE_AFTER_DAYS = 80;

/** The weather at a place in the hour nearest `at`, or undefined when Open-Meteo has none. */
export const weatherAt = async (lat: number, lon: number, at: Date, unit: Weather["unit"]): Promise<Weather | undefined> => {
  const old = Date.now() - at.getTime() > ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const endpoint = old ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "temperature_2m,weather_code",
    temperature_unit: unit,
    timezone: "GMT",
    start_date: day(at),
    end_date: day(at),
  });
  const response = await fetch(`${endpoint}?${params}`);
  if (!response.ok) return undefined;
  const data = (await response.json()) as {
    hourly?: { time: string[]; temperature_2m: (number | null)[]; weather_code: (number | null)[] };
  };
  const hourly = data.hourly;
  if (!hourly?.time.length) return undefined;
  const hour = Math.min(Math.max(at.getUTCHours(), 0), hourly.time.length - 1);
  const temperature = hourly.temperature_2m[hour];
  const code = hourly.weather_code[hour];
  if (temperature === null || temperature === undefined || code === null || code === undefined) return undefined;
  return { temperature: Math.round(temperature), unit, kind: weatherKind(code) };
};

/** The place a city name means, like "Boston, MA", or undefined when there is none. */
export const findCity = async (name: string, language: string): Promise<Place | undefined> => {
  const [city, ...rest] = name.split(",").map((part) => part.trim());
  if (!city) return undefined;
  const params = new URLSearchParams({ name: city, count: "10", language: language.split("-")[0] || "en", format: "json" });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) return undefined;
  const data = (await response.json()) as {
    results?: {
      latitude: number;
      longitude: number;
      name: string;
      admin1?: string;
      admin1_code?: string;
      country?: string;
      country_code?: string;
    }[];
  };
  const qualifier = rest.join(" ").toLowerCase();
  const match =
    data.results?.find((result) =>
      [result.admin1, result.admin1_code, result.country, result.country_code].some(
        (part) => part && qualifier.includes(part.toLowerCase()),
      ),
    ) ?? data.results?.[0];
  return match ? { lat: match.latitude, lon: match.longitude, name: match.name } : undefined;
};

/** A short name for where a point is, like "Jamaica Plain" or "Boston", from OpenStreetMap. */
export const placeName = async (lat: number, lon: number, language: string): Promise<string | undefined> => {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: "jsonv2", zoom: "16", "accept-language": language });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { headers: { Accept: "application/json" } });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { name?: string; address?: Record<string, string> };
    const address = data.address ?? {};
    return (
      data.name || address.park || address.neighbourhood || address.suburb || address.city || address.town || address.village || undefined
    );
  } catch {
    return undefined;
  }
};

/** The first place OpenStreetMap finds for a name or address. */
export const searchPlace = async (query: string, language: string): Promise<Place | undefined> => {
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", "accept-language": language });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: "application/json" } });
    if (!response.ok) return undefined;
    const results = (await response.json()) as { lat: string; lon: string; name?: string; display_name?: string }[];
    const first = results[0];
    if (!first) return undefined;
    return { lat: Number(first.lat), lon: Number(first.lon), name: first.name || first.display_name?.split(",")[0] || query };
  } catch {
    return undefined;
  }
};
