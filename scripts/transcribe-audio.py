#!/usr/bin/env python3
"""Convert bounded reCAPTCHA MP3 input and return Google transcription JSON."""
import io
import json
import re
import subprocess
import sys


def transcribe(audio):
    import speech_recognition as sr

    if not audio or len(audio) > 1024 * 1024:
        raise ValueError("Invalid audio input")
    converted = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "pipe",
         "-f", "mp3", "-i", "pipe:0", "-t", "30", "-ac", "1", "-ar", "16000",
         "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"],
        input=audio, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        timeout=15, check=True,
    ).stdout
    if not converted or len(converted) > 2 * 1024 * 1024:
        raise ValueError("Invalid converted audio")
    recognizer = sr.Recognizer()
    recognizer.operation_timeout = 20
    with sr.AudioFile(io.BytesIO(converted)) as source:
        recording = recognizer.record(source)
    text = recognizer.recognize_google(
        recording, language="en-US",
        endpoint="https://www.google.com/speech-api/v2/recognize",
    ).strip()
    if not text or len(text) > 256 or not re.fullmatch(r"[a-zA-Z0-9 ,.'?!-]+", text):
        raise ValueError("Invalid transcription")
    return text


if __name__ == "__main__":
    try:
        words = transcribe(sys.stdin.buffer.read(1024 * 1024 + 1))
        print(json.dumps({"transcript": words}))
    except Exception:
        # Do not expose audio, provider responses, or payload URLs in diagnostics.
        print(json.dumps({"error": "Audio transcription failed"}))
        sys.exit(1)
