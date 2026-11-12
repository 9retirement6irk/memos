import { useQuery } from "@tanstack/react-query";
import { FlameIcon } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { memoServiceClient } from "@/connect";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalSettings } from "@/hooks/useJournalQueries";
import { MOODS, type Mood, moodFromTags } from "@/lib/journal/entry";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { MoodFace, moodColor } from "./MoodFace";

/** How many years back On This Day looks. */
const YEARS_BACK = 5;

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** The entries of the journal Space in a CEL time window. */
const listEntries = async (space: string, filter: string): Promise<Memo[]> => {
  const memos: Memo[] = [];
  let pageToken = "";
  do {
    const response = await memoServiceClient.listMemos({ pageSize: 500, pageToken, filter: `space == "${space}" && (${filter})` });
    memos.push(...response.memos);
    pageToken = response.nextPageToken;
  } while (pageToken && memos.length < 2000);
  return memos;
};

const entryDate = (memo: Memo) => new Date(Number(memo.createTime?.seconds ?? 0) * 1000);

/** The first line of an entry worth reading: not a heading, quote, task or tag line. */
const snippet = (content: string) =>
  content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !/^(#|>|- \[|\d+°)/.test(line))
    ?.slice(0, 140) ?? "";

/**
 * Beside the journal Space: the writing streak, entries from this day in earlier years,
 * and the month's moods. All of it is read from the entries' dates and mood tags.
 */
export const JournalPanel = () => {
  const t = useTranslate();
  const user = useCurrentUser();
  const { settings } = useJournalSettings();
  const now = useMemo(() => new Date(), []);

  const { data: recent = [] } = useQuery({
    queryKey: ["journal", "panel", "recent", user?.name ?? "", settings.space, dayKey(now)],
    queryFn: () => listEntries(settings.space, `created_ts >= timestamp(${seconds(new Date(now.getFullYear(), now.getMonth() - 13, 1))})`),
    enabled: Boolean(user && settings.space),
    staleTime: 60 * 1000,
  });

  const { data: earlier = [] } = useQuery({
    queryKey: ["journal", "panel", "on-this-day", user?.name ?? "", settings.space, dayKey(now)],
    queryFn: () =>
      listEntries(
        settings.space,
        Array.from({ length: YEARS_BACK }, (_, i) => {
          const start = new Date(now.getFullYear() - i - 1, now.getMonth(), now.getDate());
          const end = new Date(now.getFullYear() - i - 1, now.getMonth(), now.getDate() + 1);
          return `(created_ts >= timestamp(${seconds(start)}) && created_ts < timestamp(${seconds(end)}))`;
        }).join(" || "),
      ),
    enabled: Boolean(user && settings.space),
    staleTime: 60 * 60 * 1000,
  });

  const { streak, moods } = useMemo(() => {
    const days = new Set(recent.map((memo) => dayKey(entryDate(memo))));
    const day = new Date(now);
    if (!days.has(dayKey(day))) day.setDate(day.getDate() - 1);
    let count = 0;
    while (days.has(dayKey(day))) {
      count++;
      day.setDate(day.getDate() - 1);
    }
    const byDay = new Map<number, Mood>();
    for (const memo of recent) {
      const date = entryDate(memo);
      const mood = moodFromTags(memo.tags, settings.moodTagPrefix);
      if (mood && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) byDay.set(date.getDate(), mood);
    }
    return { streak: count, moods: byDay };
  }, [recent, now, settings.moodTagPrefix]);

  const firstWeekday = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(2026, 10, 1 + i)));
  }, []);

  if (!settings.space) return null;

  return (
    <div className="flex flex-col gap-4" data-journal-panel="">
      <div className="flex items-center gap-2.5">
        <FlameIcon className="mu-icon text-mu-warning" aria-hidden="true" />
        <span className="mu-label">{t("journal.streak", { count: streak })}</span>
      </div>

      <section aria-label={t("journal.on-this-day")} className="flex flex-col gap-1.5">
        <h3 className="mu-label">{t("journal.on-this-day")}</h3>
        {earlier.length === 0 ? (
          <p className="mu-caption text-mu-ink-muted">{t("journal.on-this-day-empty")}</p>
        ) : (
          earlier
            .sort((a, b) => entryDate(b).getTime() - entryDate(a).getTime())
            .slice(0, 5)
            .map((memo) => {
              const mood = moodFromTags(memo.tags, settings.moodTagPrefix);
              const years = now.getFullYear() - entryDate(memo).getFullYear();
              return (
                <Link
                  key={memo.name}
                  to={`/${memo.name}`}
                  className="mu-focus flex gap-2 rounded-mu-md p-1.5 hover:bg-mu-hover"
                  data-on-this-day=""
                >
                  {mood && <MoodFace mood={mood} size={18} />}
                  <span className="flex min-w-0 flex-col">
                    <span className="mu-caption text-mu-ink-muted">{t("journal.years-ago", { count: years })}</span>
                    <span className="mu-body line-clamp-2">{snippet(memo.content)}</span>
                  </span>
                </Link>
              );
            })
        )}
      </section>

      <section aria-label={t("journal.mood-month")} className="flex flex-col gap-1.5">
        <h3 className="mu-label">{t("journal.mood-month")}</h3>
        <div className="grid grid-cols-7 gap-1" role="presentation">
          {weekdays.map((weekday, i) => (
            <span key={`w${i}`} className="mu-caption text-center text-mu-ink-muted" aria-hidden="true">
              {weekday}
            </span>
          ))}
          {Array.from({ length: firstWeekday }, (_, i) => (
            <span key={`e${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const mood = moods.get(i + 1);
            return (
              <span
                key={i}
                title={mood ? `${i + 1}: ${t(`journal.mood.${mood}` as never)}` : String(i + 1)}
                className="mu-caption flex h-6 items-center justify-center rounded-mu-sm border border-mu-line"
                style={mood ? { background: moodColor(mood), color: mood === "awful" ? "#ffffff" : "#2b2418" } : undefined}
              >
                {i + 1}
              </span>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((mood) => (
            <span key={mood} className="mu-caption flex items-center gap-1 text-mu-ink-muted">
              <span className="size-2.5 rounded-sm border border-mu-line" style={{ background: moodColor(mood) }} aria-hidden="true" />
              {t(`journal.mood.${mood}` as never)}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
};
