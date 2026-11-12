import { useId } from "react";
import type { Mood } from "@/lib/journal/entry";

/** The face for each mood. The colors also differ in lightness, so they read without color vision. */
const FACES: Record<Mood, { color: string; light: string; edge: string; ink: string; mouth: string }> = {
  awful: { color: "#2b4f8f", light: "#7aa0dc", edge: "#1a3060", ink: "#ffffff", mouth: "M13 29 Q20 22 27 29" },
  bad: { color: "#6c9ad8", light: "#cfe2fa", edge: "#3d6aa8", ink: "#1a2a40", mouth: "M13 28 Q20 24.5 27 28" },
  okay: { color: "#cfc4a8", light: "#fbf6e6", edge: "#8a7a58", ink: "#2b2418", mouth: "M13 27 L27 27" },
  good: { color: "#f2b45a", light: "#fff0c8", edge: "#a86a18", ink: "#3d2400", mouth: "M13 25 Q20 30.5 27 25" },
  great: { color: "#d9731f", light: "#ffd09a", edge: "#7a3a08", ink: "#2a1200", mouth: "M12 24 Q20 33 28 24" },
};

export const moodColor = (mood: Mood) => FACES[mood].color;

/** A glossy face for a mood. Decorative unless given a label. */
export const MoodFace = ({ mood, size = 32, label }: { mood: Mood; size?: number; label?: string }) => {
  const id = useId();
  const face = FACES[mood];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
      className="shrink-0"
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
      <path d={face.mouth} fill="none" stroke={face.ink} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
};
