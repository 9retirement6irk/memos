import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, JournalApiError } from "@/lib/journal/api";
import { responseErrorMessage } from "@/lib/responseError";

vi.mock("@/connect", () => ({ getRequestToken: async () => "token" }));
vi.mock("@/utils/i18n", () => ({
  translate: (key: string, params?: Record<string, unknown>) => `${key} ${JSON.stringify(params)}`,
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("responseErrorMessage", () => {
  it("uses Memos' own explanation", async () => {
    await expect(responseErrorMessage(json(400, { message: "invalid journal Space" }))).resolves.toBe("invalid journal Space");
  });

  it("names the status when something in front of Memos answered instead", async () => {
    // An ingress refusing PUT: an HTML page, and over HTTP/2 no status text.
    const refused = new Response("<html>405 Not Allowed</html>", { status: 405, statusText: "" });
    await expect(responseErrorMessage(refused)).resolves.toBe('message.request-failed {"status":405}');
    await expect(responseErrorMessage(new Response(null, { status: 502 }))).resolves.toBe('message.request-failed {"status":502}');
    await expect(responseErrorMessage(json(500, { message: " " }))).resolves.toBe('message.request-failed {"status":500}');
  });
});

describe("apiRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never fails with an empty message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 405 })));
    const failure = await apiRequest("/api/journal/settings", { method: "PUT", body: "{}" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JournalApiError);
    expect((failure as JournalApiError).message).toBe('message.request-failed {"status":405}');
    expect((failure as JournalApiError).status).toBe(405);
  });
});
