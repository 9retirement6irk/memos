import { Button } from "@usememos/ui";
import { useId, useState } from "react";
import {
  FEELING_KINDS,
  type FeelingKind,
  feelingsNear,
  IMPACTS,
  type StateOfMind,
  SUGGESTED_FEELINGS,
  VALENCES,
  type Valence,
} from "@/lib/journal/mood";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { MoodFace, moodColor } from "./MoodFace";

const NEUTRAL_INDEX = 3;
const TRACK = `linear-gradient(to right, ${VALENCES.map(moodColor).join(", ")})`;

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

interface Props {
  value: StateOfMind;
  onChange: (next: StateOfMind) => void;
  /** The kind shown until the user picks one: the day for a journal entry, right now for a check-in. */
  defaultKind: FeelingKind;
  /** Causes the user chose not to be offered. */
  hiddenImpacts?: string[];
}

/**
 * Apple Health's State of Mind, step by step: the day or right now, how pleasant on a
 * seven-step slider, then words for the feeling and what's behind it, both optional.
 */
export const StateOfMindPicker = ({ value, onChange, defaultKind, hiddenImpacts = [] }: Props) => {
  const t = useTranslate();
  const sliderId = useId();
  const [showAllFeelings, setShowAllFeelings] = useState(false);
  const kind = value.kind ?? defaultKind;
  const index = value.valence ? VALENCES.indexOf(value.valence) : NEUTRAL_INDEX;
  const update = (patch: Partial<StateOfMind>) => onChange({ ...value, ...patch });
  const choose = (valence: Valence) => update({ valence });

  const nearest = feelingsNear(value.valence);
  // The chosen words always stay in view, even when they're far from the step.
  const shownFeelings = showAllFeelings
    ? [...nearest].sort((a, b) => t(`journal.feeling.${a}` as never).localeCompare(t(`journal.feeling.${b}` as never)))
    : [...new Set([...nearest.slice(0, SUGGESTED_FEELINGS), ...value.feelings])];
  const impacts = IMPACTS.filter((id) => !hiddenImpacts.includes(id) || value.impacts.includes(id));

  return (
    <div className="flex w-full flex-col gap-3" data-state-of-mind="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={sliderId} className="mu-label">
          {t(`journal.mind.question-${kind}` as never)}
        </label>
        <div className="flex gap-1" role="group" aria-label={t("journal.mind.kind")}>
          {FEELING_KINDS.map((option) => (
            <Button
              key={option}
              size="xs"
              variant={option === kind ? "primary" : "ghost"}
              aria-pressed={option === kind}
              onClick={() => update({ kind: option })}
            >
              {t(`journal.kind.${option}` as never)}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className={cn("transition-opacity", !value.valence && "opacity-40")}>
          <MoodFace valence={value.valence ?? "neutral"} size={52} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className={cn("mu-body font-medium", !value.valence && "text-mu-ink-muted")} aria-live="polite">
              {value.valence ? t(`journal.valence.${value.valence}` as never) : t("journal.mind.unset")}
            </span>
            {value.valence && (
              <Button variant="ghost" size="xs" onClick={() => onChange({ ...value, valence: undefined, feelings: [], impacts: [] })}>
                {t("common.clear")}
              </Button>
            )}
          </div>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={VALENCES.length - 1}
            step={1}
            value={index}
            aria-valuetext={value.valence ? t(`journal.valence.${value.valence}` as never) : t("journal.mind.unset")}
            // A click on the middle without moving still chooses Neutral.
            onClick={(event) => choose(VALENCES[Number(event.currentTarget.value)])}
            onChange={(event) => choose(VALENCES[Number(event.target.value)])}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") choose(VALENCES[Number(event.currentTarget.value)]);
            }}
            data-mind-slider=""
            className={cn(
              "mu-focus h-2 w-full cursor-pointer appearance-none rounded-full",
              "[&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-(--thumb) [&::-webkit-slider-thumb]:shadow",
              "[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-(--thumb)",
              !value.valence && "opacity-70",
            )}
            style={{ background: TRACK, "--thumb": value.valence ? moodColor(value.valence) : "#ffffff" } as React.CSSProperties}
          />
          <div className="mu-caption flex justify-between text-mu-ink-muted" aria-hidden="true">
            <span>{t("journal.valence.very-unpleasant")}</span>
            <span>{t("journal.valence.very-pleasant")}</span>
          </div>
        </div>
      </div>

      {value.valence && (
        <fieldset className="flex flex-col gap-1.5" data-mind-feelings="">
          <legend className="mu-label mb-1.5">{t("journal.mind.feelings")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {shownFeelings.map((id) => {
              const on = value.feelings.includes(id);
              return (
                <Button
                  key={id}
                  size="xs"
                  variant={on ? "primary" : "neutral"}
                  aria-pressed={on}
                  onClick={() => update({ feelings: toggle(value.feelings, id) })}
                >
                  {t(`journal.feeling.${id}` as never)}
                </Button>
              );
            })}
            <Button size="xs" variant="ghost" onClick={() => setShowAllFeelings(!showAllFeelings)}>
              {showAllFeelings ? t("journal.mind.feelings-fewer") : t("journal.mind.feelings-all")}
            </Button>
          </div>
        </fieldset>
      )}

      {value.valence && impacts.length > 0 && (
        <fieldset className="flex flex-col gap-1.5" data-mind-impacts="">
          <legend className="mu-label mb-1.5">{t("journal.mind.impacts")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {impacts.map((id) => {
              const on = value.impacts.includes(id);
              return (
                <Button
                  key={id}
                  size="xs"
                  variant={on ? "primary" : "neutral"}
                  aria-pressed={on}
                  onClick={() => update({ impacts: toggle(value.impacts, id) })}
                >
                  {t(`journal.impact.${id}` as never)}
                </Button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
};
