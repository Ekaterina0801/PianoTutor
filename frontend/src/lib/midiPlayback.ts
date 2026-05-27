import type { NoteEvent } from "@/lib/types";

export type PlaybackTrack = "expected" | "performed" | "both";

export type MidiPlaybackOptions = {
  expected?: NoteEvent[];
  performed?: NoteEvent[];
  track?: PlaybackTrack;
  startAt?: number;
  duration?: number;
  volume?: number;
};

export type MidiPlaybackController = {
  stop: () => void;
};

export type MidiLiveSynth = {
  noteOn: (midiNote: number, velocity?: number) => Promise<void>;
  noteOff: (midiNote: number) => void;
  allNotesOff: () => void;
  dispose: () => void;
};

type WebAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let sharedContext: AudioContext | null = null;

function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

function midiToHz(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function getAudioContext() {
  if (typeof window === "undefined") throw new Error("Web Audio is only available in the browser");
  const AudioContextCtor = window.AudioContext || (window as WebAudioWindow).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Web Audio API is not supported");
  if (!sharedContext || sharedContext.state === "closed") sharedContext = new AudioContextCtor();
  return sharedContext;
}

function maxOffset(notes: NoteEvent[]) {
  return notes.reduce((mx, n) => Math.max(mx, n.offset_s), 0);
}

function validNotes(notes: NoteEvent[]) {
  return notes.filter((n) => (
    Number.isFinite(n.onset_s) &&
    Number.isFinite(n.offset_s) &&
    Number.isFinite(n.midi_note) &&
    n.offset_s > n.onset_s
  ));
}

function scheduleNote({
  ctx,
  destination,
  note,
  now,
  startAt,
  endAt,
  pan,
  gainScale,
}: {
  ctx: AudioContext;
  destination: AudioNode;
  note: NoteEvent;
  now: number;
  startAt: number;
  endAt: number;
  pan: number;
  gainScale: number;
}) {
  if (note.offset_s <= startAt || note.onset_s >= endAt) return [];

  const noteStart = Math.max(note.onset_s, startAt);
  const noteEnd = Math.min(note.offset_s, endAt);
  const when = now + Math.max(0, noteStart - startAt);
  const offAt = when + Math.max(0.03, noteEnd - noteStart);
  const releaseS = 0.18;
  const velocity = clamp((note.velocity || 72) / 127, 0.08, 1);
  const peak = 0.18 * velocity * gainScale;
  const sustain = Math.max(0.0001, peak * 0.36);

  const noteGain = ctx.createGain();
  noteGain.gain.cancelScheduledValues(when);
  noteGain.gain.setValueAtTime(0.0001, when);
  noteGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + 0.012);
  noteGain.gain.setTargetAtTime(sustain, when + 0.018, 0.18);
  noteGain.gain.setTargetAtTime(0.0001, offAt, 0.045);

  let output: AudioNode = noteGain;
  if (typeof ctx.createStereoPanner === "function") {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(clamp(pan, -1, 1), now);
    noteGain.connect(panner);
    output = panner;
  }
  output.connect(destination);

  const hz = midiToHz(note.midi_note);
  const fundamental = ctx.createOscillator();
  fundamental.type = "triangle";
  fundamental.frequency.setValueAtTime(hz, when);

  const overtone = ctx.createOscillator();
  overtone.type = "sine";
  overtone.frequency.setValueAtTime(hz * 2.01, when);

  const overtoneGain = ctx.createGain();
  overtoneGain.gain.setValueAtTime(0.18, when);

  fundamental.connect(noteGain);
  overtone.connect(overtoneGain);
  overtoneGain.connect(noteGain);

  const stopAt = offAt + releaseS + 0.08;
  fundamental.start(when);
  overtone.start(when);
  fundamental.stop(stopAt);
  overtone.stop(stopAt);

  return [fundamental, overtone];
}

export async function startMidiPlayback({
  expected = [],
  performed = [],
  track = "expected",
  startAt = 0,
  duration,
  volume = 0.7,
}: MidiPlaybackOptions): Promise<MidiPlaybackController> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") await ctx.resume();

  const safeStart = Math.max(0, startAt);
  const expectedNotes = validNotes(expected);
  const performedNotes = validNotes(performed);
  const fallbackEnd = Math.max(maxOffset(expectedNotes), maxOffset(performedNotes), safeStart + 1);
  const endAt = Math.max(safeStart, duration ?? fallbackEnd);
  const now = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  const sources: OscillatorNode[] = [];
  let stopped = false;

  master.gain.setValueAtTime(clamp(volume, 0, 1), ctx.currentTime);
  master.connect(ctx.destination);

  const scheduleTrack = (notes: NoteEvent[], pan: number, gainScale: number) => {
    for (const note of notes) {
      sources.push(...scheduleNote({
        ctx,
        destination: master,
        note,
        now,
        startAt: safeStart,
        endAt,
        pan,
        gainScale,
      }));
    }
  };

  if (track === "expected") scheduleTrack(expectedNotes, 0, 1);
  if (track === "performed") scheduleTrack(performedNotes, 0, 1);
  if (track === "both") {
    scheduleTrack(expectedNotes, -0.22, 0.78);
    scheduleTrack(performedNotes, 0.22, 0.78);
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      const stopAt = ctx.currentTime + 0.035;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.015);
      for (const source of sources) {
        try {
          source.stop(stopAt);
        } catch {}
      }
      window.setTimeout(() => {
        try {
          master.disconnect();
        } catch {}
      }, 160);
    },
  };
}

export function createMidiLiveSynth({ volume = 0.55 }: { volume?: number } = {}): MidiLiveSynth {
  type ActiveNote = {
    gain: GainNode;
    sources: OscillatorNode[];
  };

  let master: GainNode | null = null;
  const active = new Map<number, ActiveNote>();
  const pending = new Map<number, number>();
  let pendingSeq = 0;

  const ensureMaster = (ctx: AudioContext) => {
    if (master) return master;
    master = ctx.createGain();
    master.gain.setValueAtTime(clamp(volume, 0, 1), ctx.currentTime);
    master.connect(ctx.destination);
    return master;
  };

  const releaseNote = (midiNote: number, releaseS = 0.08) => {
    const note = active.get(midiNote);
    if (!note) return;
    active.delete(midiNote);

    const ctx = sharedContext;
    if (!ctx || ctx.state === "closed") return;

    const now = ctx.currentTime;
    const stopAt = now + releaseS + 0.04;
    note.gain.gain.cancelScheduledValues(now);
    note.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.01, releaseS / 3));

    for (const source of note.sources) {
      try {
        source.stop(stopAt);
      } catch {}
    }

    window.setTimeout(() => {
      try {
        note.gain.disconnect();
      } catch {}
    }, Math.ceil((releaseS + 0.12) * 1000));
  };

  return {
    async noteOn(midiNote: number, velocity = 96) {
      if (active.has(midiNote) || pending.has(midiNote)) return;

      const ctx = getAudioContext();
      const seq = pendingSeq + 1;
      pendingSeq = seq;
      pending.set(midiNote, seq);
      if (ctx.state === "suspended") await ctx.resume();
      if (pending.get(midiNote) !== seq) return;
      pending.delete(midiNote);

      const output = ensureMaster(ctx);
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      const hz = midiToHz(midiNote);
      const velocityGain = clamp(velocity / 127, 0.08, 1);
      const peak = 0.24 * velocityGain;
      const sustain = Math.max(0.0001, peak * 0.48);

      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + 0.01);
      gain.gain.setTargetAtTime(sustain, now + 0.018, 0.14);
      gain.connect(output);

      const fundamental = ctx.createOscillator();
      fundamental.type = "triangle";
      fundamental.frequency.setValueAtTime(hz, now);

      const overtone = ctx.createOscillator();
      overtone.type = "sine";
      overtone.frequency.setValueAtTime(hz * 2.01, now);

      const overtoneGain = ctx.createGain();
      overtoneGain.gain.setValueAtTime(0.16, now);

      fundamental.connect(gain);
      overtone.connect(overtoneGain);
      overtoneGain.connect(gain);

      active.set(midiNote, { gain, sources: [fundamental, overtone] });
      fundamental.start(now);
      overtone.start(now);
    },

    noteOff(midiNote: number) {
      pending.delete(midiNote);
      releaseNote(midiNote);
    },

    allNotesOff() {
      pending.clear();
      for (const midiNote of Array.from(active.keys())) releaseNote(midiNote);
    },

    dispose() {
      pending.clear();
      for (const midiNote of Array.from(active.keys())) releaseNote(midiNote, 0.035);
      window.setTimeout(() => {
        try {
          master?.disconnect();
        } catch {}
        master = null;
      }, 160);
    },
  };
}
