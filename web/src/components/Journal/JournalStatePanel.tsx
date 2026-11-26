import {
  BathIcon,
  BriefcaseIcon,
  CloudSunIcon,
  DumbbellIcon,
  FingerprintIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  HeartIcon,
  HeartPulseIcon,
  HouseIcon,
  LandmarkIcon,
  ListChecksIcon,
  type LucideIcon,
  NewspaperIcon,
  PaletteIcon,
  PlaneIcon,
  SparklesIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { type Impact, VALENCES } from "@/lib/journal/mood";
import type { JournalState } from "@/lib/journal/state";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { ActivityIconView } from "./ActivityIconView";
import { MoodFace, moodColor } from "./MoodFace";

/** An icon for each thing a feeling can be because of. Lucide icons, so Aero draws Vista pictures. */
export const IMPACT_ICONS: Record<Impact, LucideIcon> = {
  community: LandmarkIcon,
  "current-events": NewspaperIcon,
  dating: HeartHandshakeIcon,
  education: GraduationCapIcon,
  family: HouseIcon,
  fitness: DumbbellIcon,
  friends: UsersIcon,
  health: HeartPulseIcon,
  hobbies: PaletteIcon,
  identity: FingerprintIcon,
  money: WalletIcon,
  partner: HeartIcon,
  "self-care": BathIcon,
  spirituality: SparklesIcon,
  tasks: ListChecksIcon,
  travel: PlaneIcon,
  weather: CloudSunIcon,
  work: BriefcaseIcon,
};

interface Props {
  state: JournalState;
  /** Filters by the tag an item stands for. Without it the items are plain text. */
  onTagClick?: (tag: string) => void;
  className?: string;
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div data-journal-state-section="" className="flex flex-col gap-1">
    <span className="mu-caption font-medium text-mu-text-secondary">{title}</span>
    <div className="flex flex-wrap gap-1.5">{children}</div>
  </div>
);

/**
 * The state of mind panel at the foot of a journal entry: the mood on its seven-step scale, the
 * feelings, what they were because of, and what the day held. It draws the memo's journal tags,
 * which stay in the memo as written; each item filters by its tag.
 */
export const JournalStatePanel = ({ state, onTagClick, className }: Props) => {
  const t = useTranslate();
  const { mind, moodTag, feelings, impacts, activities } = state;
  const item = (tag: string, title: string, content: ReactNode, itemClass: string) =>
    onTagClick ? (
      <button
        type="button"
        className={cn("mu-focus cursor-pointer", itemClass)}
        title={`#${tag}`}
        aria-label={title}
        onClick={(event) => {
          event.stopPropagation();
          onTagClick(tag);
        }}
      >
        {content}
      </button>
    ) : (
      <span className={itemClass} title={`#${tag}`}>
        {content}
      </span>
    );

  const valence = mind.valence;
  const valenceLabel = valence ? t(`journal.valence.${valence}` as never) : "";
  const kindLabel = t(`journal.kind.${mind.kind ?? "today"}` as never);
  const chip = "rounded-mu-sm border border-mu-line px-1.5 py-0.5 mu-caption hover:bg-mu-hover";

  return (
    <section
      data-slot="journal-state"
      aria-label={t("journal.state.label")}
      className={cn("w-full flex flex-col gap-2.5 rounded-mu-md border border-mu-line bg-mu-well p-2.5", className)}
    >
      {valence && (
        <div data-journal-state-section="mood" className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <MoodFace valence={valence} size={22} />
            <span className="mu-caption font-medium text-mu-text-secondary">{kindLabel}</span>
            {moodTag ? (
              item(moodTag, `${kindLabel}: ${valenceLabel}`, valenceLabel, "ml-auto mu-label rounded-mu-sm px-1 hover:bg-mu-hover")
            ) : (
              <span className="ml-auto mu-label">{valenceLabel}</span>
            )}
          </div>
          <div data-journal-scale="" className="flex gap-0.5" aria-hidden="true">
            {VALENCES.map((step) => (
              <span
                key={step}
                data-step={step}
                data-chosen={step === valence ? "" : undefined}
                className={cn(
                  "h-2 flex-1 first:rounded-l-full last:rounded-r-full",
                  step === valence ? "ring-2 ring-mu-text" : "opacity-45",
                )}
                style={{ backgroundColor: moodColor(step) }}
              />
            ))}
          </div>
        </div>
      )}
      {feelings.length > 0 && (
        <Section title={t("journal.state.feelings")}>
          {feelings.map(({ id, tag }) => {
            const label = t(`journal.feeling.${id}` as never);
            return <span key={id}>{item(tag, label, label, cn(chip, "italic"))}</span>;
          })}
        </Section>
      )}
      {impacts.length > 0 && (
        <Section title={t("journal.state.impacts")}>
          {impacts.map(({ id, tag }) => {
            const label = t(`journal.impact.${id}` as never);
            const Icon = IMPACT_ICONS[id as Impact] ?? SparklesIcon;
            return (
              <span key={id}>
                {item(
                  tag,
                  label,
                  <>
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    {label}
                  </>,
                  cn(chip, "inline-flex items-center gap-1"),
                )}
              </span>
            );
          })}
        </Section>
      )}
      {activities.length > 0 && (
        <Section title={t("journal.state.activities")}>
          {activities.map(({ id, tag, label, icon }) => (
            <span key={id}>
              {item(
                tag,
                label,
                <>
                  <span
                    data-journal-tile=""
                    className="flex size-9 items-center justify-center rounded-mu-md border border-mu-line bg-mu-surface"
                  >
                    <ActivityIconView icon={icon} className="size-5" />
                  </span>
                  <span className="mu-caption max-w-14 truncate">{label}</span>
                </>,
                "flex w-14 flex-col items-center gap-0.5 rounded-mu-sm p-0.5 hover:bg-mu-hover",
              )}
            </span>
          ))}
        </Section>
      )}
    </section>
  );
};
