# Speech recognition for the assistant's microphone: whisper.cpp's HTTP server with the
# multilingual base model (English, Portuguese, French and the rest). Audio arrives from the
# API, is transcribed in memory and is never written anywhere. Not published to the host.

FROM debian:bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# A fixed release, so a rebuild gives the same program.
RUN git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF \
 && cmake --build build --target whisper-server -j 4

FROM debian:bookworm-slim AS model
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# About 148 MB, checked against the published SHA-1 so a broken download fails the build.
RUN curl -fL --retry 3 -o /ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin \
 && echo "465707469ff3a37a2b9b8d8f89f2f99de7299dac  /ggml-base.bin" | sha1sum -c -

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --no-create-home whisper
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
COPY --from=model /ggml-base.bin /models/ggml-base.bin
USER whisper
EXPOSE 8792
# --language auto: each recording's language is detected; a request may name one instead.
# The working directory has no public folder, so only /inference and /health answer.
WORKDIR /tmp
CMD ["whisper-server", "--host", "0.0.0.0", "--port", "8792", "--model", "/models/ggml-base.bin", \
     "--language", "auto", "--threads", "4", "--no-timestamps", "--suppress-nst", "--flash-attn", "--public", "/nonexistent"]
