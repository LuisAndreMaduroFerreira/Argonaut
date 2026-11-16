import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechStatus } from "../types";
import { useAppState } from "./useAppState";

// Replies are spoken in English.
const SPOKEN_LANGUAGE = "en";

// Edge's "Online (Natural)" voices are neural and sound close to a person. The voices
// installed in Windows (Zira, David) are the flat, robotic ones.
const NATURAL = /natural|neural/i;

// Microsoft's conversational voices, the most lifelike of the natural set.
const LIFELIKE = /\b(ava|andrew|emma|brian|jenny|aria|guy)\b/i;

export function isNaturalVoice(voice: SpeechSynthesisVoice): boolean {
  return NATURAL.test(voice.name) || (!voice.localService && voice.name.includes("Google"));
}

function score(voice: SpeechSynthesisVoice): number {
  const language = voice.lang.toLowerCase();
  return (
    (isNaturalVoice(voice) ? 8 : 0) +
    (language.startsWith(SPOKEN_LANGUAGE) ? 4 : 0) +
    (language === navigator.language.toLowerCase() ? 2 : 0) +
    (LIFELIKE.test(voice.name) ? 1 : 0)
  );
}

function rankVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

// Without a chosen voice, speak with the best natural English one rather than the browser's
// default, which on Windows is whichever flat voice happens to be installed.
function bestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const best = rankVoices(voices)[0];
  return best?.lang.toLowerCase().startsWith(SPOKEN_LANGUAGE) ? best : undefined;
}

export function voiceLabel(voice: SpeechSynthesisVoice): string {
  const name = voice.name
    .replace(/^Microsoft\s+/, "")
    .replace(/\s*Online\s*\(Natural\)\s*/i, " ")
    .replace(/Multilingual/, " multilingual")
    .replace(/\s*-\s*[^-]*$/, "")
    .trim();
  return `${name} · ${voice.lang}`;
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Online voices can stop partway through a long passage, so they are fed a sentence at a time.
function sentences(text: string, maxLength = 220): string[] {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && current.length + part.length > maxLength) {
      chunks.push(current.trim());
      current = "";
    }
    current += part;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function useSpeech() {
  const { preferences, patch } = useAppState();
  const { voiceURI } = preferences;
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // Cancelling fires error events for the queued sentences; only the current run may end it.
  const runRef = useRef(0);
  const isSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!isSupported) return;

    const loadVoices = () => setVoices(rankVoices(window.speechSynthesis.getVoices()));
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      window.speechSynthesis.cancel();
    };
  }, [isSupported]);

  const selectVoice = useCallback(
    (uri: string) => patch("preferences", { voiceURI: uri }),
    [patch],
  );

  const speak = useCallback(
    (markdown: string) => {
      if (!isSupported) return;
      const synth = window.speechSynthesis;
      synth.cancel();

      const chunks = sentences(stripMarkdown(markdown));
      if (chunks.length === 0) return;

      const run = runRef.current + 1;
      runRef.current = run;
      const voice = voices.find((candidate) => candidate.voiceURI === voiceURI) ?? bestVoice(voices);
      const finish = () => {
        if (runRef.current === run) setStatus("idle");
      };

      chunks.forEach((chunk, index) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        utterance.rate = 1;
        if (index === chunks.length - 1) utterance.onend = finish;
        utterance.onerror = finish;
        synth.speak(utterance);
      });
      setStatus("speaking");
    },
    [isSupported, voices, voiceURI],
  );

  const pause = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.pause();
    setStatus("paused");
  }, [isSupported]);

  const resume = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.resume();
    setStatus("speaking");
  }, [isSupported]);

  const stop = useCallback(() => {
    if (!isSupported) return;
    runRef.current += 1;
    window.speechSynthesis.cancel();
    setStatus("idle");
  }, [isSupported]);

  return {
    isSupported,
    status,
    voices,
    voiceURI,
    autoVoice: bestVoice(voices),
    selectVoice,
    speak,
    pause,
    resume,
    stop,
  };
}
