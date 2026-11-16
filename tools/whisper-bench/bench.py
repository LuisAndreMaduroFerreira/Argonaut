"""Benchmark local Whisper on this PC with Intel OpenVINO: Arc GPU vs integrated GPU vs CPU.

For each model and device it measures:
  * startup       loading and compiling the model, paid once when a speech service launches
  * first phrase  the first transcription after startup
  * warm latency  median (and slowest) time per phrase once everything is running
  * accuracy      word error rate against the known text of each phrase

Test phrases are synthesized locally with the Windows speech voice, so no recordings are
needed. To include your own voice, pass --audio-dir with 16 kHz mono 16-bit WAV files; a
same-named .txt beside a WAV adds it to the accuracy table.

Each device runs in its own process, so a device that stalls is stopped once a phrase takes
longer than --slow-limit instead of hanging the whole run.

Run through run.ps1, which creates an isolated Python environment on first use.
"""

from __future__ import annotations

import argparse
import json
import multiprocessing
import os
import statistics
import subprocess
import sys
import time
import wave
from dataclasses import dataclass, field
from datetime import datetime
from multiprocessing.connection import Connection
from pathlib import Path

import numpy as np
import openvino as ov
import openvino_genai as ov_genai
from huggingface_hub import snapshot_download

WORK_DIR = Path(os.environ["LOCALAPPDATA"]) / "Argonaut" / "whisper-bench"

# English-only models, pre-converted by Intel. int8 weights run well on both GPU and CPU.
MODELS = {
    "base.en": "OpenVINO/whisper-base.en-int8-ov",
    "small.en": "OpenVINO/whisper-small.en-int8-ov",
}

# Shaped like real Argonaut use: short commands, a question, and a stretch of dictation.
PHRASES = {
    "command": "Argonaut, create a new note. Over.",
    "tag": "Argonaut, add the tag research to this note. Over.",
    "question": "Argonaut, what did I write about Postgres time zones last week? Over.",
    "dictation": (
        "Today I studied how the mission periods roll over at local midnight. "
        "A streak only breaks when a whole day passes without progress, and the weekly "
        "missions start on Monday. Tomorrow I want to benchmark speech recognition on the "
        "graphics card. Over."
    ),
}

SAMPLE_RATE = 16_000
# Compiling a model for a GPU the first time can take minutes; later launches load it from the cache.
STARTUP_LIMIT_S = 900.0


@dataclass
class Clip:
    name: str
    path: Path
    samples: list[float]
    seconds: float
    reference: str | None


@dataclass
class Result:
    model: str
    device: str
    device_name: str
    startup_s: float = 0.0
    cache_was_warm: bool = False
    first_phrase_s: float = 0.0
    latencies: dict[str, list[float]] = field(default_factory=dict)
    transcripts: dict[str, str] = field(default_factory=dict)
    errors: dict[str, float] = field(default_factory=dict)
    failure: str | None = None


def synthesize_phrases(audio_dir: Path) -> None:
    missing = {name: text for name, text in PHRASES.items() if not (audio_dir / f"{name}.wav").exists()}
    if not missing:
        return
    audio_dir.mkdir(parents=True, exist_ok=True)
    print(f"Synthesizing {len(missing)} test phrases with the Windows speech voice...")
    jobs = json.dumps([{"path": str(audio_dir / f"{name}.wav"), "text": text} for name, text in missing.items()])
    script = r"""
Add-Type -AssemblyName System.Speech
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 16000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($job in ($env:BENCH_PHRASES | ConvertFrom-Json)) {
  $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voice.SetOutputToWaveFile($job.path, $format)
  $voice.Speak($job.text)
  $voice.Dispose()
}
"""
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        check=True,
        env={**os.environ, "BENCH_PHRASES": jobs},
    )
    for name, text in missing.items():
        (audio_dir / f"{name}.txt").write_text(text, encoding="utf-8")


def load_clip(path: Path) -> Clip:
    with wave.open(str(path), "rb") as wav:
        if wav.getframerate() != SAMPLE_RATE or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected a 16 kHz mono 16-bit WAV file")
        frames = wav.readframes(wav.getnframes())
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    reference_path = path.with_suffix(".txt")
    reference = reference_path.read_text(encoding="utf-8").strip() if reference_path.exists() else None
    # Converted once here so the list conversion never lands inside a timed call.
    return Clip(path.stem, path, audio.tolist(), len(audio) / SAMPLE_RATE, reference)


def words(text: str) -> list[str]:
    return "".join(ch.lower() if ch.isalnum() or ch.isspace() else " " for ch in text).split()


def word_error_rate(reference: str, hypothesis: str) -> float:
    ref, hyp = words(reference), words(hypothesis)
    previous = list(range(len(hyp) + 1))
    for i, ref_word in enumerate(ref, start=1):
        current = [i] + [0] * len(hyp)
        for j, hyp_word in enumerate(hyp, start=1):
            current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ref_word != hyp_word))
        previous = current
    return previous[-1] / max(len(ref), 1)


def ensure_model(name: str) -> Path:
    target = WORK_DIR / "models" / name
    if not (target / "openvino_encoder_model.xml").exists():
        print(f"Downloading {MODELS[name]}...")
        snapshot_download(MODELS[name], local_dir=target)
    return target


def device_worker(
    connection: Connection,
    model_dir: str,
    device: str,
    cache_dir: str,
    clip_paths: list[str],
    runs: int,
) -> None:
    """Transcribes every clip on one device, reporting each step to the parent process.

    A stalled device blocks inside native code, where only ending its process can stop it.
    """
    try:
        started = time.perf_counter()
        pipe = ov_genai.WhisperPipeline(model_dir, device, CACHE_DIR=cache_dir)
        connection.send(("startup", time.perf_counter() - started))

        config = pipe.get_generation_config()
        config.max_new_tokens = 160
        clips = [load_clip(Path(path)) for path in clip_paths]

        started = time.perf_counter()
        pipe.generate(clips[0].samples, config)
        connection.send(("first phrase", time.perf_counter() - started))

        for clip in clips:
            pipe.generate(clip.samples, config)  # settle this clip length before timing it
            connection.send(("warm", clip.name))
            for _ in range(runs):
                started = time.perf_counter()
                output = pipe.generate(clip.samples, config)
                elapsed = time.perf_counter() - started
                connection.send(("run", clip.name, elapsed, output.texts[0].strip() if output.texts else ""))
    except Exception as error:  # an unsupported device should not end the whole run
        connection.send(("error", f"{type(error).__name__}: {error}"))
    finally:
        connection.close()


def benchmark(
    model: str,
    model_dir: Path,
    device: str,
    device_name: str,
    clips: list[Clip],
    runs: int,
    slow_limit_s: float,
) -> Result:
    result = Result(model, device, device_name)
    cache_dir = WORK_DIR / "cache" / model / device
    result.cache_was_warm = cache_dir.exists() and any(cache_dir.iterdir())
    cache_dir.mkdir(parents=True, exist_ok=True)

    receiver, sender = multiprocessing.Pipe(duplex=False)
    worker = multiprocessing.Process(
        target=device_worker,
        args=(sender, str(model_dir), device, str(cache_dir), [str(clip.path) for clip in clips], runs),
        daemon=True,
    )
    worker.start()
    sender.close()  # the worker now holds the only sending end

    # A device this slow is unusable for live voice; don't spend minutes proving it.
    pending, limit = "startup", STARTUP_LIMIT_S
    finished_clips = 0
    try:
        while finished_clips < len(clips) and not result.failure:
            try:
                if not receiver.poll(limit):
                    worker.terminate()
                    result.failure = f"too slow: {pending} took over {limit:.0f}s"
                    print(f"  skipped: {result.failure}")
                    break
                kind, *values = receiver.recv()
            except (EOFError, OSError):  # the pipe closed without a report: the device runtime crashed
                worker.join(timeout=10)
                result.failure = f"crashed during {pending} (exit code {worker.exitcode})"
                print(f"  failed: {result.failure}")
                break

            if kind == "error":
                result.failure = values[0]
                print(f"  failed: {result.failure}")
            elif kind == "startup":
                result.startup_s = values[0]
                cache = "cached" if result.cache_was_warm else "first compile"
                print(f"  startup {result.startup_s:.1f}s ({cache})")
                pending, limit = "first phrase", slow_limit_s
            elif kind == "first phrase":
                result.first_phrase_s = values[0]
                print(f"  first phrase {result.first_phrase_s:.1f}s")
                pending = f"{clips[0].name} warm-up"
            elif kind == "warm":
                pending = f"{values[0]} run"
            elif kind == "run":
                name, elapsed, text = values
                timings = result.latencies.setdefault(name, [])
                timings.append(elapsed)
                result.transcripts[name] = text
                if len(timings) == runs:
                    clip = clips[finished_clips]
                    if clip.reference:
                        result.errors[name] = word_error_rate(clip.reference, text)
                    print(f"  {name:<10} median {statistics.median(timings) * 1000:7.0f} ms   {text[:60]}")
                    finished_clips += 1
                    if finished_clips < len(clips):
                        pending = f"{clips[finished_clips].name} warm-up"
    finally:
        worker.join(timeout=10)  # a finished worker is still releasing the device
        if worker.is_alive():
            worker.terminate()
            worker.join()
        receiver.close()
    return result


def ms(seconds: float) -> str:
    return f"{seconds * 1000:,.0f}"


def render_report(results: list[Result], clips: list[Clip], devices: dict[str, str], runs: int) -> str:
    lines = [
        f"# Whisper benchmark — {datetime.now():%Y-%m-%d %H:%M}",
        "",
        f"- OpenVINO {ov.get_version()}, {runs} timed runs per phrase after a warm-up, greedy decoding",
        *[f"- `{device}`: {name}" for device, name in devices.items()],
        "",
        "## Speed",
        "",
        "Warm cells are median milliseconds per phrase, with the slowest run in brackets.",
        "",
        "| Model | Device | Startup | First phrase | "
        + " | ".join(f"{clip.name} ({clip.seconds:.1f}s audio)" for clip in clips)
        + " |",
        "|---|---|---|---|" + "---|" * len(clips),
    ]
    for result in results:
        label = f"{result.device} — {result.device_name}"
        cache = "cached" if result.cache_was_warm else "first compile"
        if result.failure:
            startup = f"{result.startup_s:.1f}s ({cache})" if result.startup_s else "—"
            first = f"{ms(result.first_phrase_s)} ms" if result.first_phrase_s else "—"
            lines.append(
                f"| {result.model} | {label} | {startup} | {first} | {result.failure} |" + " |" * (len(clips) - 1)
            )
            continue
        cells = [
            f"{ms(statistics.median(result.latencies[clip.name]))} ({ms(max(result.latencies[clip.name]))})"
            for clip in clips
        ]
        lines.append(
            f"| {result.model} | {label} | {result.startup_s:.1f}s ({cache}) | "
            f"{ms(result.first_phrase_s)} ms | " + " | ".join(cells) + " |"
        )

    scored = [clip for clip in clips if clip.reference]
    if scored:
        lines += [
            "",
            "## Accuracy",
            "",
            "Word error rate: the share of words substituted, missed or added (0% is perfect).",
            "",
            "| Model | Device | " + " | ".join(clip.name for clip in scored) + " |",
            "|---|---|" + "---|" * len(scored),
        ]
        for result in results:
            if result.failure:
                continue
            cells = [f"{result.errors[clip.name] * 100:.0f}%" for clip in scored]
            lines.append(f"| {result.model} | {result.device} | " + " | ".join(cells) + " |")

    lines += ["", "## Transcripts", ""]
    for result in results:
        if result.failure:
            continue
        lines.append(f"**{result.model} on {result.device}**")
        lines += [f"- {clip.name}: {result.transcripts[clip.name]}" for clip in clips]
        lines.append("")
    return "\n".join(lines)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runs", type=int, default=5, help="timed runs per phrase (default 5)")
    parser.add_argument("--models", nargs="+", choices=list(MODELS), default=list(MODELS))
    parser.add_argument("--devices", nargs="+", help="OpenVINO device ids, e.g. CPU GPU.1 (default: all)")
    parser.add_argument("--audio-dir", type=Path, help="extra 16 kHz mono WAV files to include")
    parser.add_argument(
        "--slow-limit",
        type=float,
        default=30.0,
        help="skip a device once one phrase takes longer than this many seconds (default 30)",
    )
    args = parser.parse_args()
    if args.audio_dir:
        args.audio_dir = args.audio_dir.resolve()
    # GPU runtimes write diagnostics such as kernel.errors.txt into the working directory.
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    os.chdir(WORK_DIR)

    core = ov.Core()
    devices = {device: core.get_property(device, "FULL_DEVICE_NAME") for device in core.available_devices}
    print("Devices OpenVINO can use:")
    for device, name in devices.items():
        print(f"  {device:<6} {name}")
    selected = args.devices or list(devices)
    unknown = [device for device in selected if device not in devices]
    if unknown:
        raise SystemExit(f"Unknown device(s): {', '.join(unknown)}")

    phrase_dir = WORK_DIR / "audio"
    synthesize_phrases(phrase_dir)
    clips = [load_clip(phrase_dir / f"{name}.wav") for name in PHRASES]
    if args.audio_dir:
        clips += [load_clip(path) for path in sorted(args.audio_dir.glob("*.wav"))]

    results: list[Result] = []
    for model in args.models:
        model_dir = ensure_model(model)
        for device in selected:
            print(f"\n{model} on {device} ({devices[device]})")
            results.append(
                benchmark(model, model_dir, device, devices[device], clips, args.runs, args.slow_limit)
            )

    report = render_report(results, clips, {d: devices[d] for d in selected}, args.runs)
    results_dir = WORK_DIR / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    report_path = results_dir / f"{datetime.now():%Y%m%d-%H%M%S}.md"
    report_path.write_text(report, encoding="utf-8")
    print("\n" + report)
    print(f"\nSaved to {report_path}")


if __name__ == "__main__":
    main()
