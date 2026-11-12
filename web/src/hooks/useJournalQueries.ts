import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import useCurrentUser from "@/hooks/useCurrentUser";
import {
  deleteJournalReminder,
  getJournalReminder,
  type JournalReminder,
  type JournalReminderInput,
  saveJournalReminder,
} from "@/lib/journal/reminder";
import {
  defaultJournalSettings,
  getJournalSettings,
  type JournalSettings,
  saveJournalSettings,
  withDefaults,
} from "@/lib/journal/settings";
import { useTranslate } from "@/utils/i18n";

export const journalKeys = {
  all: ["journal"] as const,
  settings: (user: string) => [...journalKeys.all, "settings", user] as const,
  reminder: (user: string) => [...journalKeys.all, "reminder", user] as const,
};

/** The signed-in user's journal settings, with defaults for anything not saved yet. */
export const useJournalSettings = () => {
  const user = useCurrentUser();
  const t = useTranslate();
  const query = useQuery({
    queryKey: journalKeys.settings(user?.name ?? ""),
    queryFn: getJournalSettings,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });
  const settings = useMemo(
    () =>
      withDefaults(
        query.data ?? {},
        defaultJournalSettings((id) => t(`journal.activity.${id}` as never)),
      ),
    [query.data, t],
  );
  return { settings, isLoading: query.isLoading, isLoaded: query.isSuccess };
};

export const useSaveJournalSettings = () => {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: JournalSettings) => saveJournalSettings(settings),
    onSuccess: (saved) => queryClient.setQueryData(journalKeys.settings(user?.name ?? ""), saved),
  });
};

/** The signed-in user's streak reminder, without the Home Assistant token. */
export const useJournalReminder = () => {
  const user = useCurrentUser();
  return useQuery({
    queryKey: journalKeys.reminder(user?.name ?? ""),
    queryFn: getJournalReminder,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });
};

export const useUpdateJournalReminder = () => {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const onSuccess = (reminder: JournalReminder) => queryClient.setQueryData(journalKeys.reminder(user?.name ?? ""), reminder);
  const save = useMutation({ mutationFn: (reminder: JournalReminderInput) => saveJournalReminder(reminder), onSuccess });
  const remove = useMutation({ mutationFn: deleteJournalReminder, onSuccess });
  return { save, remove };
};
