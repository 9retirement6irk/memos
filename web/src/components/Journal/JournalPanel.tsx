import { useQuery } from "@tanstack/react-query";
import { FlameIcon } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { memoServiceClient } from "@/connect";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useJournalSettings } from "@/hooks/useJournalQueries";
import { mindFromTags, moodFromTags, type Valence, valenceFromScore, valenceScore } from "@/lib/journal/mood";
import type { JournalSettings } from "@/lib/journal/settings";
import { normalizePrefix } from "@/lib/journal/tags";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { MoodFace, moodColor, moodInk } from "./MoodFace";

/** How many years back On This Day looks. */
const YEARS_BACK = 5;

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** How many days the "how you've felt" line covers. */
const TREND_DAYS = 56;

/** Memos matching a CEL filter, at most 2000. */
const listEntries = async (filter: string): Promise<Memo[]> => {
  const memos: Memo[] = [];
  let pageToken = "";
  do {
    const response = await memoServiceClient.listMemos({ pageSize: 500, pageToken, filter });
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

/** A day's moods: the day's own mood, and the right-now check-ins made in it. */
export interface DayMoods {
  today?: Valence;
  now: number[];
}

/** The day's mood if one was given; otherwise what the check-ins average to. */
export const dayScore = (day: DayMoods | undefined): number | undefined => {
  if (!day) return undefined;
  if (day.today) return valenceScore(day.today);
  return day.now.length ? day.now.reduce((sum, score) => sum + score, 0) / day.now.length : undefined;
};

/** Each day's moods, oldest memo first so the latest day's mood wins. */
export const moodsByDay = (memos: Memo[], prefixes: Parameters<typeof mindFromTags>[1]): Map<string, DayMoods> => {
  const days = new Map<string, DayMoods>();
  for (const memo of [...memos].sort((a, b) => entryDate(a).getTime() - entryDate(b).getTime())) {
    const mind = mindFromTags(memo.tags, prefixes);
    if (!mind.valence) continue;
    const key = dayKey(entryDate(memo));
    const day = days.get(key) ?? { now: [] };
    if (mind.kind === "now") day.now.push(valenceScore(mind.valence));
    else day.today = mind.valence;
    days.set(key, day);
  }
  return days;
};

export interface Influence {
  /** Like "impact:work" or "activity:family". */
  key: string;
  label: string;
  score: number;
  count: number;
}

/** How pleasant the moods were when each cause or activity was tagged, from at least two memos. */
export const influences = (memos: Memo[], settings: JournalSettings, label: (kind: "impact" | "activity", id: string) => string) => {
  const totals = new Map<string, { label: string; sum: number; count: number }>();
  const add = (key: string, text: string, score: number) => {
    const total = totals.get(key) ?? { label: text, sum: 0, count: 0 };
    total.sum += score;
    total.count += 1;
    totals.set(key, total);
  };
  const activityPrefix = normalizePrefix(settings.activityTagPrefix).toLowerCase();
  for (const memo of memos) {
    const mind = mindFromTags(memo.tags, settings);
    if (!mind.valence) continue;
    const score = valenceScore(mind.valence);
    for (const id of mind.impacts) add(`impact:${id}`, label("impact", id), score);
    if (!activityPrefix) continue;
    for (const tag of memo.tags) {
      if (!tag.toLowerCase().startsWith(activityPrefix)) continue;
      const id = tag.slice(activityPrefix.length).toLowerCase();
      if (id) add(`activity:${id}`, label("activity", id), score);
    }
  }
  const all: Influence[] = [...totals.entries()]
    .filter(([, total]) => total.count >= 2)
    .map(([key, total]) => ({ key, label: total.label, score: total.sum / total.count, count: total.count }));
  return {
    best: all
      .filter((item) => item.score > 0.2)
      .sort((a, b) => b.score - a.score || b.count - a.count)
      .slice(0, 3),
    worst: all
      .filter((item) => item.score < -0.2)
      .sort((a, b) => a.score - b.score || b.count - a.count)
      .slice(0, 3),
  };
};

/** A line of the daily moods over the last weeks, neutral in the middle. */
const MoodTrend = ({ days, now, label }: { days: Map<string, DayMoods>; now: Date; label: string }) => {
  const width = 280;
  const height = 72;
  const points: { x: number; y: number; valence: Valence; date: Date }[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const score = dayScore(days.get(dayKey(date)));
    if (score === undefined) continue;
    points.push({
      x: ((TREND_DAYS - 1 - i) / (TREND_DAYS - 1)) * (width - 8) + 4,
      y: height / 2 - score * (height / 2 - 6),
      valence: valenceFromScore(score),
      date,
    });
  }
  if (points.length < 2) return null;
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-18 w-full" role="img" aria-label={label} data-mood-trend="">
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="stroke-mu-line" strokeDasharray="3 3" />
      <polyline
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        className="stroke-mu-ink-muted"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {points.map((p) => (
        <circle key={p.date.getTime()} cx={p.x} cy={p.y} r="3" fill={moodColor(p.valence)} className="stroke-mu-surface" strokeWidth="1">
          <title>{format.format(p.date)}</title>
        </circle>
      ))}
    </svg>
  );
};

/**
 * Beside the journal Space: the writing streak, entries from this day in earlier years, the
 * month's moods, how the days have felt lately and what tends to come with good and hard days.
 * All of it is read from memos' dates and tags: journal entries, and check-ins in any Space.
 */
export const JournalPanel = () => {
  const t = useTranslate();
  const user = useCurrentUser();
  const { settings } = useJournalSettings();
  const now = useMemo(() => new Date(), []);
  const moodPrefix = normalizePrefix(settings.moodTagPrefix);
  const inSpaceOrMood = moodPrefix
    ? `(space == "${settings.space}" || tags.exists(t, t.startsWith("${moodPrefix}")))`
    : `space == "${settings.space}"`;

  const { data: recent = [] } = useQuery({
    queryKey: ["journal", "panel", "recent", user?.name ?? "", settings.space, moodPrefix, dayKey(now)],
    queryFn: () =>
      listEntries(`${inSpaceOrMood} && created_ts >= timestamp(${seconds(new Date(now.getFullYear(), now.getMonth() - 13, 1))})`),
    enabled: Boolean(user && settings.space),
    staleTime: 60 * 1000,
  });

  const { data: earlier = [] } = useQuery({
    queryKey: ["journal", "panel", "on-this-day", user?.name ?? "", settings.space, dayKey(now)],
    queryFn: () =>
      listEntries(
        `space == "${settings.space}" && (${Array.from({ length: YEARS_BACK }, (_, i) => {
          const start = new Date(now.getFullYear() - i - 1, now.getMonth(), now.getDate());
          const end = new Date(now.getFullYear() - i - 1, now.getMonth(), now.getDate() + 1);
          return `(created_ts >= timestamp(${seconds(start)}) && created_ts < timestamp(${seconds(end)}))`;
        }).join(" || ")})`,
      ),
    enabled: Boolean(user && settings.space),
    staleTime: 60 * 60 * 1000,
  });

  const { streak, days, best, worst } = useMemo(() => {
    // The streak counts journal entries; check-ins elsewhere don't keep it.
    const written = new Set(recent.filter((memo) => memo.space === settings.space).map((memo) => dayKey(entryDate(memo))));
    const day = new Date(now);
    if (!written.has(dayKey(day))) day.setDate(day.getDate() - 1);
    let count = 0;
    while (written.has(dayKey(day))) {
      count++;
      day.setDate(day.getDate() - 1);
    }
    const label = (kind: "impact" | "activity", id: string) =>
      kind === "impact" ? t(`journal.impact.${id}` as never) : (settings.activities.find((activity) => activity.id === id)?.label ?? id);
    return { streak: count, days: moodsByDay(recent, settings), ...influences(recent, settings, label) };
  }, [recent, now, settings, t]);

  const firstWeekday = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(2026, 10, 1 + i)));
  }, []);

  if (!settings.space) return null;

  const influenceList = (title: string, items: Influence[], kind: string) =>
    items.length > 0 && (
      <section aria-label={title} className="flex flex-col gap-1" data-mood-influences={kind}>
        <h3 className="mu-label">{title}</h3>
        {items.map((item) => (
          <span key={item.key} className="mu-body flex items-center gap-2">
            <MoodFace valence={valenceFromScore(item.score)} size={16} />
            {item.label}
          </span>
        ))}
      </section>
    );

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
                  {mood && <MoodFace valence={mood} size={18} />}
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
            const day = days.get(dayKey(new Date(now.getFullYear(), now.getMonth(), i + 1)));
            const momentary = day?.now.length ? valenceFromScore(dayScore({ now: day.now }) ?? 0) : undefined;
            const title = [
              String(i + 1),
              day?.today && `${t("journal.kind.today")}: ${t(`journal.valence.${day.today}` as never)}`,
              momentary && `${t("journal.kind.now")}: ${t(`journal.valence.${momentary}` as never)}`,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <span
                key={i}
                title={title}
                data-day-mood={day?.today}
                className="mu-caption relative flex h-6 items-center justify-center rounded-mu-sm border border-mu-line"
                style={day?.today ? { background: moodColor(day.today), color: moodInk(day.today) } : undefined}
              >
                {i + 1}
                {momentary && (
                  <span
                    className="absolute top-0.5 right-0.5 size-1.5 rounded-full border border-mu-surface"
                    style={{ background: moodColor(momentary) }}
                    data-day-check-in={momentary}
                    aria-hidden="true"
                  />
                )}
              </span>
            );
          })}
        </div>
        <div className="mu-caption flex items-center gap-2 text-mu-ink-muted">
          <span>{t("journal.valence.unpleasant")}</span>
          <span
            className="h-2 flex-1 rounded-full border border-mu-line"
            style={{
              background: `linear-gradient(to right, ${["very-unpleasant", "neutral", "very-pleasant"].map((v) => moodColor(v as Valence)).join(", ")})`,
            }}
            aria-hidden="true"
          />
          <span>{t("journal.valence.pleasant")}</span>
        </div>
        <span className="mu-caption flex items-center gap-1.5 text-mu-ink-muted">
          <span className="size-1.5 rounded-full bg-mu-ink-muted" aria-hidden="true" />
          {t("journal.mood-check-ins")}
        </span>
      </section>

      {days.size > 1 && (
        <section aria-label={t("journal.mood-trend")} className="flex flex-col gap-1.5">
          <h3 className="mu-label">{t("journal.mood-trend")}</h3>
          <MoodTrend days={days} now={now} label={t("journal.mood-trend-description")} />
        </section>
      )}

      {influenceList(t("journal.best-with"), best, "best")}
      {influenceList(t("journal.worst-with"), worst, "worst")}
    </div>
  );
};
