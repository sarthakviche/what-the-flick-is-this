"""Tiny local speech to text server for the faster-whisper provider.

POST /transcribe with a WAV body, returns {"text": "..."}.
GET /health returns 200 once the model is loaded.
Binds to 127.0.0.1 only.
"""
import argparse
import io
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default="small.en")
    arguments = parser.parse_args()

    from faster_whisper import WhisperModel

    # int8 on CPU runs fine on a normal laptop. Use device="cuda" if you have an NVIDIA GPU.
    whisper_model = WhisperModel(arguments.model, device="cpu", compute_type="int8")

    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, status_code, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status_code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                self._send_json(200, {"ok": True})
            else:
                self._send_json(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/transcribe":
                self._send_json(404, {"error": "not found"})
                return
            content_length = int(self.headers.get("content-length", "0"))
            audio_bytes = self.rfile.read(content_length)
            segments, _info = whisper_model.transcribe(io.BytesIO(audio_bytes), beam_size=1, vad_filter=True)
            transcript = " ".join(segment.text.strip() for segment in segments).strip()
            self._send_json(200, {"text": transcript})

        def log_message(self, format, *args):
            pass

    HTTPServer(("127.0.0.1", arguments.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
