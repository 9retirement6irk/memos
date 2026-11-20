import { translate } from "@/utils/i18n";

/**
 * Why a call to one of the fork's server routes failed, for people. Memos explains its own errors in a JSON
 * `message`; a reply without one came from something in front of it (a proxy or ingress refusing a method, a
 * gateway timing out), and over HTTP/2 it has no status text either, so the status code is what's left to show.
 */
export const responseErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) return body.message;
  } catch {
    // Not Memos' JSON error envelope.
  }
  return translate("message.request-failed", { status: response.status });
};
