import { KIDPIX_SOUND_SPRITE, KIDPIX_TOOL_SOUNDS } from "./data";

interface PlayOptions {
  loop?: boolean;
  volume?: number;
}

/**
 * Plays Kid Pix clips out of one audio sprite. The sprite loads once, on the first Kid Pix
 * session; until it has, and while muted, every call is a quiet no-op.
 */
export class KidPixAudio {
  muted = false;
  /** Settles once the sprite has loaded, or failed to. */
  readonly ready: Promise<void>;
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private master: GainNode | null = null;
  /** Sounds outside the sprite, fetched when first wanted: the moving paint's, a file per set. */
  private readonly extras = new Map<string, AudioBuffer | null>();
  private loop: AudioBufferSourceNode | null = null;
  private stopClip: string | null = null;
  private effectClip: string | null = null;
  private effectAt = 0;

  constructor(url: string) {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) {
      this.ready = Promise.resolve();
      return;
    }
    try {
      // The clips are 22.05 kHz; decoding at that rate halves the memory the sprite takes.
      this.context = new AudioContextClass({ sampleRate: 22050 });
    } catch {
      this.context = new AudioContextClass();
    }
    this.master = this.context.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.context.destination);
    const context = this.context;
    this.ready = fetch(url)
      .then((response) => response.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => {
        this.buffer = buffer;
      })
      // No sound is not worth a message: the tools all work without it.
      .catch(() => undefined);
  }

  /** Browsers start audio suspended until a gesture; call from one. */
  wake() {
    if (this.context?.state === "suspended") this.context.resume().catch(() => undefined);
  }

  /** Length of a clip in seconds, or 0 when the sprite has no such clip. */
  duration(clip: string) {
    return KIDPIX_SOUND_SPRITE[clip]?.[1] ?? 0;
  }

  play(clip: string, { loop = false, volume = 1 }: PlayOptions = {}): AudioBufferSourceNode | null {
    const entry = KIDPIX_SOUND_SPRITE[clip];
    if (this.muted || !this.context || !this.buffer || !this.master || !entry) return null;
    const [offset, length] = entry;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.master);
    if (loop) {
      source.loop = true;
      source.loopStart = offset + 0.05;
      source.loopEnd = offset + length;
      source.start(0, offset + 0.05);
    } else {
      source.start(0, offset, length + 0.1);
    }
    return source;
  }

  /** Fetches a sound file of its own, to play parts of with `playFrom`. Asking again is free. */
  load(url: string) {
    const context = this.context;
    if (!context || this.extras.has(url)) return;
    this.extras.set(url, null);
    fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => this.extras.set(url, buffer))
      // As with the sprite: silence, not a message.
      .catch(() => undefined);
  }

  /** Plays `length` seconds from `offset` of a file fetched with `load`, once it has arrived. */
  playFrom(url: string, offset: number, length: number, volume = 1) {
    const buffer = this.extras.get(url);
    if (this.muted || !this.context || !this.master || !buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.master);
    source.start(0, offset, length);
  }

  /**
   * A tool goes down on the paper: its start clip plays, its loop runs until `toolUp`, and its
   * effect clip repeats while the pointer moves, as KP.cfg lays them out per tool.
   */
  toolDown(toolNumber: number) {
    this.silenceLoop();
    const sounds = KIDPIX_TOOL_SOUNDS[toolNumber];
    this.effectClip = null;
    this.stopClip = null;
    if (!sounds) return;
    const [start, stop, loop, effect] = sounds;
    if (start) this.play(`w${start}`);
    if (loop) this.loop = this.play(`w${loop}`, { loop: true, volume: 0.7 });
    if (effect) {
      this.effectClip = `w${effect}`;
      this.effectAt = performance.now();
      this.play(this.effectClip);
    }
    this.stopClip = stop ? `w${stop}` : null;
  }

  toolMove() {
    if (!this.effectClip) return;
    const now = performance.now();
    if (now - this.effectAt < this.duration(this.effectClip) * 1000) return;
    this.effectAt = now;
    this.play(this.effectClip);
  }

  toolUp() {
    this.silenceLoop();
    this.effectClip = null;
    if (this.stopClip) this.play(this.stopClip);
    this.stopClip = null;
  }

  /** One-shot tools (the Paint Can, a mixer, a stamp) only play their start. */
  toolOnce(toolNumber: number) {
    this.toolDown(toolNumber);
    this.silenceLoop();
    this.effectClip = null;
    this.stopClip = null;
  }

  silenceLoop() {
    try {
      this.loop?.stop();
    } catch {
      // Already stopped.
    }
    this.loop = null;
  }

  dispose() {
    this.silenceLoop();
    this.context?.close().catch(() => undefined);
    this.context = null;
    this.buffer = null;
    this.extras.clear();
  }
}
