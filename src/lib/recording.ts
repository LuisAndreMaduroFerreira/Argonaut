// The pure parts of recording a spoken question: packing samples into the WAV the API takes,
// and deciding when the speaker has finished.

// 16-bit PCM WAV with the canonical 44-byte header: mono, at the given rate.
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length === 0 ? 0 : Math.sqrt(sum / samples.length);
}

export interface EndpointerOptions {
  // Quiet this long after speech ends the recording.
  silenceMs: number;
  // With no speech at all by now, the recording is given up.
  noSpeechMs: number;
  // The recording never runs past this.
  maxMs: number;
}

export const DEFAULT_ENDPOINTER: EndpointerOptions = { silenceMs: 1300, noSpeechMs: 8000, maxMs: 60_000 };

// "listen" while it goes on, "done" when the speaker has finished (or time is up), "nothing"
// when no one spoke. Speech is a level well above the room's own: the quietest stretch heard
// so far stands for the room, so a noisy fan doesn't count as talking.
export function createEndpointer(options: EndpointerOptions = DEFAULT_ENDPOINTER) {
  let floor = Infinity;
  let spokeMs = 0;
  let lastSpeechAt: number | null = null;
  return {
    get heardSpeech() {
      return spokeMs >= 150;
    },
    push(level: number, atMs: number, chunkMs: number): "listen" | "done" | "nothing" {
      floor = Math.min(floor, Math.max(level, 0.002));
      const speaking = level > Math.max(0.02, floor * 4);
      if (speaking) {
        spokeMs += chunkMs;
        lastSpeechAt = atMs;
      }
      if (atMs >= options.maxMs) return spokeMs >= 150 ? "done" : "nothing";
      if (spokeMs < 150) return atMs >= options.noSpeechMs ? "nothing" : "listen";
      return lastSpeechAt !== null && atMs - lastSpeechAt >= options.silenceMs ? "done" : "listen";
    },
  };
}
