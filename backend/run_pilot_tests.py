"""Run backend tests offline against disposable SQLite, never the host's records."""
import os
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="medsim-tests-") as directory:
        os.environ.update({
            "MEDSIM_DATABASE_PATH": str(Path(directory) / "tests.db"),
            "MEDSIM_ENVIRONMENT": "development", "MEDSIM_PILOT_MODE": "0",
            "MEDSIM_COOKIE_SECURE": "0", "MEDSIM_COOKIE_SAMESITE": "lax",
            "MEDSIM_LLM_PROVIDER": "openrouter", "MEDSIM_LOCAL_LLM_ENABLED": "false",
            "OPENROUTER_API_KEY": "offline-tests-network-blocked",
            "PATIENT_TTS_PROVIDER": "disabled", "PATIENT_TTS_FALLBACK": "disabled",
            "PATIENT_TTS_LANGUAGE": "en", "PATIENT_TTS_ENABLED": "false",
        })
        from semantic_dialogue_smoke import offline_connections

        with ExitStack() as stack:
            offline_connections(stack)
            suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent / "tests"),
                                                       pattern=sys.argv[1] if len(sys.argv) > 1 else "test_*.py")
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        sys.exit(0 if result.wasSuccessful() else 1)
