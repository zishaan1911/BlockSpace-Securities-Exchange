"""Environment-driven configuration for the AI service (ARCHITECTURE.md
§2). Copy .env.example to .env and fill in real values before running —
see setup.md and GLOSSARY.md's Golden Rules: private keys never go in
code, git, or logs. All settings are also overridable via
GASX_AI_-prefixed environment variables (e.g. GASX_AI_ETHEREUM_RPC_URL).
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Anchored to this file's own directory, not the process CWD.
# pydantic-settings resolves a relative env_file against the CWD, and
# main.py documents running uvicorn from the repo root
# (`uvicorn main:app --app-dir ai`), where a bare ".env" resolved to
# <repo-root>/.env — which doesn't exist, so settings silently fell back
# to their defaults.
_ENV_FILE = Path(__file__).resolve().parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_prefix="GASX_AI_", extra="ignore")

    # Ethereum ingestion (features/egsi.py's raw inputs).
    ethereum_rpc_url: str = "https://ethereum-rpc.publicnode.com"

    # EGSI history / forecasting.
    egsi_history_max_len: int = 200

    # Seconds between automatic EGSI cycles. Defaults to 12, matching
    # Ethereum's block time — polling faster cannot surface new data
    # (there is no new block to read), it just burns RPC rate limit and
    # recomputes an identical score. Set to 0 to disable auto-cycling
    # and drive the service manually via POST /cycle.
    cycle_interval_seconds: float = 12.0

    # Serve the trained model even when it did not beat its naive
    # baselines out-of-sample. ARCHITECTURE.md §4 says to ship the
    # baseline in that case, and on measured data the baseline really is
    # more accurate (MAE 46.5 vs 49.7). Enabling this is a deliberate
    # product decision to show the model's own output anyway; the
    # forecast is then labelled "-unvalidated" so nothing downstream can
    # mistake it for a model that passed the gate.
    serve_unvalidated_model: bool = False


settings = Settings()
