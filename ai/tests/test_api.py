from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import main
from schemas import RawEthereumMetrics


@pytest.fixture(autouse=True)
def reset_state():
    """main.py's ingest/history/forecast state is module-level (in-memory,
    single-market — matches ARCHITECTURE.md's Decisions §12), so tests
    reset it explicitly rather than relying on execution order."""
    main._history = main.EgsiHistory(max_len=main.settings.egsi_history_max_len)
    main._forecaster = main.Forecaster()
    main._latest_snapshot = None
    main._latest_thetanuts_skew = None
    yield


@pytest.fixture
def client():
    return TestClient(main.app)


def make_metrics(**overrides) -> RawEthereumMetrics:
    defaults = dict(
        block_number=1,
        timestamp=1_700_000_000,
        base_fee_wei=20_000_000_000,
        gas_used=15_000_000,
        gas_limit=30_000_000,
        pending_tx_count=1_000,
        base_fee_history_wei=[20_000_000_000] * 10,
        dex_tx_count=5,
        block_tx_count=100,
    )
    defaults.update(overrides)
    return RawEthereumMetrics(**defaults)


def run_cycle_with_mocked_ingestion(client, **metrics_overrides):
    with patch("main.EthereumIngestionClient") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.fetch_latest_metrics.return_value = make_metrics(**metrics_overrides)
        mock_cls.return_value = mock_instance
        return client.post("/cycle")


def test_health_before_any_cycle(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"status": "ok", "model_loaded": False, "history_len": 0}


def test_egsi_current_returns_503_before_any_cycle(client):
    resp = client.get("/egsi/current")
    assert resp.status_code == 503


def test_forecast_returns_503_before_any_cycle(client):
    resp = client.get("/forecast")
    assert resp.status_code == 503


def test_cycle_ingests_and_returns_a_snapshot(client):
    resp = run_cycle_with_mocked_ingestion(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["market"] == "EGSI-1H"
    assert 0 <= body["score"] <= 1000
    assert "components" in body


def test_egsi_current_reflects_latest_cycle(client):
    cycle_resp = run_cycle_with_mocked_ingestion(client)
    resp = client.get("/egsi/current")
    assert resp.status_code == 200
    assert resp.json()["score"] == cycle_resp.json()["score"]


def test_health_reflects_history_length_after_cycles(client):
    run_cycle_with_mocked_ingestion(client)
    run_cycle_with_mocked_ingestion(client)
    resp = client.get("/health")
    assert resp.json()["history_len"] == 2


def test_forecast_after_cycle_returns_fallback_when_no_model_loaded(client):
    run_cycle_with_mocked_ingestion(client)
    resp = client.get("/forecast")
    assert resp.status_code == 200
    body = resp.json()
    assert body["model_version"] == "egsi-v1-fallback"
    assert 0.0 <= body["confidence"] <= 1.0
    assert 0.0 <= body["p_tail_500"] <= 1.0


def test_publish_returns_503_when_no_snapshot_yet(client):
    resp = client.post("/publish")
    assert resp.status_code == 503


def test_cycle_accepts_optional_thetanuts_signal(client):
    with patch("main.EthereumIngestionClient") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.fetch_latest_metrics.return_value = make_metrics()
        mock_cls.return_value = mock_instance
        resp = client.post("/cycle", json={"thetanuts_atm_iv": 0.8, "thetanuts_skew_25delta": 0.05})

    assert resp.status_code == 200
    body = resp.json()
    assert body["components"]["thetanuts_iv"] is not None


def test_cycle_without_thetanuts_signal_leaves_component_null(client):
    resp = run_cycle_with_mocked_ingestion(client)
    assert resp.json()["components"]["thetanuts_iv"] is None


def test_forecast_reflects_thetanuts_skew_from_last_cycle(client):
    with patch("main.EthereumIngestionClient") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.fetch_latest_metrics.return_value = make_metrics()
        mock_cls.return_value = mock_instance
        client.post("/cycle", json={"thetanuts_atm_iv": 0.9, "thetanuts_skew_25delta": 0.12})

    # Fallback forecaster ignores feature values, but the endpoint
    # should still resolve without error with a Thetanuts signal present
    # in state — this exercises the feature_dict construction path.
    resp = client.get("/forecast")
    assert resp.status_code == 200


def test_publish_returns_501_when_not_configured(client):
    run_cycle_with_mocked_ingestion(client)
    resp = client.post("/publish")
    assert resp.status_code == 501


# ---------------------------------------------------------------------------
# Auto-cycling and history restore.
#
# Before this, EGSI only ever updated when someone manually POSTed
# /cycle — it was not "updating slowly", it was frozen until poked, and
# a restart additionally wiped the forecaster's whole EMA/RSI/momentum
# context even though the readings were durably stored.
# ---------------------------------------------------------------------------


def test_restore_seeds_history_from_durable_storage(client):
    resp = client.post("/history/restore", json={"scores": [400, 420, 450, 470]})
    assert resp.status_code == 200
    assert resp.json() == {"restored": 4}
    assert client.get("/health").json()["history_len"] == 4


def test_restore_enables_forecasting_without_waiting_for_new_cycles(client):
    # Forecast is unavailable on a cold start...
    assert client.get("/forecast").status_code == 503
    # ...but available immediately once history is restored, which is the
    # whole point: a restart should not cost the forecaster its context.
    client.post("/history/restore", json={"scores": [400, 420, 450]})
    assert client.get("/forecast").status_code == 200


def test_restore_replaces_rather_than_appends(client):
    client.post("/history/restore", json={"scores": [1, 2, 3]})
    client.post("/history/restore", json={"scores": [9, 9]})
    # Idempotent on repeat, rather than accumulating duplicate history.
    assert client.get("/health").json()["history_len"] == 2


def test_restore_accepts_an_empty_history(client):
    resp = client.post("/history/restore", json={"scores": []})
    assert resp.status_code == 200
    assert resp.json() == {"restored": 0}


def test_restore_respects_the_history_cap(client):
    over_cap = list(range(main.settings.egsi_history_max_len + 50))
    client.post("/history/restore", json={"scores": over_cap})
    assert client.get("/health").json()["history_len"] == main.settings.egsi_history_max_len


def test_perform_cycle_is_shared_by_the_endpoint_and_the_background_loop():
    # Both paths must go through the same function, or auto-cycling and
    # manual cycling would silently drift apart.
    with patch("main.EthereumIngestionClient") as mock_cls:
        mock_instance = MagicMock()
        mock_instance.fetch_latest_metrics.return_value = make_metrics()
        mock_cls.return_value = mock_instance
        snapshot = main._perform_cycle()
    assert 0 <= snapshot.score <= 1000
    assert main._latest_snapshot is not None


def test_auto_cycle_loop_survives_an_ingestion_failure():
    """One unreachable RPC call must not permanently stop the loop."""
    import asyncio

    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("RPC unreachable")
        raise asyncio.CancelledError  # stop the loop on the second pass

    async def run():
        with patch("main._perform_cycle", side_effect=flaky):
            with patch("main.settings") as fake_settings:
                fake_settings.cycle_interval_seconds = 0.01
                with pytest.raises(asyncio.CancelledError):
                    await main._auto_cycle_loop()

    asyncio.run(run())
    # Reached a second attempt, so the first failure did not kill it.
    assert calls["n"] == 2
