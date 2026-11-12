import { getRequestToken } from "@/connect";

/** What the server shares about the user's Immich connection: never the API key. */
export interface ImmichConnection {
  configured: boolean;
  url: string;
}

export interface ImmichAlbum {
  id: string;
  name: string;
  photoCount: number;
  thumbnailPhotoId: string;
}

export interface ImmichPhoto {
  id: string;
  fileName: string;
  mimeType: string;
  takenAt: string;
  width: number;
  height: number;
}

export interface ImmichPhotoPage {
  photos: ImmichPhoto[];
  /** Empty on the last page. */
  next: string;
}

/** A failed /api/immich call, with the server's message (already written for people). */
export class ImmichError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ImmichError";
  }
}

const BASE = "/api/immich";

/** Calls /api/immich with the session's access token; changes are refused without one. */
const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const token = await getRequestToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Not a JSON error envelope: keep the status text.
    }
    throw new ImmichError(message, response.status);
  }
  return response;
};

const json = async <T>(path: string, init?: RequestInit): Promise<T> => (await request(path, init)).json() as Promise<T>;

export const getImmichConnection = () => json<ImmichConnection>("/connection");

/** Saves the connection after the server has checked it works. An empty key keeps the saved one. */
export const saveImmichConnection = (url: string, apiKey: string) =>
  json<ImmichConnection>("/connection", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, apiKey }),
  });

export const deleteImmichConnection = () => json<ImmichConnection>("/connection", { method: "DELETE" });

export const listImmichAlbums = () => json<ImmichAlbum[]>("/albums");

export const listImmichPhotos = (albumId: string, next: string) => {
  const params = new URLSearchParams();
  if (albumId) params.set("album", albumId);
  if (next) params.set("next", next);
  const query = params.toString();
  return json<ImmichPhotoPage>(`/photos${query ? `?${query}` : ""}`);
};

/** One photo of a dated search, with where and exactly when it was taken when the photo says. */
export interface ImmichTakenPhoto extends ImmichPhoto {
  /** The moment in UTC; empty when unknown. */
  takenAtUtc?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
}

const isoSeconds = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Every photo taken between after and before (at most eight days apart), oldest first. */
export const listImmichPhotosTaken = async (after: Date, before: Date, maxPages = 10): Promise<ImmichTakenPhoto[]> => {
  const photos: ImmichTakenPhoto[] = [];
  let next = "";
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ after: isoSeconds(after), before: isoSeconds(before) });
    if (next) params.set("next", next);
    const result = await json<{ photos: ImmichTakenPhoto[]; next: string }>(`/photos/taken?${params}`);
    photos.push(...result.photos);
    next = result.next;
    if (!next) break;
  }
  return photos;
};

/** A small preview of the photo; an <img> loads it with the session cookie. */
export const immichThumbnailUrl = (photoId: string) => `${BASE}/photos/${encodeURIComponent(photoId)}/thumbnail`;

/** Downloads the photo's original from Immich, through this server, as a File ready to attach. */
export const fetchImmichOriginal = async (photo: ImmichPhoto, signal?: AbortSignal): Promise<File> => {
  const response = await request(`/photos/${encodeURIComponent(photo.id)}/original`, { signal });
  const blob = await response.blob();
  return new File([blob], photo.fileName || `${photo.id}.jpg`, {
    type: blob.type || photo.mimeType || "image/jpeg",
    lastModified: photo.takenAt ? Date.parse(photo.takenAt) || Date.now() : Date.now(),
  });
};
