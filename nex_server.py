from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
VENDOR_BIN = ROOT / "vendor" / "ffmpeg" / "bin"
MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024
COPY_CHUNK = 1024 * 1024


def executable(name: str) -> str | None:
    bundled = VENDOR_BIN / f"{name}.exe"
    if bundled.is_file():
        return str(bundled)
    return shutil.which(name)


FFMPEG = executable("ffmpeg")
FFPROBE = executable("ffprobe")


def run_process(command: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def probe_media(path: Path) -> dict:
    if not FFPROBE:
        raise RuntimeError("Локальный ffprobe не найден.")
    result = run_process(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-print_format",
            "json",
            str(path),
        ],
        timeout=90,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or "ffprobe не смог прочитать файл"
        raise RuntimeError(detail[-1800:])
    payload = json.loads(result.stdout or "{}")
    streams = payload.get("streams") or []
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
    format_info = payload.get("format") or {}
    duration_value = format_info.get("duration") or (video or {}).get("duration")
    try:
        duration = float(duration_value)
    except (TypeError, ValueError):
        duration = None
    return {
        "container": format_info.get("format_name") or "",
        "duration": duration,
        "size": int(format_info.get("size") or path.stat().st_size),
        "videoTrack": bool(video),
        "audioTrack": bool(audio),
        "videoCodec": (video or {}).get("codec_name") or "",
        "audioCodec": (audio or {}).get("codec_name") or "",
        "width": int((video or {}).get("width") or 0),
        "height": int((video or {}).get("height") or 0),
        "sampleRate": int((audio or {}).get("sample_rate") or 0),
        "channels": int((audio or {}).get("channels") or 0),
    }


def ffmpeg_version() -> str:
    if not FFMPEG:
        return ""
    result = run_process([FFMPEG, "-version"], timeout=8)
    return (result.stdout.splitlines() or [""])[0].strip()


class NexEstateHandler(SimpleHTTPRequestHandler):
    server_version = "NexEstateStudio/2.2"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, message: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {message % args}")

    def end_headers(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        elif parsed.path in {"/", "/index.html", "/service-worker.js"} or parsed.path.endswith((".js", ".css")):
            self.send_header("Cache-Control", "no-cache, max-age=0, must-revalidate")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def _json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _receive_body(self, target: Path) -> int:
        raw_length = self.headers.get("Content-Length")
        try:
            remaining = int(raw_length or "0")
        except ValueError as exc:
            raise ValueError("Некорректный размер входного файла.") from exc
        if remaining <= 0:
            raise ValueError("Получен пустой входной файл.")
        if remaining > MAX_UPLOAD_BYTES:
            raise ValueError("Файл превышает локальный лимит 8 ГБ.")
        total = 0
        with target.open("wb") as stream:
            while remaining:
                chunk = self.rfile.read(min(COPY_CHUNK, remaining))
                if not chunk:
                    raise ConnectionError("Передача входного файла прервалась.")
                stream.write(chunk)
                total += len(chunk)
                remaining -= len(chunk)
        return total

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            available = bool(FFMPEG and FFPROBE)
            self._json(
                HTTPStatus.OK if available else HTTPStatus.SERVICE_UNAVAILABLE,
                {
                    "ok": available,
                    "service": "NexEstate Studio local media encoder",
                    "ffmpeg": ffmpeg_version() if available else "",
                    "mp4": available,
                    "videoCodec": "h264" if available else "",
                    "audioCodec": "aac" if available else "",
                },
            )
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in {"/api/probe", "/api/transcode/mp4"}:
            self._json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Неизвестный локальный API."})
            return
        if not FFMPEG or not FFPROBE:
            self._json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"ok": False, "error": "Локальный FFmpeg недоступен. Запустите проект через START_WINDOWS.cmd."},
            )
            return

        try:
            with tempfile.TemporaryDirectory(prefix=".nexestate-media-", dir=str(ROOT)) as temporary:
                temp_dir = Path(temporary)
                source = temp_dir / "input.webm"
                self._receive_body(source)
                source_probe = probe_media(source)
                if not source_probe["videoTrack"]:
                    raise RuntimeError("Входной файл не содержит видеодорожку.")

                if parsed.path == "/api/probe":
                    self._json(HTTPStatus.OK, {"ok": True, **source_probe})
                    return

                query = parse_qs(parsed.query)
                quality = (query.get("quality") or ["smart"])[0]
                bitrate_raw = (query.get("videoBitrate") or [""])[0]
                audio_bitrate_raw = (query.get("audioBitrate") or ["192000"])[0]
                try:
                    video_bitrate = max(1_000_000, min(36_000_000, int(bitrate_raw))) if bitrate_raw else None
                except ValueError:
                    video_bitrate = None
                try:
                    audio_bitrate = max(96_000, min(320_000, int(audio_bitrate_raw)))
                except ValueError:
                    audio_bitrate = 192_000

                output = temp_dir / "output.mp4"
                command = [
                    FFMPEG,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-nostdin",
                    "-y",
                    "-i",
                    str(source),
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0?",
                    "-vf",
                    "setpts=PTS-STARTPTS",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                ]
                if quality == "custom" and video_bitrate:
                    command.extend(["-b:v", str(video_bitrate), "-maxrate", str(video_bitrate), "-bufsize", str(video_bitrate * 2)])
                else:
                    crf = {"none": "14", "quality": "16", "smart": "20", "small": "26"}.get(quality, "20")
                    command.extend(["-crf", crf])
                command.extend(["-pix_fmt", "yuv420p"])
                if source_probe["audioTrack"]:
                    command.extend([
                        "-af",
                        "asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0",
                        "-c:a",
                        "aac",
                        "-b:a",
                        str(audio_bitrate),
                    ])
                command.extend([
                    "-movflags",
                    "+faststart",
                    "-max_muxing_queue_size",
                    "2048",
                    str(output),
                ])
                result = run_process(command, timeout=60 * 60 * 6)
                if result.returncode != 0 or not output.is_file() or output.stat().st_size <= 0:
                    detail = result.stderr.strip() or "FFmpeg не создал итоговый MP4"
                    raise RuntimeError(detail[-2200:])

                output_probe = probe_media(output)
                if not output_probe["videoTrack"] or output_probe["videoCodec"] != "h264":
                    raise RuntimeError("Итоговый MP4 не содержит корректную видеодорожку H.264.")
                if source_probe["audioTrack"] and (not output_probe["audioTrack"] or output_probe["audioCodec"] != "aac"):
                    raise RuntimeError("Итоговый MP4 не содержит сохранённую звуковую дорожку AAC.")
                if "mp4" not in output_probe["container"] and "mov" not in output_probe["container"]:
                    raise RuntimeError("FFmpeg создал файл с неожиданным контейнером.")

                size = output.stat().st_size
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(size))
                self.send_header("X-Nex-Container", "mp4")
                self.send_header("X-Nex-Video-Codec", output_probe["videoCodec"])
                self.send_header("X-Nex-Audio-Codec", output_probe["audioCodec"] or "none")
                self.send_header("X-Nex-Video-Track", "1")
                self.send_header("X-Nex-Audio-Track", "1" if output_probe["audioTrack"] else "0")
                self.end_headers()
                with output.open("rb") as stream:
                    shutil.copyfileobj(stream, self.wfile, length=COPY_CHUNK)
        except (BrokenPipeError, ConnectionResetError):
            return
        except (ValueError, ConnectionError) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
        except subprocess.TimeoutExpired:
            self._json(HTTPStatus.GATEWAY_TIMEOUT, {"ok": False, "error": "Локальное кодирование MP4 превысило допустимое время."})
        except Exception as error:
            print(f"Media API error: {error!r}")
            self._json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "error": "Не удалось создать или проверить итоговый видеофайл.", "detail": str(error)},
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="NexEstate Studio local static and media server")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    os.chdir(ROOT)
    server = ThreadingHTTPServer((args.bind, args.port), NexEstateHandler)
    print(f"NEX ESTATE Media Studio: http://{args.bind}:{args.port}/")
    print(f"FFmpeg: {ffmpeg_version() or 'не найден'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
