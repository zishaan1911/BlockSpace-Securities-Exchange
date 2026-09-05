"""Publishes EGSI updates to the on-chain OracleState
(contracts/gasx/sources/oracle.move::update_price) — ARCHITECTURE.md §6:
"One publisher (the AI service) submits EGSI updates to OracleState on
Sui." This is the one piece of the AI service that talks to Sui directly
(see ARCHITECTURE.md §1's system diagram: "AI -->|EGSI update tx| MOVE"),
bypassing the TypeScript API gateway/Sui adapter for this specific write.

NOT exercised against a live Sui network in Claude's sandbox — there is
no network egress to any Sui RPC there, and this deliberately never
receives a real private key regardless (GLOSSARY.md's Golden Rules:
"Private keys never go in code, git, or logs"). _validate_price() is
unit-tested directly. The pysui config bootstrap in __init__ (building
an isolated group from a raw key, independent of ~/.pysui) has been
exercised directly against the actually-installed pysui package with a
synthetic throwaway key, catching two real bugs this way:
PysuiConfiguration(persist=False) unconditionally requiring an
already-existing ~/.pysui/PysuiConfig.json regardless of persist, and
GroupProtocol.GRAPHQL being used instead of GRPC. publish_price()
itself — the actual move_call/build_and_sign/execute path — still needs
verification against Sui testnet from your machine with a funded
throwaway publisher key before you trust it; that part cannot be
exercised without live network access.

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

import tempfile
from pathlib import Path

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
        one key + RPC endpoint rather than depending on whatever's
        already in ~/.pysui on the host — this service should be fully
        specified by its own environment variables, not ambient machine
        state.

        `PysuiConfiguration(persist=False)` cannot be used to get a
        starting instance here: that constructor unconditionally
        requires ~/.pysui/PysuiConfig.json to already exist and raises
        ValueError otherwise, regardless of `persist` -- `persist` only
        controls whether *later* changes are written back, and does
        nothing about needing the file to exist in the first place. That
        was this code's actual bug: on a machine that had never run
        pysui before, __init__ raised before this class's own key/group
        setup ever ran. Verified directly against the installed pysui
        1.4.1's source (PysuiConfiguration.__init__ in
        sui_common/config/pysui_config.py) rather than assumed.

        The fix bootstraps a fresh, empty config via the classmethod the
        library's own error message points to
        (`PysuiConfiguration.initialize_config`), in a fresh temporary
        directory rather than ~/.pysui -- initialize_config always
        writes an (empty, keyless) config file to disk with no way to
        opt out, so an ephemeral directory keeps that side effect from
        ever touching real host state or accumulating across runs.
        `new_group(..., persist=False)` then adds this run's actual key
        material in memory only; it is never written to that file.

        Also fixed here: the pysui group was built with
        GroupProtocol.GRAPHQL, not GRPC. That is inconsistent with
        `rpc_url`, which is the same gRPC endpoint used everywhere else
        in this project (blockchain/sui's adapter, the frontend's
        dapp-kit) specifically because Sui switched JSON-RPC off on
        public fullnodes -- GraphQL is a third, different protocol from
        both, and client_factory would have built a client speaking the
        wrong protocol against this URL.
        """
        self._target = target
        bootstrap = PysuiConfiguration.initialize_config(
            in_folder=Path(tempfile.mkdtemp(prefix="gasx-pysui-")),
            init_groups=[{"name": "gasx-bootstrap", "make_active": True}],
        )
        bootstrap.new_group(
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
            group_protocol=GroupProtocol.GRPC,
            make_group_active=True,
            persist=False,
        )
        self._sender = bootstrap.active_address
        self._client = client_factory(bootstrap)

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
