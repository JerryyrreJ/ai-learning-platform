/**
 * Desktop sound cues, synthesised with Web Audio so there are no files to load.
 * The recipes match the product tour's soundtrack (opus-video/devpath-promo/audio/make_audio.py):
 * sine partials with an exponential decay, short noise bursts and a small room reverb.
 *
 * Sounds only ever repeat what the screen already shows. Browsers keep audio
 * locked until the first click or key press, so call unlockSound() from one.
 */

export type Cue =
  | "mail"
  | "nudge"
  | "error"
  | "open"
  | "send"
  | "reply"
  | "fact"
  | "delivered"
  | "review-right"
  | "review-wrong"
  | "success"
  | "partial"
  | "failure"
  | "strong"
  | "mixed"
  | "weak";

const STORAGE_KEY = "devpath:sound";
const VOLUME = 0.5;
// The same cue fired twice this close together plays once.
const REPEAT_GAP = 0.08;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let enabled = true;
const lastPlayed = new Map<Cue, number>();

/** Whether sound is on. Defaults to on; the learner's choice is remembered. */
export function readSoundSetting(): boolean {
  try {
    enabled = window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    enabled = true;
  }
  return enabled;
}

export function writeSoundSetting(on: boolean) {
  enabled = on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Private windows can refuse storage; the choice still holds for this visit.
  }
}

/** Create or resume the audio context. Call from a user gesture. */
export function unlockSound() {
  const audio = context();
  if (audio?.state === "suspended") void audio.resume();
}

/** Play a cue `delay` seconds from now. Does nothing while muted or hidden. */
export function play(cue: Cue, delay = 0) {
  if (!enabled || typeof document === "undefined" || document.hidden) return;
  const audio = context();
  if (!audio || !out || audio.state !== "running") return;
  const at = audio.currentTime + delay;
  if (at - (lastPlayed.get(cue) ?? -1) < REPEAT_GAP) return;
  lastPlayed.set(cue, at);
  CUES[cue](audio, out, at);
}

function context(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined" || !window.AudioContext) return null;
  ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = VOLUME;
  master.connect(ctx.destination);
  // A short room, mixed in quietly, so the cues sound like the tour rather than raw beeps.
  const room = ctx.createConvolver();
  room.buffer = roomImpulse(ctx, 1.0);
  const wet = ctx.createGain();
  wet.gain.value = 0.12;
  room.connect(wet).connect(master);
  out = ctx.createGain();
  out.connect(master);
  out.connect(room);
  return ctx;
}

function roomImpulse(audio: AudioContext, seconds: number) {
  const length = Math.floor(audio.sampleRate * seconds);
  const buffer = audio.createBuffer(2, length, audio.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audio.sampleRate * seconds / 6));
  }
  return buffer;
}

/** Sine partials sharing one envelope: 3 ms attack, then an exponential decay. */
function tone(audio: AudioContext, dest: AudioNode, at: number, freqs: number[], length: number, decay: number, gain: number) {
  const env = audio.createGain();
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(gain / freqs.length, at + 0.003);
  env.gain.setTargetAtTime(0, at + 0.003, decay);
  env.connect(dest);
  for (const freq of freqs) {
    const osc = audio.createOscillator();
    osc.frequency.value = freq;
    osc.connect(env);
    osc.start(at);
    osc.stop(at + length);
  }
}

/** Filtered white noise with a decay (clicks) or a swell (whooshes). */
function noise(audio: AudioContext, dest: AudioNode, at: number, length: number, gain: number, filter: BiquadFilterType, freq: number, swell = false) {
  const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * length), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  const shape = audio.createBiquadFilter();
  shape.type = filter;
  shape.frequency.value = freq;
  const env = audio.createGain();
  if (swell) {
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + length / 2);
    env.gain.linearRampToValueAtTime(0, at + length);
  } else {
    env.gain.setValueAtTime(gain, at);
    env.gain.setTargetAtTime(0, at, length / 6);
  }
  source.connect(shape).connect(env).connect(dest);
  source.start(at);
  source.stop(at + length);
}

type Recipe = (audio: AudioContext, dest: AudioNode, at: number) => void;

const click: Recipe = (a, d, at) => {
  noise(a, d, at, 0.03, 0.25, "highpass", 1500);
  tone(a, d, at, [2200], 0.03, 0.006, 0.25);
};

const chime: Recipe = (a, d, at) => {
  tone(a, d, at, [1318.5], 0.08, 0.05, 0.13);
  tone(a, d, at + 0.08, [1568], 0.08, 0.05, 0.13);
  tone(a, d, at + 0.16, [2093, 1318.5], 0.7, 0.2, 0.13);
};

const pop: Recipe = (a, d, at) => tone(a, d, at, [880, 1320], 0.15, 0.04, 0.16);

const CUES: Record<Cue, Recipe> = {
  // New mail: the two-step notification from the tour.
  mail: (a, d, at) => {
    tone(a, d, at, [1046.5, 1568], 0.09, 0.05, 0.22);
    tone(a, d, at + 0.09, [1318.5, 1975.5], 0.5, 0.14, 0.22);
  },
  nudge: pop,
  error: (a, d, at) => {
    tone(a, d, at, [220, 233], 0.3, 0.08, 0.18);
    tone(a, d, at + 0.12, [196], 0.35, 0.1, 0.18);
  },
  open: (a, d, at) => {
    click(a, d, at);
    noise(a, d, at + 0.02, 0.35, 0.08, "lowpass", 2200, true);
  },
  send: click,
  reply: pop,
  fact: chime,
  delivered: chime,
  "review-right": chime,
  "review-wrong": (a, d, at) => tone(a, d, at, [392, 370], 0.25, 0.08, 0.16),
  success: (a, d, at) => {
    tone(a, d, at, [1046.5, 1318.5, 1568], 0.12, 0.08, 0.2);
    tone(a, d, at + 0.12, [2093, 1568, 1318.5], 0.9, 0.28, 0.2);
  },
  partial: (a, d, at) => {
    tone(a, d, at, [880, 1108.7], 0.12, 0.08, 0.18);
    tone(a, d, at + 0.12, [987.8, 1318.5], 0.7, 0.22, 0.18);
  },
  failure: (a, d, at) => {
    tone(a, d, at, [659.3, 523.3], 0.14, 0.08, 0.18);
    tone(a, d, at + 0.14, [392, 466.2], 0.8, 0.25, 0.18);
  },
  // One note per report card; higher is better.
  strong: (a, d, at) => tone(a, d, at, [2093], 0.25, 0.08, 0.1),
  mixed: (a, d, at) => tone(a, d, at, [1568], 0.25, 0.08, 0.1),
  weak: (a, d, at) => tone(a, d, at, [1046.5, 1108.7], 0.25, 0.08, 0.1),
};
