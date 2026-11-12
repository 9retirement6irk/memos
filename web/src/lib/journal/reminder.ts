import { apiJSON, apiRequest } from "./api";

/** What the server shares about the reminder: never the Home Assistant token. */
export interface JournalReminder {
  configured: boolean;
  enabled: boolean;
  url: string;
  notifier: string;
  /** "HH:MM" in `timezone`. */
  time: string;
  /** 0 is Sunday. */
  days: number[];
  timezone: string;
  openUrl: string;
  onlyIfNotWritten: boolean;
  streakWarning: boolean;
}

export type JournalReminderInput = Omit<JournalReminder, "configured"> & { token: string };

const BASE = "/api/journal/reminder";

export const getJournalReminder = () => apiJSON<JournalReminder>(BASE);

/** Saves the reminder; the server checks Home Assistant first. An empty token keeps the saved one. */
export const saveJournalReminder = (reminder: JournalReminderInput) =>
  apiJSON<JournalReminder>(BASE, { method: "PUT", body: JSON.stringify(reminder) });

export const deleteJournalReminder = () => apiJSON<JournalReminder>(BASE, { method: "DELETE" });

/** The notify services of the Home Assistant at `url`. An empty token uses the saved one. */
export const listNotifiers = async (url: string, token: string) =>
  (await apiJSON<{ notifiers: string[] }>(`${BASE}/notifiers`, { method: "POST", body: JSON.stringify({ url, token }) })).notifiers;

export const sendTestReminder = async () => {
  await apiRequest(`${BASE}/test`, { method: "POST" });
};
