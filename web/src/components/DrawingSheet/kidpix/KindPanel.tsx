import { useEffect, useRef, useState } from "react";
import brushArt from "./assets/kinds-brush.png";
import brushMask from "./assets/kinds-brush-mask.png";
import brushPanel from "./assets/kinds-brush-panel.png";
import bucketArt from "./assets/kinds-bucket.png";
import bucketMask from "./assets/kinds-bucket-mask.png";
import bucketPanel from "./assets/kinds-bucket-panel.png";
import pencilArt from "./assets/kinds-pencil.png";
import pencilMask from "./assets/kinds-pencil-mask.png";
import pencilPanel from "./assets/kinds-pencil-panel.png";
import { KIDPIX_KINDS } from "./kinds";

export type KindArt = keyof typeof KIDPIX_KINDS;

const SHEETS: Record<KindArt, { art: string; mask: string; panel: string }> = {
  pencil: { art: pencilArt, mask: pencilMask, panel: pencilPanel },
  brush: { art: brushArt, mask: brushMask, panel: brushPanel },
  bucket: { art: bucketArt, mask: bucketMask, panel: bucketPanel },
};

/** Kid Pix steps its tray animations about nine times a second. */
const STEP_MS = 110;

const last = (cells: readonly number[]) => cells[cells.length - 1];

interface KindPanelProps {
  art: KindArt;
  /** The group's name, and each kind's, in the tray's order. */
  label: string;
  names: readonly string[];
  selected: number;
  /** The color in hand: the kinds' bodies and tips take it. */
  color: string;
  onSelect: (index: number) => void;
  play: (clip: string) => void;
}

/**
 * A tool's kinds in the tray's molded panel, moving as Kid Pix moves them: each lies in its
 * mold, wiggles when pointed at, and is picked up when chosen while the one before it is laid
 * back down. The frames and their order are the disc's button scripts (`kinds.ts`).
 */
const KindPanel = ({ art, label, names, selected, color, onSelect, play }: KindPanelProps) => {
  const group = KIDPIX_KINDS[art];
  const sheets = SHEETS[art];
  // The cell each kind shows: the one in hand held up, the rest in their molds.
  const [cells, setCells] = useState(() => group.kinds.map((kind, index) => last(index === selected ? kind.pickUp : kind.putDown)));
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const timer of running.values()) window.clearInterval(timer);
      running.clear();
    };
  }, []);

  /** Plays one of a kind's scripts, a cell a step, then calls `done`. */
  const run = (index: number, script: readonly number[], clip: string, done?: () => void) => {
    window.clearInterval(timers.current.get(index));
    play(clip);
    let step = 0;
    const show = () => setCells((previous) => previous.map((cell, kind) => (kind === index ? script[step] : cell)));
    show();
    const timer = window.setInterval(() => {
      step++;
      if (step >= script.length) {
        window.clearInterval(timer);
        timers.current.delete(index);
        done?.();
        return;
      }
      show();
    }, STEP_MS);
    timers.current.set(index, timer);
  };

  const choose = (index: number) => {
    if (index === selected) return;
    const before = selected;
    onSelect(index);
    const kind = group.kinds[index];
    // The new one comes up first; only then does the old one go back to its mold.
    run(index, kind.pickUp, kind.sounds[1], () => {
      const old = group.kinds[before];
      run(before, old.putDown, old.sounds[0]);
    });
  };

  const wiggle = (index: number) => {
    if (index === selected || timers.current.has(index)) return;
    const kind = group.kinds[index];
    run(index, kind.wiggle, kind.sounds[2]);
  };

  return (
    <div
      role="group"
      aria-label={label}
      className="kidpix-kinds"
      style={{ width: group.panel[0], height: group.panel[1], backgroundImage: `url(${sheets.panel})` }}
    >
      {group.kinds.map((kind, index) => {
        const [sx, sy, width, height, x, y] = group.cells[cells[index]];
        // The button stays where the kind rests, however far its animation swings.
        const [, , restWidth, restHeight, restX, restY] = group.cells[last(kind.putDown)];
        const position = `-${sx}px -${sy}px`;
        return (
          <button
            key={names[index]}
            type="button"
            className="kidpix-kind mu-focus"
            aria-label={names[index]}
            aria-pressed={selected === index}
            title={names[index]}
            style={{ left: restX, top: restY, width: restWidth, height: restHeight }}
            onClick={() => choose(index)}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") wiggle(index);
            }}
          >
            <span aria-hidden className="kidpix-kind-art" style={{ left: x - restX, top: y - restY, width, height }}>
              <span
                style={{
                  background: color,
                  maskImage: `url(${sheets.mask})`,
                  WebkitMaskImage: `url(${sheets.mask})`,
                  maskPosition: position,
                  WebkitMaskPosition: position,
                }}
              />
              <span style={{ backgroundImage: `url(${sheets.art})`, backgroundPosition: position }} />
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default KindPanel;
