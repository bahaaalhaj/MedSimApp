"""Vercel ASGI entry. Intentionally does not import backend.server/runtime."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from medsim_backend.demo_runtime import create_demo_runtime  # noqa: E402

app = create_demo_runtime().app
