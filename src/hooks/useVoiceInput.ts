import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS } from "../types";
import { apiFetch, errorMessage } from "../lib/api";
import { createEndpointer, encodeWav, rms } from "../lib/recording";
import { useDialogs } from "./useDialogs";

// The assistant's microphone. A spoken question is recorded here, ended by a pause (or by
// clicking again), and sent once as 16 kHz WAV to the API, where whisper turns it into text on
// this PC. Nothing is kept: the samples live in memory until the text comes back.
//
// Recording goes through an AudioWorklet that hands over the raw samples, rather than the
// browser's own speech recognition, which the Argonaut window (WebView2) doesn't have.

export type VoiceState = "idle" | "listening" | "transcribing";

const TAP = `
registerProcessor("argonaut-tap", class extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
});`;

interface Session {
  stream: MediaStream;
  context: AudioContext;
  chunks: Float32Array[];
  finished: boolean;
}

export function useVoiceInput(onTranscript: (text: string) => void) {
  const { notify } = useDialogs();
  const [state, setState] = useState<VoiceState>("idle");
  const sessionRef = useRef<Session | null>(null);
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;
  const mounted = useRef(true);

  const isSupported =
    typeof window !== "undefined" && typeof AudioWorkletNode !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const release = (session: Session) => {
    session.stream.getTracks().forEach((track) => track.stop());
    void session.context.close().catch(() => undefined);
  };

  // Ends the recording; with send, its samples go to be transcribed.
  const finish = useCallback(
    async (send: boolean) => {
      const session = sessionRef.current;
      if (!session || session.finished) return;
      session.finished = true;
      sessionRef.current = null;
      release(session);
      if (!send) {
        if (mounted.current) setState("idle");
        return;
      }
      const length = session.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const samples = new Float32Array(length);
      let offset = 0;
      for (const chunk of session.chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }
      session.chunks = [];
      if (mounted.current) setState("transcribing");
      try {
        const { text } = await apiFetch<{ text: string }>(
          "/api/speech/transcribe",
          {
            method: "POST",
            body: encodeWav(samples, LIMITS.speechSampleRate),
            headers: { "Content-Type": "audio/wav" },
          },
          { timeoutMs: 90_000 },
        );
        if (mounted.current && text) callbackRef.current(text);
      } catch (cause) {
        if (mounted.current) notify("Didn't catch that", errorMessage(cause, "Speech recognition failed"));
      } finally {
        if (mounted.current) setState("idle");
      }
    },
    [notify],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) release(session);
    };
  }, []);

  const startListening = useCallback(async () => {
    if (sessionRef.current || state !== "idle") return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (cause) {
      const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
      notify(
        "Microphone not available",
        denied ? "Argonaut wasn't allowed to use the microphone." : "No microphone was found.",
      );
      return;
    }
    // The context resamples whatever the microphone gives to the 16 kHz whisper expects.
    const context = new AudioContext({ sampleRate: LIMITS.speechSampleRate });
    const session: Session = { stream, context, chunks: [], finished: false };
    sessionRef.current = session;
    setState("listening");
    try {
      const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = context.createMediaStreamSource(stream);
      const tap = new AudioWorkletNode(context, "argonaut-tap");
      const endpointer = createEndpointer();
      let heardMs = 0;
      tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (session.finished) return;
        const chunk = event.data;
        session.chunks.push(chunk);
        const chunkMs = (chunk.length / LIMITS.speechSampleRate) * 1000;
        heardMs += chunkMs;
        const verdict = endpointer.push(rms(chunk), heardMs, chunkMs);
        if (verdict === "done") void finish(true);
        else if (verdict === "nothing") void finish(false);
      };
      source.connect(tap);
    } catch (cause) {
      void finish(false);
      notify("Microphone not available", errorMessage(cause, "Recording couldn't start."));
    }
  }, [finish, notify, state]);

  // Clicking the microphone while listening sends what was said so far.
  const stopListening = useCallback(() => void finish(true), [finish]);

  return {
    isSupported,
    state,
    isListening: state === "listening",
    startListening: () => void startListening(),
    stopListening,
  };
}
