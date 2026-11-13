import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchImmichOriginal, fetchImmichPreview, ImmichError, listImmichPhotos, saveImmichConnection } from "@/lib/immich";

vi.mock("@/connect", () => ({ getRequestToken: vi.fn(async () => "access-token") }));

const fetchMock = vi.fn();

describe("Immich API client", () => {
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("sends the access token, so changes work without relying on the cookie", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ configured: true, url: "http://immich.example.com" }), { status: 200 }));
    await saveImmichConnection("http://immich.example.com", "key");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/immich/connection");
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer access-token");
    expect(JSON.parse(init.body)).toEqual({ url: "http://immich.example.com", apiKey: "key" });
  });

  it("asks for an album's next page", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ photos: [], next: "" }), { status: 200 }));
    await listImmichPhotos("album-1", "c:abc");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/immich/photos?album=album-1&next=c%3Aabc");
  });

  it("reports the server's message on failure", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "connect Immich in Settings first" }), { status: 404 }));
    const failure = listImmichPhotos("", "");
    await expect(failure).rejects.toBeInstanceOf(ImmichError);
    await expect(failure).rejects.toThrow("connect Immich in Settings first");
  });

  it("turns an original into a File named like the photo", async () => {
    fetchMock.mockResolvedValue(new Response("jpeg", { status: 200, headers: { "Content-Type": "image/jpeg" } }));
    const file = await fetchImmichOriginal({
      id: "p1",
      fileName: "IMG_1.jpg",
      mimeType: "image/jpeg",
      takenAt: "2026-11-01T10:00:00Z",
      width: 0,
      height: 0,
    });
    expect(file.name).toBe("IMG_1.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(file.lastModified).toBe(Date.parse("2026-11-01T10:00:00Z"));
  });

  it("fetches the preview of a HEIC photo as a JPEG named after it", async () => {
    fetchMock.mockResolvedValue(new Response("jpeg", { status: 200, headers: { "Content-Type": "image/jpeg" } }));
    const file = await fetchImmichPreview({
      id: "p1",
      fileName: "IMG_0042.HEIC",
      mimeType: "image/heic",
      takenAt: "2026-11-01T10:00:00Z",
      width: 0,
      height: 0,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/immich/photos/p1/preview");
    expect(file.name).toBe("IMG_0042.jpg");
    expect(file.type).toBe("image/jpeg");
  });
});
