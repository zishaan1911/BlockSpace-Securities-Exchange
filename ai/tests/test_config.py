"""config.py's .env handling. The regression these guard against: the
env_file was once the bare relative path ".env", which
pydantic-settings resolves against the process CWD. Running the AI
service from the repo root (main.py documents `uvicorn main:app
--app-dir ai`) then silently missed ai/.env entirely — the Sui oracle
publishing settings read as empty and POST /publish returned 501
"oracle publishing not configured" despite a correctly filled-in
ai/.env."""
from pathlib import Path

import config


def test_env_file_is_anchored_to_config_py_directory():
    env_file = config.Settings.model_config["env_file"]
    expected = Path(config.__file__).resolve().parent / ".env"
    assert env_file == str(expected)


def test_settings_read_env_file_values_independent_of_cwd(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "GASX_AI_SUI_PUBLISHER_PRIVATE_KEY=FAKEKEY\n"
        "GASX_AI_SUI_PACKAGE_ID=0xPKG\n"
        "GASX_AI_SUI_ORACLE_OBJECT_ID=0xORACLE\n"
    )
    # Real environment variables outrank the env file in
    # pydantic-settings; drop them so the assertion tests the file, not
    # the ambient shell.
    for name in (
        "GASX_AI_SUI_PUBLISHER_PRIVATE_KEY",
        "GASX_AI_SUI_PACKAGE_ID",
        "GASX_AI_SUI_ORACLE_OBJECT_ID",
    ):
        monkeypatch.delenv(name, raising=False)

    somewhere_else = tmp_path / "some-other-cwd"
    somewhere_else.mkdir()
    monkeypatch.chdir(somewhere_else)

    settings = config.Settings(_env_file=str(env_file))

    assert settings.sui_publisher_private_key == "FAKEKEY"
    assert settings.sui_package_id == "0xPKG"
    assert settings.sui_oracle_object_id == "0xORACLE"
