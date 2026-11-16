import { useEffect, useRef, useState } from "react";
import { KIDPIX_IDEAS } from "./ideas";

/** A thumbnail in a folder's strip: 96 x 72, as the disc holds them. */
const THUMB = [96, 72] as const;

interface IdeaMachineProps {
  /** Where the mode's library files are served from. */
  libraryUrl: string;
  labels: { title: string; close: string };
  play: (clip: string) => void;
  /** A picture starter was chosen: its file. */
  onPick: (url: string) => void;
  onClose: () => void;
}

/**
 * Kid Pix's Idea Machine: 572 picture starters (cards, masks, maps, calendars, story pages) in
 * 52 folders under nine topics. One is chosen from its folder's thumbnails and becomes the
 * picture's background, to be painted on. A folder's files are fetched when it is opened.
 */
const IdeaMachine = ({ libraryUrl, labels, play, onPick, onClose }: IdeaMachineProps) => {
  const [folder, setFolder] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const topics = [...new Set(KIDPIX_IDEAS.map((idea) => idea.topic))];
  const open = KIDPIX_IDEAS[folder];

  useEffect(() => rootRef.current?.focus(), []);

  return (
    <div className="kidpix-stamp-editor-veil">
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        tabIndex={-1}
        className="kidpix-ideas"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Escape closes the Idea Machine, not the sheet.
          event.stopPropagation();
          event.nativeEvent.stopPropagation();
          onClose();
        }}
      >
        <header>
          <strong>{labels.title}</strong>
          <select
            className="mu-focus"
            aria-label={labels.title}
            value={folder}
            onChange={(event) => {
              setFolder(Number(event.target.value));
              play("easel1029");
            }}
          >
            {topics.map((topic) => (
              <optgroup key={topic} label={topic}>
                {KIDPIX_IDEAS.map((idea, index) =>
                  idea.topic === topic ? (
                    <option key={idea.slug} value={index}>
                      {idea.name}
                    </option>
                  ) : null,
                )}
              </optgroup>
            ))}
          </select>
          <button type="button" className="mu-focus" onClick={onClose}>
            {labels.close}
          </button>
        </header>
        <div role="group" aria-label={open.name}>
          {open.items.map((name, index) => (
            <button
              key={name}
              type="button"
              className="mu-focus"
              title={name}
              onClick={() => onPick(`${libraryUrl}ideas/${open.slug}/${index}.jpg`)}
            >
              <span
                aria-hidden
                style={{
                  width: THUMB[0],
                  height: THUMB[1],
                  backgroundImage: `url("${libraryUrl}ideas/${open.slug}.jpg")`,
                  backgroundPosition: `-${index * THUMB[0]}px 0`,
                }}
              />
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default IdeaMachine;
