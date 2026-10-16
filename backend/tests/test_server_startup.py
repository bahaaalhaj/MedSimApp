"""Offline startup regressions: no real credentials, requests, or model loads."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


BACKEND = Path(__file__).resolve().parents[1]
MODEL = "nvidia/nemotron-3.5-super-vl:free"


class ServerEnvironmentStartupTests(unittest.TestCase):
    def launch(self, cwd: Path, *, direct: bool = False, overrides=None):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory)
            # Redirect only the environment-file location. The real configuration
            # parser, entry point, runtime and singleton are exercised unchanged.
            (fixture / ".env.local").write_text(
                "MEDSIM_LLM_PROVIDER=openrouter\n"
                f"OPENROUTER_MODEL={MODEL}\n"
                "OPENROUTER_API_KEY=file-key\n"
                "OPENROUTER_MAX_RETRIES=0\n"
                "MEDSIM_LOCAL_LLM_ENABLED=false\n"
                "MEDSIM_SEMANTIC_DIALOGUE_ENABLED=true\n"
                "PATIENT_TTS_ENABLED=false\n",
                encoding="utf-8",
            )
            env = {key: value for key, value in os.environ.items()
                   if not key.startswith(("OPENROUTER_", "MEDSIM_", "PATIENT_TTS_"))
                   and key not in {"BACKEND_SHARED_SECRET", "RENDER"}}
            env["MEDSIM_DATABASE_PATH"] = str(fixture / "accounts.db")
            env.update(overrides or {})
            code = f"""
import json, runpy, socket, sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, {str(BACKEND)!r})
from medsim_backend import config
config.__file__ = str(Path({str(fixture)!r}) / 'medsim_backend' / 'config.py')
with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')), \
     patch.object(socket, 'getaddrinfo', side_effect=AssertionError('Network forbidden')):
    if {direct!r}:
        with patch('uvicorn.run') as run:
            runpy.run_path({str(BACKEND / 'server.py')!r}, run_name='__main__')
            assert run.call_count == 1
            assert run.call_args.kwargs['port'] == 8787
    else:
        import server
    from local_llm import settings, get_local_llm_provider
    configured = settings()
    assert get_local_llm_provider().delegate.settings is configured
    print(json.dumps({{'model': configured.patient_model,
        'hasExpectedFixtureKey': configured.api_key == 'file-key',
        'innerSeconds': configured.patient_timeout_seconds,
        'outerSeconds': configured.hosted_semantic_timeout_seconds,
        'heavyModulesLoaded': any(name in sys.modules for name in ('torch', 'kokoro'))}}))
"""
            result = subprocess.run([sys.executable, "-c", code], cwd=cwd, env=env,
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout.strip())

    def assert_configured(self, result):
        self.assertEqual(result["model"], MODEL)
        self.assertTrue(result["hasExpectedFixtureKey"])
        self.assertEqual((result["innerSeconds"], result["outerSeconds"]), (3, 3.2))
        self.assertFalse(result["heavyModulesLoaded"])

    def test_server_import_loads_env_before_provider_from_both_working_directories(self):
        for cwd in (BACKEND.parent, BACKEND):
            with self.subTest(cwd=cwd):
                self.assert_configured(self.launch(cwd))

    def test_direct_entry_point_loads_env_before_provider_from_both_directories(self):
        for cwd in (BACKEND.parent, BACKEND):
            with self.subTest(cwd=cwd):
                self.assert_configured(self.launch(cwd, direct=True))

    def test_explicit_process_configuration_still_wins_over_env_file(self):
        result = self.launch(BACKEND.parent, overrides={
            "OPENROUTER_MODEL": "google/gemma-4-26b-a4b-it:free",
            "OPENROUTER_API_KEY": "process-key",
        })
        self.assertEqual(result["model"], "google/gemma-4-26b-a4b-it:free")
        self.assertFalse(result["hasExpectedFixtureKey"])
        self.assertFalse(result["heavyModulesLoaded"])


if __name__ == "__main__":
    unittest.main()
