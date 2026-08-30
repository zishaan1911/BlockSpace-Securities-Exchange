"""Ethereum chain data ingestion (ARCHITECTURE.md §2, §3): pulls the raw
signals features/egsi.py's compute_egsi() needs from an Ethereum JSON-RPC
endpoint via web3.py.

NOT exercised against a live RPC endpoint in Claude's sandbox — there is
no network egress to any Ethereum RPC provider there. Only the parsing/
shaping logic (_count_dex_transactions, _fetch_base_fee_history's
trimming, the RawEthereumMetrics assembly) is unit-tested here, against a
mocked Web3 instance (tests/test_ingestion.py). Point EthereumIngestionClient
at a real RPC URL and verify against live data on your machine before
trusting it — see ai/README.md.
"""
from __future__ import annotations

from web3 import Web3

from schemas import RawEthereumMetrics

# A short, illustrative list of well-known DEX/DeFi router addresses on
# Ethereum mainnet, used as the dex_tx_count proxy for the dex_activity
# EGSI component (features/egsi.py). Intentionally small and easy to
# extend — a production version would maintain this separately (config
# file or DB table), not hard-code it in source.
KNOWN_DEX_ROUTER_ADDRESSES: frozenset[str] = frozenset(
    addr.lower()
    for addr in [
        "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",  # Uniswap V2 Router
        "0xE592427A0AEce92De3Edee1F18E0157C05861564",  # Uniswap V3 Router
        "0x1111111254EEB25477B68fb85Ed929f73A960582",  # 1inch V5 Router
        "0xDef1C0ded9bec7F1a1670819833240f027b25EfF",  # 0x Exchange Proxy
    ]
)

# How many recent blocks' base fees to sample for fee_momentum /
# gas_volatility (ARCHITECTURE.md §3).
DEFAULT_HISTORY_WINDOW_BLOCKS = 20


class EthereumIngestionClient:
    def __init__(self, rpc_url: str, history_window_blocks: int = DEFAULT_HISTORY_WINDOW_BLOCKS):
        self._w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.history_window_blocks = history_window_blocks

    def fetch_latest_metrics(self) -> RawEthereumMetrics:
        latest = self._w3.eth.get_block("latest", full_transactions=True)
        base_fee_history = self._fetch_base_fee_history()
        dex_tx_count = self._count_dex_transactions(latest["transactions"])
        pending_tx_count = self._fetch_pending_tx_count()

        return RawEthereumMetrics(
            block_number=latest["number"],
            timestamp=latest["timestamp"],
            base_fee_wei=latest["baseFeePerGas"],
            gas_used=latest["gasUsed"],
            gas_limit=latest["gasLimit"],
            pending_tx_count=pending_tx_count,
            base_fee_history_wei=base_fee_history,
            dex_tx_count=dex_tx_count,
            block_tx_count=len(latest["transactions"]),
        )

    def _fetch_base_fee_history(self) -> list[int]:
        fee_history = self._w3.eth.fee_history(self.history_window_blocks, "latest")
        # baseFeePerGas carries one extra trailing entry — the *next*
        # block's already-computable projected base fee — so this is
        # trimmed to exactly one entry per historical block, oldest
        # first, matching what features/egsi.py expects.
        return list(fee_history["baseFeePerGas"][:-1])

    def _count_dex_transactions(self, transactions) -> int:
        count = 0
        for tx in transactions:
            to_addr = tx.get("to")
            if to_addr and to_addr.lower() in KNOWN_DEX_ROUTER_ADDRESSES:
                count += 1
        return count

    def _fetch_pending_tx_count(self) -> int:
        """Mempool pressure proxy. txpool_status isn't exposed by every
        RPC provider (notably: Infura and Alchemy don't support it) —
        falls back to 0 (reads as "no pressure") rather than raising,
        since a missing mempool signal shouldn't take down the whole
        EGSI computation."""
        try:
            status = self._w3.provider.make_request("txpool_status", [])
            pending_hex = status.get("result", {}).get("pending", "0x0")
            return int(pending_hex, 16)
        except Exception:
            return 0
