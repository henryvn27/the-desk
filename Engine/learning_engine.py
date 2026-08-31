#!/usr/bin/env python3
"""The Desk's local Mac engine.

Ordinary commands accept one JSON object on stdin and emit one JSON object on
stdout. The device-login session is a bounded NDJSON exchange so the pinned
Codex app-server can remain alive through OAuth completion or cancellation.
"""

from __future__ import annotations

import argparse
import codecs
import html
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Callable
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET


class EngineError(RuntimeError):
    pass


PINNED_PYTHON = (3, 14)
PINNED_CODEX_VERSION = "codex-cli 0.151.0-alpha.7.1"
PINNED_NOTEBOOKLM_VERSION = "0.8.1"
CODEX_LOGIN_TIMEOUT_SECONDS = 300
MAX_CODEX_STDOUT_TOTAL_BYTES = 16 * 1_024 * 1_024
MAX_CODEX_STDOUT_LINE_BYTES = 1 * 1_024 * 1_024
MAX_CODEX_STDERR_BYTES = 1 * 1_024 * 1_024
MAX_CODEX_ANSWER_BYTES = 2 * 1_024 * 1_024
MAX_CODEX_INPUT_BYTES = 4 * 1_024 * 1_024
MAX_NOTEBOOKLM_STDOUT_BYTES = 8 * 1_024 * 1_024
MAX_CHILD_STDERR_BYTES = 512 * 1_024
MAX_DOCUMENT_FILE_BYTES = 256 * 1_024 * 1_024
MAX_PLAIN_DOCUMENT_BYTES = 8 * 1_024 * 1_024
MAX_ARCHIVE_MEMBERS = 4_096
MAX_ARCHIVE_MEMBER_BYTES = 32 * 1_024 * 1_024
MAX_ARCHIVE_TOTAL_BYTES = 256 * 1_024 * 1_024
MAX_ARCHIVE_COMPRESSION_RATIO = 200
MAX_EXTRACTED_TEXT_BYTES = 8 * 1_024 * 1_024


class ProcessOutputLimit(EngineError):
    pass


class ProcessTimedOut(EngineError):
    pass


class BoundedProcessResult:
    def __init__(self, returncode: int, stdout: str, stderr: str) -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _terminate_process(process: subprocess.Popen[bytes], grace: float = 1.0) -> None:
    """Stop a child with bounded TERM/KILL waits."""
    if process.poll() is not None:
        return
    try:
        process.terminate()
    except OSError:
        pass
    try:
        process.wait(timeout=grace)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        process.kill()
    except OSError:
        pass
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        pass


class _BoundedStreamCapture:
    def __init__(
        self,
        stream: Any,
        limit: int,
        overflow: threading.Event,
        on_overflow: Callable[[], None],
    ) -> None:
        self.stream = stream
        self.limit = limit
        self.overflow = overflow
        self.on_overflow = on_overflow
        self.data = bytearray()
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._drain, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def join(self, timeout: float = 2.0) -> None:
        self.thread.join(timeout)

    def snapshot(self) -> bytes:
        with self.lock:
            return bytes(self.data)

    def _drain(self) -> None:
        try:
            while True:
                chunk = os.read(self.stream.fileno(), 64 * 1_024)
                if not chunk:
                    return
                with self.lock:
                    remaining = max(0, self.limit - len(self.data))
                    if remaining:
                        self.data.extend(chunk[:remaining])
                    exceeded = len(chunk) > remaining
                if exceeded:
                    if not self.overflow.is_set():
                        self.overflow.set()
                        self.on_overflow()
                    return
        except (OSError, ValueError):
            return


def run_bounded_process(
    command: list[str],
    *,
    timeout: float,
    stdout_limit: int,
    stderr_limit: int = MAX_CHILD_STDERR_BYTES,
) -> BoundedProcessResult:
    """Run a child while concurrently draining both pipes within hard caps."""
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )
    assert process.stdout and process.stderr
    overflow = threading.Event()

    def stop_on_overflow() -> None:
        try:
            process.terminate()
        except OSError:
            pass

    stdout = _BoundedStreamCapture(process.stdout, stdout_limit, overflow, stop_on_overflow)
    stderr = _BoundedStreamCapture(process.stderr, stderr_limit, overflow, stop_on_overflow)
    stdout.start()
    stderr.start()
    deadline = time.monotonic() + timeout
    timed_out = False
    try:
        while process.poll() is None:
            if overflow.is_set():
                break
            if time.monotonic() >= deadline:
                timed_out = True
                break
            time.sleep(0.02)
        if process.poll() is None:
            _terminate_process(process)
    except BaseException:
        _terminate_process(process)
        raise
    finally:
        stdout.join()
        stderr.join()

    if overflow.is_set():
        raise ProcessOutputLimit("A local connector exceeded The Desk's bounded output limit")
    if timed_out:
        raise ProcessTimedOut("A local connector did not respond before The Desk's timeout")
    return BoundedProcessResult(
        process.returncode,
        stdout.snapshot().decode("utf-8", errors="replace"),
        stderr.snapshot().decode("utf-8", errors="replace"),
    )


def require_pinned_python() -> None:
    if sys.version_info[:2] != PINNED_PYTHON:
        found = f"{sys.version_info.major}.{sys.version_info.minor}"
        raise EngineError(f"The Desk requires its pinned Python {PINNED_PYTHON[0]}.{PINNED_PYTHON[1]}.x runtime; found {found}")


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise EngineError("Input must be a JSON object")
    return value


def output(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _absolute_executable(raw: str | None) -> str | None:
    if not raw:
        return None
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        return None
    resolved = candidate.resolve()
    return str(resolved) if resolved.is_file() and os.access(resolved, os.X_OK) else None


def codex_candidate() -> str | None:
    explicit = os.environ.get("THE_DESK_CODEX") or os.environ.get("LEARNING_HOME_CODEX")
    if explicit:
        return _absolute_executable(explicit)
    bundled = Path("/Applications/ChatGPT.app/Contents/Resources/codex")
    if bundled.is_file() and os.access(bundled, os.X_OK):
        return str(bundled)
    return None


def executable_version(executable: str) -> str:
    try:
        result = run_bounded_process(
            [executable, "--version"],
            timeout=5,
            stdout_limit=16 * 1_024,
            stderr_limit=16 * 1_024,
        )
    except (OSError, ProcessTimedOut, ProcessOutputLimit) as error:
        raise EngineError("The pinned Codex runtime could not be inspected") from error
    return (result.stdout or result.stderr).strip()[:200]


def codex_executable() -> str | None:
    candidate = codex_candidate()
    if not candidate:
        return None
    return candidate if executable_version(candidate) == PINNED_CODEX_VERSION else None


def notebooklm_executable() -> str | None:
    explicit = os.environ.get("THE_DESK_NOTEBOOKLM")
    if explicit:
        return _absolute_executable(explicit)
    managed = Path.home() / "Library" / "Application Support" / "TheDesk" / "Engine" / "runtime" / "bin" / "notebooklm"
    return _absolute_executable(str(managed))


def notebooklm_version(executable: str) -> str:
    try:
        result = run_bounded_process(
            [executable, "--version"],
            timeout=5,
            stdout_limit=16 * 1_024,
            stderr_limit=16 * 1_024,
        )
    except (OSError, ProcessTimedOut, ProcessOutputLimit) as error:
        raise EngineError("The NotebookLM connector version could not be inspected") from error
    raw = (result.stdout or result.stderr).strip()
    if result.returncode != 0 or not raw:
        raise EngineError("The NotebookLM connector version could not be inspected")
    match = re.search(r"(?<![0-9])([0-9]+\.[0-9]+\.[0-9]+)(?![0-9])", raw)
    return match.group(1) if match else raw[:100]


def required_notebooklm_executable() -> str:
    executable = notebooklm_executable()
    if not executable:
        raise EngineError("NotebookLM setup is incomplete. Open NotebookLM in Integrations to finish setup.")
    found = notebooklm_version(executable)
    if found != PINNED_NOTEBOOKLM_VERSION:
        raise EngineError(f"The Desk requires notebooklm-py {PINNED_NOTEBOOKLM_VERSION}; found {found}")
    return executable


def codex_command(restricted_study: bool = False) -> list[str]:
    executable = codex_executable()
    if not executable:
        candidate = codex_candidate()
        if candidate:
            found = executable_version(candidate) or "unknown"
            raise EngineError(f"The Desk requires pinned {PINNED_CODEX_VERSION}; found {found}")
        raise EngineError("The Desk requires the pinned Codex runtime from /Applications/ChatGPT.app; install or update ChatGPT for Mac")
    # The explicit override keeps older local runtimes from rejecting a newer
    # machine-level reasoning-effort setting before the protocol can initialize.
    command = [executable, "app-server", "-c", 'model_reasoning_effort="high"']
    if restricted_study:
        # Study requests are text-only. Remove local/browser/tool surfaces before
        # starting app-server instead of relying on a model instruction alone.
        for feature in (
            "shell_tool",
            "unified_exec",
            "shell_snapshot",
            "apps",
            "browser_use",
            "computer_use",
            "in_app_browser",
            "workspace_dependencies",
            "skill_search",
            "view_image",
            "image_generation",
            "multi_agent",
        ):
            command.extend(["--disable", feature])
    return command


class CodexSession:
    def __init__(self, working_directory: str | None = None, restricted_study: bool = False) -> None:
        self.process = subprocess.Popen(
            codex_command(restricted_study=restricted_study),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=working_directory,
            bufsize=0,
        )
        if not self.process.stdin or not self.process.stdout or not self.process.stderr:
            raise EngineError("Could not open Codex app-server pipes")
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.read_buffer = bytearray()
        self.stdout_total = 0
        self.stderr_overflow = threading.Event()

        def stop_on_overflow() -> None:
            try:
                self.process.terminate()
            except OSError:
                pass

        self.stderr_capture = _BoundedStreamCapture(
            self.process.stderr,
            MAX_CODEX_STDERR_BYTES,
            self.stderr_overflow,
            stop_on_overflow,
        )
        self.stderr_capture.start()

    def close(self) -> None:
        try:
            if self.process.stdin:
                self.process.stdin.close()
        except OSError:
            pass
        _terminate_process(self.process)
        self.stderr_capture.join()
        self.selector.close()

    def _check_limits(self) -> None:
        if self.stderr_overflow.is_set():
            _terminate_process(self.process)
            raise ProcessOutputLimit("Codex app-server exceeded The Desk's stderr safety limit")
        if self.stdout_total > MAX_CODEX_STDOUT_TOTAL_BYTES:
            _terminate_process(self.process)
            raise ProcessOutputLimit("Codex app-server exceeded The Desk's stdout safety limit")
        if len(self.read_buffer) > MAX_CODEX_STDOUT_LINE_BYTES:
            _terminate_process(self.process)
            raise ProcessOutputLimit("Codex app-server returned an oversized protocol message")

    def send(self, message: dict[str, Any]) -> None:
        assert self.process.stdin
        self.process.stdin.write((json.dumps(message, separators=(",", ":")) + "\n").encode())
        self.process.stdin.flush()

    def read_optional(self, timeout: float = 30) -> dict[str, Any] | None:
        deadline = time.monotonic() + timeout
        while True:
            self._check_limits()
            newline = self.read_buffer.find(b"\n")
            if newline >= 0:
                if newline > MAX_CODEX_STDOUT_LINE_BYTES:
                    _terminate_process(self.process)
                    raise ProcessOutputLimit("Codex app-server returned an oversized protocol message")
                line = bytes(self.read_buffer[:newline])
                del self.read_buffer[: newline + 1]
                try:
                    value = json.loads(line)
                except json.JSONDecodeError as error:
                    raise EngineError("Codex app-server returned an invalid message") from error
                if not isinstance(value, dict):
                    raise EngineError("Codex app-server returned an invalid message")
                return value
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not self.selector.select(remaining):
                self._check_limits()
                return None
            assert self.process.stdout
            chunk = os.read(self.process.stdout.fileno(), 64 * 1024)
            if chunk:
                self.stdout_total += len(chunk)
                self.read_buffer.extend(chunk)
                self._check_limits()
                continue
            self.stderr_capture.join(0.2)
            self._check_limits()
            error = self.stderr_capture.snapshot().decode(errors="replace").strip()
            raise EngineError(error or "Codex app-server closed unexpectedly")

    def read(self, timeout: float = 30) -> dict[str, Any]:
        value = self.read_optional(timeout)
        if value is None:
            raise EngineError("Codex app-server did not respond in time")
        return value

    def wait_for(self, predicate: Callable[[dict[str, Any]], bool], timeout: float = 30) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            message = self.read(max(0.1, deadline - time.monotonic()))
            if "error" in message and "id" in message:
                error = message.get("error") or {}
                raise EngineError(str(error.get("message") or error))
            if predicate(message):
                return message
        raise EngineError("Codex app-server operation timed out")

    def initialize(self) -> None:
        self.send({
            "method": "initialize",
            "id": 0,
            "params": {
                "clientInfo": {
                    "name": "the_desk",
                    "title": "The Desk",
                    "version": "0.1.0",
                },
                "capabilities": {
                    "optOutNotificationMethods": ["thread/tokenUsage/updated"],
                },
            },
        })
        self.wait_for(lambda item: item.get("id") == 0)
        self.send({"method": "initialized", "params": {}})


def codex_account(_: dict[str, Any]) -> dict[str, Any]:
    session = CodexSession()
    try:
        session.initialize()
        session.send({"method": "account/read", "id": 1, "params": {"refreshToken": False}})
        response = session.wait_for(lambda item: item.get("id") == 1)
        return {"ok": True, "account": response.get("result") or {}}
    finally:
        session.close()


def codex_device_login_session() -> int:
    """Keep one app-server alive until device auth completes or is canceled."""
    session = CodexSession()
    control = selectors.DefaultSelector()
    try:
        control.register(sys.stdin, selectors.EVENT_READ)
        session.initialize()
        session.send({"method": "account/login/start", "id": 2, "params": {"type": "chatgptDeviceCode"}})
        response = session.wait_for(lambda item: item.get("id") == 2)
        result = response.get("result") or {}
        login_id = result.get("loginId")
        verification_url = result.get("verificationUrl")
        user_code = result.get("userCode")
        if not all(isinstance(value, str) and value for value in (login_id, verification_url, user_code)):
            raise EngineError("Codex returned an incomplete device sign-in response")
        output({
            "event": "started",
            "ok": True,
            "loginId": login_id,
            "verificationUrl": verification_url,
            "userCode": user_code,
            "note": "Complete sign-in in a browser. The Desk will confirm it automatically.",
        })

        deadline = time.monotonic() + CODEX_LOGIN_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if control.select(0):
                line = sys.stdin.readline()
                if not line:
                    session.send({"method": "account/login/cancel", "id": 3, "params": {"loginId": login_id}})
                    output({"event": "canceled", "ok": True, "loginId": login_id})
                    return 0
                command = json.loads(line)
                if not isinstance(command, dict):
                    raise EngineError("Codex login control input must be a JSON object")
                requested_id = command.get("loginId")
                if command.get("action") == "cancel" and requested_id in {None, login_id}:
                    session.send({"method": "account/login/cancel", "id": 3, "params": {"loginId": login_id}})
                    output({"event": "canceled", "ok": True, "loginId": login_id})
                    return 0

            message = session.read_optional(timeout=0.25)
            if message is None:
                continue
            if "error" in message and "id" in message:
                error = message.get("error") or {}
                raise EngineError(str(error.get("message") or error))
            if message.get("method") != "account/login/completed":
                continue
            params = message.get("params") or {}
            completed_id = params.get("loginId")
            if completed_id not in {None, login_id}:
                continue
            output({
                "event": "completed",
                "ok": True,
                "loginId": login_id,
                "success": bool(params.get("success")),
                "error": params.get("error"),
            })
            return 0

        session.send({"method": "account/login/cancel", "id": 3, "params": {"loginId": login_id}})
        output({
            "event": "timedOut",
            "ok": True,
            "loginId": login_id,
            "success": False,
            "error": "ChatGPT sign-in was not completed within five minutes.",
        })
        return 0
    finally:
        control.close()
        session.close()


def ask_codex(payload: dict[str, Any]) -> dict[str, Any]:
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise EngineError("A prompt is required")
    model = str(payload.get("model") or "").strip()
    context = str(payload.get("context") or "").strip()
    tutor_style = str(payload.get("tutorStyle") or "coachFirst")
    combined = (
        "You are the text-only tutor inside The Desk. Use only the material and request supplied below. "
        "Do not invoke shell, filesystem, MCP, web, or other tools. "
        "Never claim that an assignment was submitted or completed without explicit external evidence. "
        f"Tutor style: {tutor_style}.\n\n"
        f"CLASS MATERIAL\n{context or '(No class source was retrieved.)'}\n\n"
        f"STUDENT REQUEST\n{prompt}"
    )
    if len(combined.encode("utf-8")) > MAX_CODEX_INPUT_BYTES:
        raise ProcessOutputLimit("The retrieved study context exceeds The Desk's bounded Codex input limit")

    with tempfile.TemporaryDirectory(prefix="TheDesk-Codex-") as working_directory:
        os.chmod(working_directory, 0o700)
        session = CodexSession(working_directory=working_directory, restricted_study=True)
        try:
            session.initialize()
            thread_params: dict[str, Any] = {
                "cwd": working_directory,
                "approvalPolicy": "never",
                "sandbox": "read-only",
                "ephemeral": True,
                "serviceName": "the_desk",
                "baseInstructions": (
                    "Act only as a text tutor. Do not invoke tools, shell commands, filesystem access, "
                    "MCP, or web search. Use only the explicit user text provided in this turn."
                ),
                # Thread creation reloads the user's config. Pin a value supported by
                # the external reviewed protocol runtime so newer settings cannot break it.
                "config": {"model_reasoning_effort": "high"},
            }
            if model and model != "auto":
                thread_params["model"] = model
            session.send({"method": "thread/start", "id": 10, "params": thread_params})
            thread_response = session.wait_for(lambda item: item.get("id") == 10, timeout=45)
            thread_result = thread_response.get("result") or {}
            thread = thread_result.get("thread") or {}
            thread_id = thread.get("id")
            if not thread_id:
                raise EngineError("Codex did not create a study thread")
            session.send({
                "method": "turn/start",
                "id": 11,
                "params": {
                    "threadId": thread_id,
                    "input": [{"type": "text", "text": combined}],
                    "approvalPolicy": "never",
                    "sandboxPolicy": {"type": "readOnly", "networkAccess": False},
                },
            })
            session.wait_for(lambda item: item.get("id") == 11, timeout=45)

            answer = bytearray()
            model_used = thread_result.get("model") or thread.get("model") or (model if model != "auto" else None) or "Codex default"

            def append_answer(value: str) -> None:
                encoded = value.encode("utf-8")
                if len(answer) + len(encoded) > MAX_CODEX_ANSWER_BYTES:
                    _terminate_process(session.process)
                    raise ProcessOutputLimit("Codex returned more answer text than The Desk's safety limit allows")
                answer.extend(encoded)

            while True:
                message = session.read(timeout=180)
                method = message.get("method")
                params = message.get("params") or {}
                if method == "item/agentMessage/delta":
                    delta = params.get("delta")
                    if isinstance(delta, str):
                        append_answer(delta)
                elif method == "item/completed":
                    item = params.get("item") or {}
                    if item.get("type") == "agentMessage" and not answer:
                        text_value = item.get("text") or item.get("content")
                        if isinstance(text_value, str):
                            append_answer(text_value)
                elif method == "turn/completed":
                    turn = params.get("turn") or {}
                    status = turn.get("status") or "completed"
                    if status not in {"completed", "success"}:
                        raise EngineError(f"Codex turn ended with status {status}")
                    break
            return {
                "ok": True,
                "text": answer.decode("utf-8").strip(),
                "model": str(model_used)[:200],
                "threadId": str(thread_id)[:500],
            }
        finally:
            session.close()


def ensure_extracted_text_bound(text: str) -> str:
    if len(text.encode("utf-8")) > MAX_EXTRACTED_TEXT_BYTES:
        raise EngineError("The extracted document text exceeds The Desk's 8 MB safety limit")
    return text


def read_plain_document(path: Path) -> str:
    if path.stat().st_size > MAX_PLAIN_DOCUMENT_BYTES:
        raise EngineError("The document exceeds The Desk's 8 MB plain-text safety limit")
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    parts: list[str] = []
    total = 0
    with path.open("rb") as source:
        while chunk := source.read(64 * 1_024):
            total += len(chunk)
            if total > MAX_PLAIN_DOCUMENT_BYTES:
                raise EngineError("The document exceeds The Desk's 8 MB plain-text safety limit")
            parts.append(decoder.decode(chunk))
    parts.append(decoder.decode(b"", final=True))
    return ensure_extracted_text_bound("".join(parts))


def strip_xml_text(raw: bytes) -> str:
    if len(raw) > MAX_ARCHIVE_MEMBER_BYTES:
        raise EngineError("An archive member exceeds The Desk's safety limit")
    lowered = raw[:4_096].lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        raise EngineError("Archive XML declarations with entities are not supported")
    root = ET.fromstring(raw)
    parts: list[str] = []
    for node in root.iter():
        if node.text and node.text.strip():
            parts.append(node.text.strip())
        local_name = node.tag.rsplit("}", 1)[-1]
        if local_name in {"p", "br", "tr", "slide", "t"} and parts:
            parts.append("\n")
    text = " ".join(parts)
    return ensure_extracted_text_bound(re.sub(r"[ \t]+", " ", text).replace(" \n ", "\n").strip())


def validate_archive(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    infos = archive.infolist()
    if len(infos) > MAX_ARCHIVE_MEMBERS:
        raise EngineError("The document archive contains too many members")
    by_name: dict[str, zipfile.ZipInfo] = {}
    total = 0
    for info in infos:
        if info.filename in by_name:
            raise EngineError("The document archive contains duplicate member names")
        path = Path(info.filename)
        if path.is_absolute() or ".." in path.parts or info.flag_bits & 0x1:
            raise EngineError("The document archive contains an unsafe member")
        if info.file_size > MAX_ARCHIVE_MEMBER_BYTES:
            raise EngineError("A document archive member exceeds The Desk's 32 MB safety limit")
        total += info.file_size
        if total > MAX_ARCHIVE_TOTAL_BYTES:
            raise EngineError("The expanded document archive exceeds The Desk's 256 MB safety limit")
        if info.file_size > 1_024 * 1_024:
            compressed = max(1, info.compress_size)
            if info.file_size / compressed > MAX_ARCHIVE_COMPRESSION_RATIO:
                raise EngineError("The document archive has an unsafe compression ratio")
        by_name[info.filename] = info
    return by_name


def extract_zip_document(path: Path) -> tuple[str, int]:
    suffix = path.suffix.lower()
    if path.stat().st_size > MAX_DOCUMENT_FILE_BYTES:
        raise EngineError("The compressed document exceeds The Desk's 256 MB safety limit")
    with zipfile.ZipFile(path) as archive:
        members = validate_archive(archive)
        names = list(members)
        if suffix == ".docx":
            if "word/document.xml" not in members:
                raise EngineError("The DOCX document body is missing")
            return strip_xml_text(archive.read(members["word/document.xml"])), 0
        if suffix == ".pptx":
            slides = sorted(
                (name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
                key=lambda item: int(re.search(r"\d+", Path(item).stem).group()),
            )
            parts: list[str] = []
            total_text_bytes = 0
            for index, name in enumerate(slides, 1):
                part = f"[[page:{index}]]\n{strip_xml_text(archive.read(members[name]))}"
                total_text_bytes += len(part.encode("utf-8")) + (2 if parts else 0)
                if total_text_bytes > MAX_EXTRACTED_TEXT_BYTES:
                    raise EngineError("The extracted document text exceeds The Desk's 8 MB safety limit")
                parts.append(part)
            return ensure_extracted_text_bound("\n\n".join(parts)), len(slides)
        if suffix == ".epub":
            html_files = [name for name in names if Path(name).suffix.lower() in {".xhtml", ".html", ".htm"}]
            chapters: list[str] = []
            total_text_bytes = 0
            for index, name in enumerate(html_files, 1):
                raw = archive.read(members[name]).decode("utf-8", errors="ignore")
                raw = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.I | re.S)
                text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
                text = re.sub(r"\s+", " ", text).strip()
                if text:
                    part = f"[[page:{index}]]\n{text}"
                    total_text_bytes += len(part.encode("utf-8")) + (2 if chapters else 0)
                    if total_text_bytes > MAX_EXTRACTED_TEXT_BYTES:
                        raise EngineError("The extracted document text exceeds The Desk's 8 MB safety limit")
                    chapters.append(part)
            return ensure_extracted_text_bound("\n\n".join(chapters)), len(chapters)
    raise EngineError(f"Unsupported archive document: {suffix}")


def extract_document(payload: dict[str, Any]) -> dict[str, Any]:
    path = Path(str(payload.get("path") or "")).expanduser().resolve()
    if not path.is_file():
        raise EngineError("The source file does not exist")
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md", ".rtf", ".csv", ".json"}:
        text = read_plain_document(path)
        pages = 0
    elif suffix in {".docx", ".pptx", ".epub"}:
        text, pages = extract_zip_document(path)
    else:
        raise EngineError(f"The local engine cannot extract {suffix or 'this file type'}")
    return {"ok": True, "text": text, "pageCount": pages}


def run_notebooklm(arguments: list[str], timeout: float = 120) -> Any:
    cli = required_notebooklm_executable()
    try:
        result = run_bounded_process(
            [cli, "--quiet", *arguments],
            timeout=timeout,
            stdout_limit=MAX_NOTEBOOKLM_STDOUT_BYTES,
        )
    except ProcessTimedOut as error:
        raise EngineError("NotebookLM did not respond before the local timeout") from error
    except ProcessOutputLimit as error:
        raise EngineError("NotebookLM returned more data than The Desk's safety limit allows") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise EngineError(detail[:2_000] or f"notebooklm exited with status {result.returncode}")
    raw = result.stdout.strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise EngineError("notebooklm returned an unreadable response") from error


def _notebooklm_auth_probe(cli: str) -> tuple[str, str, bool]:
    try:
        result = run_bounded_process(
            [cli, "--quiet", "auth", "check", "--test", "--passive", "--json"],
            timeout=20,
            stdout_limit=256 * 1_024,
            stderr_limit=128 * 1_024,
        )
    except ProcessTimedOut:
        return "transientFailure", "NotebookLM's passive Google check timed out. Local study is unaffected; try again.", False
    except (OSError, ProcessOutputLimit):
        return "transientFailure", "NotebookLM could not be reached just now. Local study is unaffected; try again.", False

    raw = result.stdout.strip()
    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return "transientFailure", "NotebookLM returned an unreadable health response. Local study is unaffected; try again.", False
    if not isinstance(payload, dict):
        return "transientFailure", "NotebookLM returned an unreadable health response. Local study is unaffected; try again.", False

    status = payload.get("status")
    checks = payload.get("checks") if isinstance(payload.get("checks"), dict) else {}
    token_fetch = checks.get("token_fetch")
    if result.returncode == 0 and status in {"ok", "ready", "authenticated"} and token_fetch is True:
        return "healthy", "NotebookLM is connected and ready.", True

    local_auth_checks = ("storage_exists", "json_valid", "cookies_present", "sid_cookie")
    if any(checks.get(name) is False for name in local_auth_checks):
        return "authenticationRequired", "The connector is installed. Complete the one-time Google sign-in, then check again.", False

    diagnostic = json.dumps(payload, ensure_ascii=False).lower() + " " + result.stderr.lower()
    credential_markers = (
        "cookie expired",
        "cookies expired",
        "missing required cookie",
        "not logged in",
        "login required",
        "run notebooklm login",
        "redirected to sign-in",
        "redirected to signin",
        "credentials expired",
    )
    if any(marker in diagnostic for marker in credential_markers):
        return "authenticationRequired", "The connector is installed, but its Google session needs to be refreshed.", False
    return "transientFailure", "NotebookLM's passive Google check did not complete. Local study is unaffected; try again.", False


def notebooklm_health(_: dict[str, Any]) -> dict[str, Any]:
    cli = notebooklm_executable()
    authenticated = False
    state = "packageMissing"
    detail = "The optional NotebookLM connector is not installed yet. Local study remains available."
    version = None
    if cli:
        try:
            version = notebooklm_version(cli)
            if version != PINNED_NOTEBOOKLM_VERSION:
                state = "packageMissing"
                detail = f"The Desk requires notebooklm-py {PINNED_NOTEBOOKLM_VERSION}; version {version} is installed."
                cli = None
            else:
                state, detail, authenticated = _notebooklm_auth_probe(cli)
        except (EngineError, OSError) as error:
            state = "transientFailure"
            detail = "The NotebookLM connector could not be inspected. Local study is unaffected; try again."
    return {
        "ok": True,
        "available": bool(cli),
        "authenticated": authenticated,
        "module": "notebooklm" if cli else None,
        "cli": cli,
        "state": state,
        "version": version,
        "requiredVersion": PINNED_NOTEBOOKLM_VERSION,
        "detail": detail,
    }


def notebooklm_list(_: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "result": run_notebooklm(["list", "--json"], timeout=45)}


def notebooklm_create(payload: dict[str, Any]) -> dict[str, Any]:
    title = str(payload.get("title") or "").strip()
    if not title:
        raise EngineError("A notebook title is required")
    return {"ok": True, "result": run_notebooklm(["create", title, "--json"], timeout=60)}


def notebooklm_add_source(payload: dict[str, Any]) -> dict[str, Any]:
    notebook_id = str(payload.get("notebookID") or "").strip()
    raw_path = str(payload.get("path") or "").strip()
    if not notebook_id:
        raise EngineError("A NotebookLM notebook ID is required")
    path = Path(raw_path).expanduser().resolve()
    if not path.is_file():
        raise EngineError("The mirrored source file does not exist")
    return {
        "ok": True,
        "result": run_notebooklm(
            ["source", "add", str(path), "-n", notebook_id, "--json", "--timeout", "300"],
            timeout=330,
        ),
    }


def notebooklm_ask(payload: dict[str, Any]) -> dict[str, Any]:
    notebook_id = str(payload.get("notebookID") or "").strip()
    prompt = str(payload.get("prompt") or "").strip()
    if not notebook_id or not prompt:
        raise EngineError("A notebook ID and question are required")
    arguments = ["ask", prompt, "-n", notebook_id, "--json", "--request-timeout", "180"]
    source_ids = payload.get("sourceIDs") or []
    if not isinstance(source_ids, list):
        raise EngineError("sourceIDs must be a list")
    for source_id in source_ids[:100]:
        value = str(source_id).strip()
        if value:
            arguments.extend(["-s", value])
    return {"ok": True, "result": run_notebooklm(arguments, timeout=210)}


def health(_: dict[str, Any]) -> dict[str, Any]:
    candidate = codex_candidate()
    version = executable_version(candidate) if candidate else None
    codex = candidate if version == PINNED_CODEX_VERSION else None
    notebook = notebooklm_health({})
    return {
        "ok": True,
        "python": sys.version.split()[0],
        "codex": {"available": bool(codex), "path": codex, "version": version},
        "notebooklm": notebook,
    }


COMMANDS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "health": health,
    "codex-account": codex_account,
    "ask-codex": ask_codex,
    "extract": extract_document,
    "notebooklm-health": notebooklm_health,
    "notebooklm-list": notebooklm_list,
    "notebooklm-create": notebooklm_create,
    "notebooklm-add-source": notebooklm_add_source,
    "notebooklm-ask": notebooklm_ask,
}
STREAMING_COMMANDS = {"codex-device-login-session"}


def main() -> int:
    parser = argparse.ArgumentParser(description="The Desk local engine")
    parser.add_argument("command", choices=sorted(set(COMMANDS) | STREAMING_COMMANDS))
    args = parser.parse_args()
    previous_sigterm = signal.getsignal(signal.SIGTERM)

    def cancel_engine(_: int, __: Any) -> None:
        raise EngineError("The local engine was canceled")

    signal.signal(signal.SIGTERM, cancel_engine)
    try:
        require_pinned_python()
        if args.command == "codex-device-login-session":
            return codex_device_login_session()
        result = COMMANDS[args.command](read_payload())
        output(result)
        return 0
    except (EngineError, OSError, ValueError, json.JSONDecodeError, zipfile.BadZipFile, ET.ParseError) as error:
        output({"ok": False, "error": str(error), "errorType": type(error).__name__})
        return 1
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == "__main__":
    raise SystemExit(main())
