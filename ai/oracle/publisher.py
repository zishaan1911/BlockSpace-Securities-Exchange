"""Publishes EGSI updates to the on-chain OracleState
(contracts/gasx/sources/oracle.move::update_price) — ARCHITECTURE.md §6:
"One publisher (the AI service) submits EGSI updates to OracleState on
Sui." This is the one piece of the AI service that talks to Sui directly
(see ARCHITECTURE.md §1's system diagram: "AI -->|EGSI update tx| MOVE"),
bypassing the TypeScript API gateway/Sui adapter for this specific write.

NOT exercised against a live Sui network in Claude's sandbox — there is
no network egress to any Sui RPC there, and this deliberately never
receives a real private key regardless (GLOSSARY.md's Golden Rules:
"Private keys never go in code, git, or logs"). Only _validate_price()
is unit-tested directly; publish_price() itself needs verification
against Sui testnet from your machine, with a funded throwaway publisher
key, before you trust it.

A note on pysui's API: this targets pysui 1.4.x's *current*, async,
PysuiConfiguration/client_factory path, verified by introspecting the
actually-installed package (`python -c "import pysui; ..."`) rather than
from general familiarity — pysui deprecated and later removed its older
synchronous SuiConfig/SyncClient JSON-RPC classes (present in a lot of
older docs and tutorials still indexed online) somewhere around 0.98,
and 1.4.1 doesn't export them at all. If whatever pysui version ends up
pinned in requirements.txt has moved again since, re-verify this file's
calls against it (`python -c "import pysui; help(pysui.client_factory)"`
etc.) before trusting it — this dependency's API has already changed
shape multiple times.
"""
from __future__ import annotations

from dataclasses import dataclass

from pysui import ExecuteTransaction, GroupProtocol, NetworkType, PysuiConfiguration, client_factory

# The Sui system Clock shared object — a fixed, well-known address on
# every Sui network. oracle::update_price takes `clock: &Clock` and reads
# clock::timestamp_ms from it.
SUI_CLOCK_OBJECT_ID = "0x0000000000000000000000000000000000000000000000000000000000000006"


@dataclass(frozen=True)
class OraclePublishTarget:
    """Everything needed to address one on-chain OracleState — one of
    these per market, loaded from config (config.py), never hard-coded."""

    package_id: str
    oracle_object_id: str


def _validate_price(price: int) -> None:
    """oracle.move's `price` field is a Move u64 on the 0-1000 EGSI
    scale — raises if `price` isn't an int in that range. Split out from
    publish_price() so this one piece of input validation is testable
    without a live Sui connection."""
    if not isinstance(price, int) or isinstance(price, bool):
        raise TypeError(f"price must be an int, got {type(price).__name__}")
    if not (0 <= price <= 1000):
        raise ValueError(f"price must be within the EGSI 0-1000 range, got {price}")


class OraclePublisher:
    def __init__(
        self,
        rpc_url: str,
        publisher_private_key: str,
        target: OraclePublishTarget,
        network_type: NetworkType = NetworkType.TEST,
    ):
        """`publisher_private_key` must be a Sui base64 or bech32
        keystring for the address set as `oracle.move`'s authorized
        publisher (gasx::oracle::set_publisher) — loaded from an
        environment variable by the caller (see config.py), never
        hard-coded here.

        Builds a throwaway, in-memory pysui config group scoped to this
        one key + RPC endpoint (persist=False throughout) rather than
        depending on whatever's already in ~/.pysui on the host — this
        service should be fully specified by its own environment
        variables, not ambient machine state.
        """
        self._target = target
        config = PysuiConfiguration(persist=False)
        config.new_group(
            group_name="gasx-oracle-publisher",
            profile_block=[
                {
                    "profile_name": "gasx-oracle-publisher",
                    "url": rpc_url,
                    "network_type": network_type,
                    "faucet_url": None,
                    "faucet_status_url": None,
                    "make_active": True,
                }
            ],
            key_block=[{"key_string": publisher_private_key, "alias": "gasx-oracle-publisher"}],
            active_address_index=0,
            group_protocol=GroupProtocol.GRAPHQL,
            make_group_active=True,
            persist=False,
        )
        self._sender = config.active_address
        self._client = client_factory(config)

    async def publish_price(self, price: int) -> str:
        """Submits gasx::oracle::update_price(oracle, price, clock).
        `price` must already be an integer on the 0-1000 EGSI scale
        (pass EgsiSnapshot.score — the AI forecast's float expected_egsi
        is a *prediction*, not what gets published as the current
        index). Returns the transaction digest on success; raises on any
        RPC or Move-abort failure rather than swallowing it — a caller
        that believes a publish succeeded when it didn't is worse than a
        loud failure here, since ARCHITECTURE.md §6's staleness-
        rejection design in settlement.move relies on failed publishes
        being visible, not silent. Async because pysui 1.4.x's
        transaction/execute path is async-only.
        """
        _validate_price(price)

        txn = self._client.transaction(initial_sender=self._sender)
        await txn.move_call(
            target=f"{self._target.package_id}::oracle::update_price",
            arguments=[self._target.oracle_object_id, price, SUI_CLOCK_OBJECT_ID],
        )
        signed = await txn.build_and_sign()
        result = await self._client.execute(
            command=ExecuteTransaction(tx_bytestr=signed["tx_bytestr"], sig_array=signed["sig_array"])
        )
        if not result.is_ok():
            raise RuntimeError(f"oracle publish failed: {result.result_string}")
        return result.result_data.digest
