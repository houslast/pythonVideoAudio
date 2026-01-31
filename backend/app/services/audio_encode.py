from __future__ import annotations

import os
import subprocess
import tempfile

import imageio_ffmpeg


def encode_wav_to_mp3(wav_bytes: bytes, bitrate_kbps: int) -> bytes:
    bitrate_kbps = int(bitrate_kbps)
    if bitrate_kbps < 32 or bitrate_kbps > 320:
        raise ValueError("bitrate_kbps inválido (32..320).")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory() as td:
        in_path = os.path.join(td, "in.wav")
        out_path = os.path.join(td, "out.mp3")
        with open(in_path, "wb") as f:
            f.write(wav_bytes)

        cmd = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            in_path,
            "-vn",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            f"{bitrate_kbps}k",
            out_path,
        ]
        subprocess.run(cmd, check=True)
        with open(out_path, "rb") as f:
            return f.read()

