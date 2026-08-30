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


def test_publish_returns_501_when_not_configured(client):
    run_cycle_with_mocked_ingestion(client)
    resp = client.post("/publish")
    assert resp.status_code == 501
