import { getRequestToken } from "@/connect";

/** A failed call to one of the server's journal routes, with the server's message (already written for people). */
export class JournalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JournalApiError";
  }
}

/** Calls a server route with the session's access token; changes are refused without one. */
export const apiRequest = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const token = await getRequestToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Not a JSON error envelope: keep the status text.
    }
    throw new JournalApiError(message, response.status);
  }
  return response;
};

export const apiJSON = async <T>(path: string, init?: RequestInit): Promise<T> => (await apiRequest(path, init)).json() as Promise<T>;
