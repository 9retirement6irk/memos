import { useId } from "react";
import { type Valence, valenceScore } from "@/lib/journal/mood";

/**
 * The face for each step, from deep indigo to deep orange. Neighbouring steps also differ in
 * lightness and the mouth bends further at each step, so the faces read without colour vision.
 */
const FACES: Record<Valence, { color: string; light: string; edge: string; ink: string }> = {
  "very-unpleasant": { color: "#363a8a", light: "#8a90dc", edge: "#20235a", ink: "#ffffff" },
  unpleasant: { color: "#5468c0", light: "#bcc6f4", edge: "#303d88", ink: "#ffffff" },
  "slightly-unpleasant": { color: "#9cb0de", light: "#e4ebfa", edge: "#58699c", ink: "#1a2440" },
  neutral: { color: "#cfc4a8", light: "#fbf6e6", edge: "#8a7a58", ink: "#2b2418" },
  "slightly-pleasant": { color: "#f4d27e", light: "#fff5d6", edge: "#a8821e", ink: "#3d2a00" },
  pleasant: { color: "#f2a44a", light: "#ffe0b0", edge: "#a85e18", ink: "#3d2000" },
  "very-pleasant": { color: "#d9621c", light: "#ffc48c", edge: "#7a3006", ink: "#2a1000" },
};

export const moodColor = (valence: Valence) => FACES[valence].color;
/** Text that reads on a step's colour. */
export const moodInk = (valence: Valence) => FACES[valence].ink;

/** A glossy face for a step of the scale. Decorative unless given a label. */
export const MoodFace = ({ valence, size = 32, label }: { valence: Valence; size?: number; label?: string }) => {
  const id = useId();
  const face = FACES[valence];
  const score = valenceScore(valence);
  // The corners rise and the middle drops as the feeling gets more pleasant.
  const corner = 27 - 2.2 * score;
  const middle = 27 + 6.5 * score;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      className="shrink-0"
      data-valence={valence}
    >
      <defs>
        <radialGradient id={id} cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor={face.light} />
          <stop offset="100%" stopColor={face.color} />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="17" fill={`url(#${id})`} stroke={face.edge} strokeWidth="1.2" />
      <ellipse cx="20" cy="11" rx="11" ry="6" fill="#ffffff" opacity="0.45" />
      <circle cx="14" cy="18" r="2" fill={face.ink} />
      <circle cx="26" cy="18" r="2" fill={face.ink} />
      <path d={`M13 ${corner} Q20 ${middle} 27 ${corner}`} fill="none" stroke={face.ink} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
};
