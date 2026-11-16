import { test } from "node:test";
import assert from "node:assert/strict";
import { createEndpointer, encodeWav, rms } from "./recording";

test("encodeWav writes the 16 kHz mono 16-bit WAV the API takes", () => {
  const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 0.5, 2]), 16_000));
  const text = (offset: number) =>
    String.fromCharCode(...[0, 1, 2, 3].map((index) => wav.getUint8(offset + index)));
  assert.equal(wav.byteLength, 44 + 10);
  assert.deepEqual([text(0), text(8), text(12), text(36)], ["RIFF", "WAVE", "fmt ", "data"]);
  assert.equal(wav.getUint16(20, true), 1);
  assert.equal(wav.getUint16(22, true), 1);
  assert.equal(wav.getUint32(24, true), 16_000);
  assert.equal(wav.getUint16(34, true), 16);
  assert.equal(wav.getUint32(40, true), 10);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => wav.getInt16(44 + index * 2, true)),
    [0, 32767, -32768, 16383, 32767],
    "loud samples are clipped, not wrapped",
  );
});

test("rms measures a chunk's level", () => {
  assert.equal(rms(new Float32Array([])), 0);
  assert.equal(rms(new Float32Array([0.5, -0.5])), 0.5);
});

// 100 ms chunks at a level, starting at `from` ms.
function feed(endpointer: ReturnType<typeof createEndpointer>, levels: number[], from = 0) {
  return levels.map((level, index) => endpointer.push(level, from + (index + 1) * 100, 100));
}

test("the recording ends after a pause that follows speech", () => {
  const endpointer = createEndpointer();
  const room = Array(5).fill(0.005);
  const speech = Array(15).fill(0.2);
  const pause = Array(14).fill(0.005);
  const answers = feed(endpointer, [...room, ...speech, ...pause]);
  assert.equal(answers.indexOf("done"), room.length + speech.length + 12, "1.3 s of quiet after the last word");
  assert.ok(answers.slice(0, -2).every((answer) => answer === "listen"));
});

test("a short pause mid-sentence doesn't end it", () => {
  const endpointer = createEndpointer();
  const answers = feed(endpointer, [...Array(10).fill(0.2), ...Array(8).fill(0.005), ...Array(10).fill(0.2)]);
  assert.ok(answers.every((answer) => answer === "listen"));
});

test("with nobody speaking, it gives up after eight seconds; a noisy room isn't speech", () => {
  const quiet = feed(createEndpointer(), Array(80).fill(0.004));
  assert.equal(quiet.at(-1), "nothing");
  assert.equal(quiet.indexOf("nothing"), 79);
  const fan = createEndpointer();
  const noisy = feed(fan, Array(80).fill(0.03));
  assert.equal(noisy.at(-1), "nothing", "a steady hum sets the room's level");
  assert.equal(fan.heardSpeech, false);
});

test("a minute is the most it records", () => {
  const endpointer = createEndpointer();
  const answers = feed(endpointer, [...Array(5).fill(0.005), ...Array(600).fill(0.2)]);
  assert.equal(answers.indexOf("done"), 599, "the chunk that reaches 60 s");
});
