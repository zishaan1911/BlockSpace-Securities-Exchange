"""Environment-driven configuration for the AI service (ARCHITECTURE.md
§2). Copy .env.example to .env and fill in real values before running —
see setup.md and GLOSSARY.md's Golden Rules: private keys never go in
code, git, or logs. All settings are also overridable via
GASX_AI_-prefixed environment variables (e.g. GASX_AI_ETHEREUM_RPC_URL).
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="GASX_AI_", extra="ignore")

    # Ethereum ingestion (features/egsi.py's raw inputs).
    ethereum_rpc_url: str = "https://ethereum-rpc.publicnode.com"

    # Sui oracle publish (oracle/publisher.py; ARCHITECTURE.md §6). Leave
    # blank to disable publishing — /publish returns 501 until all three
    # are set. sui_publisher_private_key must be a Sui base64 keystring
    # for the address gasx::oracle::set_publisher authorized as this
    # market's oracle publisher.
    sui_rpc_url: str = "https://fullnode.testnet.sui.io:443"
    sui_publisher_private_key: str = ""
    sui_package_id: str = ""
    sui_oracle_object_id: str = ""

    # EGSI history / forecasting.
    egsi_history_max_len: int = 200

    # Seconds between automatic EGSI cycles. Defaults to 12, matching
    # Ethereum's block time — polling faster cannot surface new data
    # (there is no new block to read), it just burns RPC rate limit and
    # recomputes an identical score. Set to 0 to disable auto-cycling
    # and drive the service manually via POST /cycle.
    cycle_interval_seconds: float = 12.0


settings = Settings()
