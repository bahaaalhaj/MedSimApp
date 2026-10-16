"""Presentation launcher: load existing secrets before the provider is imported.

The PowerShell launcher supplies non-secret local overrides in the child process.
No environment file is written and no hosted credential is removed.
"""
from medsim_backend.config import load_env_local


if __name__ == "__main__":
    load_env_local()
    from local_llm import settings
    if settings().provider != "llama_cpp" or not settings().local_llm_enabled:
        raise SystemExit("This launcher requires the explicitly enabled llama_cpp provider.")
    import server
    import uvicorn
    uvicorn.run(server.app, host="127.0.0.1", port=8787, log_level="info")
