// Speech to text through the API: what goes to whisper, what comes back, and what happens when
// the recording is wrong or whisper doesn't answer. The real whisper.cpp is never called.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { startApi } from "./harness.ts";

// The WAV the web app records: a 44-byte header, then 16 kHz mono 16-bit samples.
function wav(seconds, { sampleRate = 16_000, channels = 1 } = {}) {
  const dataBytes = Math.round(seconds * sampleRate) * 2 * channels;
  const file = Buffer.alloc(44 + dataBytes);
  file.write("RIFF", 0, "ascii");
  file.writeUInt32LE(36 + dataBytes, 4);
  file.write("WAVE", 8, "ascii");
  file.write("fmt ", 12, "ascii");
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(channels, 22);
  file.writeUInt32LE(sampleRate, 24);
  file.writeUInt32LE(sampleRate * 2 * channels, 28);
  file.writeUInt16LE(2 * channels, 32);
  file.writeUInt16LE(16, 34);
  file.write("data", 36, "ascii");
  file.writeUInt32LE(dataBytes, 40);
  return file;
}

// A whisper that answers with a fixed sentence, or fails when asked about a 7-second clip.
const asked = [];
const whisper = createServer(async (req, res) => {
  const form = await new Request("http://whisper" + req.url, {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: "half",
  }).formData();
  const file = form.get("file");
  asked.push({ path: req.url, bytes: file.size, type: file.type, audioCtx: form.get("audio_ctx"), format: form.get("response_format") });
  if (file.size === 44 + 7 * 32_000) {
    res.writeHead(500).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ text: " [BLANK_AUDIO] What is   borrowing in Rust?\n" }));
});
await new Promise((resolve) => whisper.listen(0, "127.0.0.1", resolve));
const whisperUrl = `http://127.0.0.1:${whisper.address().port}`;

const api = await startApi("speech", { whisperUrl });
const unreachable = await api.another({ whisperUrl: "http://127.0.0.1:9" });
const send = (body, base) =>
  api.call("POST", "/api/speech/transcribe", body, { base, headers: { "Content-Type": "audio/wav" } });

test("speech: recordings go to whisper and only the words come back", async (t) => {
  t.after(() => whisper.close());
  const ok = (label) => t.diagnostic(label);

  let res = await send(wav(4));
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { text: "What is borrowing in Rust?" });
  assert.deepEqual(asked.at(-1), { path: "/inference", bytes: 44 + 4 * 32_000, type: "audio/wav", audioCtx: "512", format: "json" });
  ok("a recording is passed on whole, and the text comes back without whisper's sound marks");

  await send(wav(20));
  assert.equal(asked.at(-1).audioCtx, "1192");
  await send(wav(59));
  assert.equal(asked.at(-1).audioCtx, "1500");
  ok("whisper's window is sized to the recording: never under 512, never over the full 1500");

  for (const bad of [Buffer.from("not audio at all, just some text bytes, long enough to have a header"), wav(2, { sampleRate: 44_100 }), wav(2, { channels: 2 })]) {
    res = await send(bad);
    assert.equal(res.status, 400);
    assert.match(res.data.error, /16 kHz mono/);
  }
  const calls = asked.length;
  res = await send(wav(61));
  assert.equal(res.status, 413);
  assert.equal(asked.length, calls, "nothing wrong reaches whisper");
  ok("anything but the app's own 16 kHz mono WAV, or more than a minute of it, is refused");

  res = await send(wav(7));
  assert.equal(res.status, 503);
  assert.match(res.data.error, /Speech recognition isn't answering/);
  res = await send(wav(3), unreachable);
  assert.equal(res.status, 503);
  ok("when whisper fails or isn't running, the answer says so");

  const stored = await api.sql(
    "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND (column_name ILIKE '%audio%' OR column_name ILIKE '%transcript%')",
  );
  assert.equal(stored, "0");
  ok("no table has anywhere to keep audio or transcripts");
});
