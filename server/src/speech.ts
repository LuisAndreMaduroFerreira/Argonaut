import { LIMITS } from "../../shared/model.js";
import { HttpError, InputError } from "./errors.js";

// Speech to text, by whisper.cpp in the argonaut-whisper container. The recording only passes
// through: it is read from the request, sent on, and dropped, and the text goes straight back
// to the window that asked. Neither is stored or logged.

export class TranscriberUnavailable extends HttpError {
  constructor() {
    super(503, "Speech recognition isn't answering. Start Argonaut again, or type your question.");
  }
}

const HEADER_BYTES = 44;
const BYTES_PER_SECOND = LIMITS.speechSampleRate * 2;

// The web app records exactly one kind of WAV: a 44-byte header, then 16 kHz mono 16-bit PCM.
// Anything else isn't from it.
export function speechSeconds(body: unknown): number {
  const wav = Buffer.isBuffer(body) ? body : null;
  const valid =
    wav !== null &&
    wav.length > HEADER_BYTES &&
    wav.toString("ascii", 0, 4) === "RIFF" &&
    wav.toString("ascii", 8, 12) === "WAVE" &&
    wav.toString("ascii", 12, 16) === "fmt " &&
    wav.readUInt16LE(20) === 1 &&
    wav.readUInt16LE(22) === 1 &&
    wav.readUInt32LE(24) === LIMITS.speechSampleRate &&
    wav.readUInt16LE(34) === 16 &&
    wav.toString("ascii", 36, 40) === "data";
  if (!valid) throw new InputError("Send speech as 16 kHz mono 16-bit WAV");
  return (wav.length - HEADER_BYTES) / BYTES_PER_SECOND;
}

// Whisper looks at a 30-second window, padded with silence. A window sized to the recording
// is several times faster; below about 10 seconds' worth (512) it starts to mishear.
export function audioContextFor(seconds: number): number {
  return Math.min(1500, Math.max(512, Math.ceil(seconds * 50) + 192));
}

// What whisper writes for sounds that aren't words: [BLANK_AUDIO], [Music], (laughs)…
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function transcribe(whisperUrl: string, body: unknown): Promise<string> {
  const seconds = speechSeconds(body);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(body as Buffer)], { type: "audio/wav" }), "speech.wav");
  form.append("response_format", "json");
  form.append("temperature", "0.0");
  form.append("audio_ctx", String(audioContextFor(seconds)));

  let response: Response;
  try {
    response = await fetch(`${whisperUrl}/inference`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new TranscriberUnavailable();
  }
  if (!response.ok) throw new TranscriberUnavailable();
  const result = (await response.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof result?.text !== "string") throw new TranscriberUnavailable();
  return cleanTranscript(result.text);
}
