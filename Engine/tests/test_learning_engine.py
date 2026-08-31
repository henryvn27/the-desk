import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "learning_engine.py"
RUNTIME_LOCK = ROOT / "runtime-lock.json"


def run_engine(command: str, payload: dict | None = None, environment: dict[str, str] | None = None) -> tuple[int, dict]:
    env = os.environ.copy()
    if environment:
        env.update(environment)
    result = subprocess.run(
        [sys.executable, str(ENGINE), command],
        input=json.dumps(payload or {}),
        text=True,
        capture_output=True,
        check=False,
        env=env,
        timeout=20,
    )
    return result.returncode, json.loads(result.stdout)


def write_executable(path: Path, body: str) -> Path:
    path.write_text(f"#!{sys.executable}\n" + textwrap.dedent(body))
    path.chmod(0o755)
    return path


class LearningEngineTests(unittest.TestCase):
    def test_runtime_lock_matches_engine_contract(self) -> None:
        lock = json.loads(RUNTIME_LOCK.read_text())
        self.assertEqual((lock["python"]["major"], lock["python"]["minor"]), (3, 14))
        self.assertEqual(lock["codex"]["version"], "codex-cli 0.151.0-alpha.7.1")

    def test_health_has_stable_shape(self) -> None:
        code, result = run_engine(
            "health",
            environment={"THE_DESK_NOTEBOOKLM": "/definitely/missing/notebooklm"},
        )
        self.assertEqual(code, 0)
        self.assertTrue(result["ok"])
        self.assertIn("available", result["codex"])
        self.assertIn("available", result["notebooklm"])
        self.assertIn("authenticated", result["notebooklm"])
        self.assertIn(result["notebooklm"]["state"], {"packageMissing", "authenticationRequired", "healthy", "transientFailure"})
        self.assertEqual(result["notebooklm"]["requiredVersion"], "0.8.1")

    def test_notebooklm_cli_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cli = Path(directory) / "notebooklm"
            cli.write_text(
                "#!/usr/bin/env python3\n"
                "import json, sys\n"
                "args = sys.argv[1:]\n"
                "if '--version' in args: print('notebooklm, version 0.8.1')\n"
                "elif 'auth' in args: print(json.dumps({'status': 'ok', 'checks': {'token_fetch': True}}))\n"
                "elif 'list' in args: print(json.dumps({'notebooks': [{'id': 'nb-1', 'title': 'Physics'}]}))\n"
                "else: print(json.dumps({'success': True}))\n"
            )
            cli.chmod(0o755)
            env = {"THE_DESK_NOTEBOOKLM": str(cli)}
            health_code, health = run_engine("notebooklm-health", environment=env)
            list_code, listed = run_engine("notebooklm-list", environment=env)
        self.assertEqual(health_code, 0)
        self.assertTrue(health["authenticated"])
        self.assertEqual(health["state"], "healthy")
        self.assertEqual(list_code, 0)
        self.assertEqual(listed["result"]["notebooks"][0]["id"], "nb-1")

    def test_notebooklm_health_distinguishes_setup_auth_transient_and_version_states(self) -> None:
        missing_code, missing = run_engine(
            "notebooklm-health",
            environment={"THE_DESK_NOTEBOOKLM": "/definitely/missing/notebooklm"},
        )
        self.assertEqual(missing_code, 0)
        self.assertFalse(missing["available"])
        self.assertEqual(missing["state"], "packageMissing")

        with tempfile.TemporaryDirectory() as directory:
            cli = Path(directory) / "notebooklm"
            cli.write_text(
                "#!/usr/bin/env python3\n"
                "import json, sys\n"
                "if '--version' in sys.argv:\n"
                "    print('notebooklm, version 0.8.1')\n"
                "else:\n"
                "    print(json.dumps({'status': 'error', 'checks': {'storage_exists': True, 'json_valid': True, 'cookies_present': True, 'sid_cookie': True, 'token_fetch': False}, 'errors': ['Cookies expired; run notebooklm login']}))\n"
                "    raise SystemExit(1)\n"
            )
            cli.chmod(0o755)
            auth_code, auth = run_engine(
                "notebooklm-health",
                environment={"THE_DESK_NOTEBOOKLM": str(cli)},
            )
            cli.write_text(
                "#!/usr/bin/env python3\n"
                "import json, sys\n"
                "if '--version' in sys.argv:\n"
                "    print('notebooklm, version 0.8.1')\n"
                "else:\n"
                "    print(json.dumps({'status': 'error', 'auth_source': 'file', 'checks': {'storage_exists': True, 'json_valid': True, 'cookies_present': True, 'sid_cookie': True, 'token_fetch': False}, 'errors': ['Network timeout contacting Google']}))\n"
                "    raise SystemExit(1)\n"
            )
            cli.chmod(0o755)
            transient_code, transient = run_engine(
                "notebooklm-health",
                environment={"THE_DESK_NOTEBOOKLM": str(cli)},
            )
            cli.write_text("#!/bin/sh\necho 'notebooklm, version 9.9.9'\n")
            cli.chmod(0o755)
            mismatch_code, mismatch = run_engine(
                "notebooklm-health",
                environment={"THE_DESK_NOTEBOOKLM": str(cli)},
            )
        self.assertEqual(auth_code, 0)
        self.assertEqual(auth["state"], "authenticationRequired")
        self.assertEqual(transient_code, 0)
        self.assertEqual(transient["state"], "transientFailure")
        self.assertEqual(mismatch_code, 0)
        self.assertEqual(mismatch["state"], "packageMissing")
        self.assertFalse(mismatch["available"])

    def test_codex_path_lookup_is_fail_closed_and_version_pinned(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "codex"
            fake.write_text("#!/bin/sh\necho 'codex-cli unreviewed'\n")
            fake.chmod(0o755)
            path_code, path_result = run_engine("health", environment={"PATH": directory})
            override_code, override_result = run_engine("health", environment={"THE_DESK_CODEX": str(fake)})
        self.assertEqual(path_code, 0)
        self.assertNotEqual(path_result["codex"].get("path"), str(fake))
        self.assertEqual(override_code, 0)
        self.assertFalse(override_result["codex"]["available"])
        self.assertEqual(override_result["codex"]["version"], "codex-cli unreviewed")

    def test_notebooklm_output_is_bounded_on_both_pipes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cli = Path(directory) / "notebooklm"
            write_executable(
                cli,
                """
                import sys, time
                if '--version' in sys.argv:
                    print('notebooklm, version 0.8.1')
                elif 'list' in sys.argv:
                    stream = sys.stderr if 'stderr' in sys.argv else sys.stdout
                    stream.write('x' * (9 * 1024 * 1024))
                    stream.flush()
                    time.sleep(10)
                """,
            )
            started = time.monotonic()
            stdout_code, stdout_result = run_engine(
                "notebooklm-list",
                environment={"THE_DESK_NOTEBOOKLM": str(cli)},
            )
            stdout_elapsed = time.monotonic() - started

            write_executable(
                cli,
                """
                import sys, time
                if '--version' in sys.argv:
                    print('notebooklm, version 0.8.1')
                elif 'list' in sys.argv:
                    sys.stderr.write('x' * (1024 * 1024))
                    sys.stderr.flush()
                    time.sleep(10)
                """,
            )
            started = time.monotonic()
            stderr_code, stderr_result = run_engine(
                "notebooklm-list",
                environment={"THE_DESK_NOTEBOOKLM": str(cli)},
            )
            stderr_elapsed = time.monotonic() - started

        self.assertEqual(stdout_code, 1)
        self.assertIn("safety limit", stdout_result["error"])
        self.assertLess(stdout_elapsed, 5)
        self.assertEqual(stderr_code, 1)
        self.assertIn("safety limit", stderr_result["error"])
        self.assertLess(stderr_elapsed, 5)

    def test_codex_protocol_pipes_and_answer_are_bounded(self) -> None:
        cases = {
            "stdout_line": "sys.stdout.write('x' * (2 * 1024 * 1024)); sys.stdout.flush(); time.sleep(10)",
            "stdout_total": "line = json.dumps({'noise': 'x' * 900}) + '\\n'; sys.stdout.write(line * 20000); sys.stdout.flush(); time.sleep(10)",
            "stderr": "sys.stderr.write('x' * (2 * 1024 * 1024)); sys.stderr.flush(); time.sleep(10)",
        }
        for name, action in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                codex = Path(directory) / "codex"
                write_executable(
                    codex,
                    f"""
                    import json, sys, time
                    if '--version' in sys.argv:
                        print('codex-cli 0.151.0-alpha.7.1')
                        raise SystemExit
                    {action}
                    """,
                )
                started = time.monotonic()
                code, result = run_engine("codex-account", environment={"THE_DESK_CODEX": str(codex)})
                elapsed = time.monotonic() - started
                self.assertEqual(code, 1)
                self.assertTrue("limit" in result["error"] or "oversized" in result["error"])
                self.assertLess(elapsed, 5)

        with tempfile.TemporaryDirectory() as directory:
            codex = Path(directory) / "codex"
            write_executable(
                codex,
                """
                import json, sys
                if '--version' in sys.argv:
                    print('codex-cli 0.151.0-alpha.7.1')
                    raise SystemExit
                for line in sys.stdin:
                    message = json.loads(line)
                    method = message.get('method')
                    if method == 'initialize':
                        print(json.dumps({'id': message['id'], 'result': {}}), flush=True)
                    elif method == 'thread/start':
                        print(json.dumps({'id': message['id'], 'result': {'thread': {'id': 'thread-1'}, 'model': 'fake'}}), flush=True)
                    elif method == 'turn/start':
                        print(json.dumps({'id': message['id'], 'result': {'turn': {'id': 'turn-1'}}}), flush=True)
                        delta = 'a' * (256 * 1024)
                        for _ in range(9):
                            print(json.dumps({'method': 'item/agentMessage/delta', 'params': {'delta': delta}}), flush=True)
                """,
            )
            code, result = run_engine(
                "ask-codex",
                {"prompt": "Explain", "context": "Retrieved passage", "tutorStyle": "coachFirst", "model": "auto"},
                {"THE_DESK_CODEX": str(codex)},
            )
        self.assertEqual(code, 1)
        self.assertIn("answer text", result["error"])

    def test_codex_study_request_excludes_unrelated_data_and_deletes_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / "home"
            data_store = home / "Library" / "Application Support" / "TheDesk"
            data_store.mkdir(parents=True)
            canary = "PRIVATE-CANARY-MUST-NOT-BE-SENT"
            (data_store / "private-canary.txt").write_text(canary)
            record = root / "workspace.json"
            codex = write_executable(
                root / "codex",
                """
                import json, os
                from pathlib import Path
                import sys
                if '--version' in sys.argv:
                    print('codex-cli 0.151.0-alpha.7.1')
                    raise SystemExit
                restricted = '--disable' in sys.argv and 'shell_tool' in sys.argv
                for line in sys.stdin:
                    message = json.loads(line)
                    method = message.get('method')
                    if method == 'initialize':
                        print(json.dumps({'id': message['id'], 'result': {}}), flush=True)
                    elif method == 'thread/start':
                        params = message['params']
                        cwd = Path(params['cwd'])
                        private_root = Path.home() / 'Library' / 'Application Support' / 'TheDesk'
                        checks = {
                            'sameCWD': cwd.resolve() == Path.cwd().resolve(),
                            'isDirectory': cwd.is_dir(),
                            'empty': list(cwd.iterdir()) == [],
                            'outsideDataStore': private_root not in cwd.parents,
                            'readOnly': params.get('sandbox') == 'read-only',
                            'neverApprove': params.get('approvalPolicy') == 'never',
                            'shellDisabled': restricted,
                        }
                        Path(os.environ['FAKE_CODEX_RECORD']).write_text(json.dumps({'cwd': str(cwd), 'safe': all(checks.values()), 'checks': checks}))
                        print(json.dumps({'id': message['id'], 'result': {'thread': {'id': 'thread-1'}, 'model': 'fake'}}), flush=True)
                    elif method == 'turn/start':
                        params = message['params']
                        prompt = params['input'][0]['text']
                        safe = (
                            params.get('approvalPolicy') == 'never'
                            and params.get('sandboxPolicy') == {'type': 'readOnly', 'networkAccess': False}
                            and 'PRIVATE-CANARY-MUST-NOT-BE-SENT' not in prompt
                            and 'Retrieved passage only' in prompt
                        )
                        if not safe:
                            print(json.dumps({'id': message['id'], 'error': {'message': 'privacy boundary failed'}}), flush=True)
                            continue
                        print(json.dumps({'id': message['id'], 'result': {'turn': {'id': 'turn-1'}}}), flush=True)
                        print(json.dumps({'method': 'item/agentMessage/delta', 'params': {'delta': 'Grounded answer'}}), flush=True)
                        print(json.dumps({'method': 'turn/completed', 'params': {'turn': {'status': 'completed'}}}), flush=True)
                """,
            )
            code, result = run_engine(
                "ask-codex",
                {"prompt": "Explain", "context": "Retrieved passage only", "tutorStyle": "coachFirst", "model": "auto"},
                {
                    "HOME": str(home),
                    "THE_DESK_CODEX": str(codex),
                    "FAKE_CODEX_RECORD": str(record),
                },
            )
            evidence = json.loads(record.read_text())
            workspace = Path(evidence["cwd"])
            self.assertEqual(code, 0)
            self.assertEqual(result["text"], "Grounded answer")
            self.assertTrue(evidence["safe"], evidence["checks"])
            self.assertFalse(workspace.exists())

    def test_device_login_cancel_stops_uncooperative_app_server(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pid_file = root / "app-server.pid"
            codex = write_executable(
                root / "codex",
                """
                import json, os, signal, sys, time
                if '--version' in sys.argv:
                    print('codex-cli 0.151.0-alpha.7.1')
                    raise SystemExit
                open(os.environ['FAKE_CODEX_PID'], 'w').write(str(os.getpid()))
                for line in sys.stdin:
                    message = json.loads(line)
                    if message.get('method') == 'initialize':
                        print(json.dumps({'id': message['id'], 'result': {}}), flush=True)
                    elif message.get('method') == 'account/login/start':
                        print(json.dumps({'id': message['id'], 'result': {'loginId': 'login-1', 'verificationUrl': 'https://example.com/device', 'userCode': 'ABCD-EFGH'}}), flush=True)
                        signal.signal(signal.SIGTERM, signal.SIG_IGN)
                """,
            )
            env = os.environ.copy()
            env.update({"THE_DESK_CODEX": str(codex), "FAKE_CODEX_PID": str(pid_file)})
            process = subprocess.Popen(
                [sys.executable, str(ENGINE), "codex-device-login-session"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
            )
            assert process.stdin and process.stdout
            started = json.loads(process.stdout.readline())
            self.assertEqual(started["event"], "started")
            began_cancel = time.monotonic()
            process.stdin.write(json.dumps({"action": "cancel", "loginId": "login-1"}) + "\n")
            process.stdin.flush()
            process.wait(timeout=4)
            elapsed = time.monotonic() - began_cancel
            child_pid = int(pid_file.read_text())
            process.stdin.close()
            process.stdout.close()
            if process.stderr:
                process.stderr.close()
            with self.assertRaises(ProcessLookupError):
                os.kill(child_pid, 0)
            self.assertEqual(process.returncode, 0)
            self.assertLess(elapsed, 3)

    def test_extracts_plain_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "notes.md"
            path.write_text("Projectile motion keeps horizontal velocity constant.")
            code, result = run_engine("extract", {"path": str(path)})
        self.assertEqual(code, 0)
        self.assertIn("horizontal velocity", result["text"])

    def test_extracts_docx_xml_without_dependency(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "notes.docx"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Mean and standard deviation</w:t></w:r></w:p></w:body></w:document>',
                )
            code, result = run_engine("extract", {"path": str(path)})
        self.assertEqual(code, 0)
        self.assertIn("standard deviation", result["text"])

    def test_rejects_oversized_plain_text_without_reading_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "oversized.txt"
            with path.open("wb") as source:
                source.truncate(8 * 1024 * 1024 + 1)
            code, result = run_engine("extract", {"path": str(path)})
        self.assertEqual(code, 1)
        self.assertIn("safety limit", result["error"])

    def test_rejects_high_ratio_document_archive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bomb.docx"
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("word/document.xml", b"A" * (2 * 1024 * 1024))
            code, result = run_engine("extract", {"path": str(path)})
        self.assertEqual(code, 1)
        self.assertIn("compression ratio", result["error"])

    def test_many_member_presentation_stays_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "many-slides.pptx"
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for index in range(1, 1_001):
                    archive.writestr(
                        f"ppt/slides/slide{index}.xml",
                        f'<p:sld xmlns:p="urn:test"><p:t>Slide {index}</p:t></p:sld>',
                    )
            started = time.monotonic()
            code, result = run_engine("extract", {"path": str(path)})
            elapsed = time.monotonic() - started
        self.assertEqual(code, 0)
        self.assertEqual(result["pageCount"], 1_000)
        self.assertLess(elapsed, 5)

    def test_rejects_missing_file(self) -> None:
        code, result = run_engine("extract", {"path": "/definitely/missing.pdf"})
        self.assertEqual(code, 1)
        self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()
