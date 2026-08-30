from unittest.mock import MagicMock

from ingestion.ethereum import EthereumIngestionClient


def make_client_with_mock_w3(mock_w3) -> EthereumIngestionClient:
    # Constructing with a dummy URL is safe — Web3(HTTPProvider(url))
    # doesn't make any network call until a request is issued, but we
    # replace _w3 entirely anyway so no real HTTPProvider is ever used.
    client = EthereumIngestionClient(rpc_url="http://localhost:0")
    client._w3 = mock_w3
    return client


def make_tx(to: str | None):
    return {"to": to}


def test_fetch_latest_metrics_shapes_a_raw_metrics_object():
    mock_w3 = MagicMock()
    mock_w3.eth.get_block.return_value = {
        "number": 12345,
        "timestamp": 1_700_000_000,
        "baseFeePerGas": 25_000_000_000,
        "gasUsed": 14_000_000,
        "gasLimit": 30_000_000,
        "transactions": [
            make_tx("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"),  # DEX
            make_tx("0x0000000000000000000000000000000000dEaD"),  # not DEX
            make_tx(None),  # contract creation
        ],
    }
    mock_w3.eth.fee_history.return_value = {
        "baseFeePerGas": [20_000_000_000, 21_000_000_000, 25_000_000_000]  # last is the trailing projected entry
    }
    mock_w3.provider.make_request.return_value = {"result": {"pending": "0x64"}}  # 100

    client = make_client_with_mock_w3(mock_w3)
    metrics = client.fetch_latest_metrics()

    assert metrics.block_number == 12345
    assert metrics.timestamp == 1_700_000_000
    assert metrics.base_fee_wei == 25_000_000_000
    assert metrics.gas_used == 14_000_000
    assert metrics.gas_limit == 30_000_000
    assert metrics.block_tx_count == 3
    assert metrics.dex_tx_count == 1
    assert metrics.pending_tx_count == 100


def test_fee_history_trims_the_trailing_projected_entry():
    mock_w3 = MagicMock()
    mock_w3.eth.fee_history.return_value = {"baseFeePerGas": [1, 2, 3, 4]}
    client = make_client_with_mock_w3(mock_w3)

    history = client._fetch_base_fee_history()

    assert history == [1, 2, 3]  # last entry (the projection) dropped


def test_dex_transaction_matching_is_case_insensitive():
    mock_w3 = MagicMock()
    client = make_client_with_mock_w3(mock_w3)
    transactions = [
        make_tx("0x7A250D5630b4CF539739DF2C5DACB4C659F2488D"),  # different case, same address
        make_tx("0xnotarealdexaddress00000000000000000000"),
    ]

    count = client._count_dex_transactions(transactions)

    assert count == 1


def test_dex_transaction_matching_handles_none_to_address():
    mock_w3 = MagicMock()
    client = make_client_with_mock_w3(mock_w3)
    transactions = [make_tx(None), make_tx(None)]

    assert client._count_dex_transactions(transactions) == 0


def test_pending_tx_count_falls_back_to_zero_when_txpool_unsupported():
    mock_w3 = MagicMock()
    mock_w3.provider.make_request.side_effect = Exception("method not supported")
    client = make_client_with_mock_w3(mock_w3)

    assert client._fetch_pending_tx_count() == 0


def test_pending_tx_count_falls_back_to_zero_on_missing_result_shape():
    mock_w3 = MagicMock()
    mock_w3.provider.make_request.return_value = {"unexpected": "shape"}
    client = make_client_with_mock_w3(mock_w3)

    assert client._fetch_pending_tx_count() == 0


def test_custom_history_window_is_passed_to_fee_history():
    mock_w3 = MagicMock()
    mock_w3.eth.fee_history.return_value = {"baseFeePerGas": [1, 2]}
    client = EthereumIngestionClient(rpc_url="http://localhost:0", history_window_blocks=7)
    client._w3 = mock_w3

    client._fetch_base_fee_history()

    mock_w3.eth.fee_history.assert_called_once_with(7, "latest")
