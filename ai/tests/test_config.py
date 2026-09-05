"""config.py's .env handling. The regression these guard against: the
env_file was once the bare relative path ".env", which
pydantic-settings resolves against the process CWD. Running the AI
service from the repo root (main.py documents `uvicorn main:app
--app-dir ai`) then silently missed ai/.env entirely, so every setting
fell back to its default."""
from pathlib import Path

import config


def test_env_file_is_anchored_to_config_py_directory():
    env_file = config.Settings.model_config["env_file"]
    expected = Path(config.__file__).resolve().parent / ".env"
    assert env_file == str(expected)


def test_settings_read_env_file_values_independent_of_cwd(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "GASX_AI_ETHEREUM_RPC_URL=https://example-rpc.local\n"
        "GASX_AI_EGSI_HISTORY_MAX_LEN=250\n"
        "GASX_AI_CYCLE_INTERVAL_SECONDS=42\n"
    )
    # Real environment variables outrank the env file in
    # pydantic-settings; drop them so the assertion tests the file, not
    # the ambient shell.
    for name in (
        "GASX_AI_ETHEREUM_RPC_URL",
        "GASX_AI_EGSI_HISTORY_MAX_LEN",
        "GASX_AI_CYCLE_INTERVAL_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)

    somewhere_else = tmp_path / "some-other-cwd"
    somewhere_else.mkdir()
    monkeypatch.chdir(somewhere_else)

    settings = config.Settings(_env_file=str(env_file))

    assert settings.ethereum_rpc_url == "https://example-rpc.local"
    assert settings.egsi_history_max_len == 250
    assert settings.cycle_interval_seconds == 42
