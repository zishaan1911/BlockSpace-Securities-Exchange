"""Tests OraclePublisher's pysui config bootstrap directly against the
real, installed pysui package -- no mocking of pysui itself, since the
actual bug this guards against was a bad assumption about pysui's own
API (PysuiConfiguration(persist=False) silently requiring an
already-existing ~/.pysui/PysuiConfig.json). A test that mocked pysui
would have passed against the buggy code too; only exercising the real
library catches this class of error.

publish_price() itself -- the move_call/build_and_sign/execute path --
is still not covered here or anywhere in this suite, because it needs a
live Sui network. This file only covers getting as far as having a
constructed, correctly-configured client, which is exactly the point
that failed on a real machine.
"""
import asyncio
import base64
import os

import pytest

from oracle.publisher import OraclePublisher, OraclePublishTarget


# OraclePublisher's __init__ is synchronous, but pysui's GrpcProtocolClient
# construction (via client_factory) touches asyncio's event-loop machinery
# internally and raises RuntimeError("There is no current event loop") if
# none is set for the current thread. In real use this never bites: the
# actual call site, ai/main.py's `async def publish_oracle_price`, always
# runs inside uvicorn's already-running loop. A plain synchronous pytest
# test function has no such loop, so construction is wrapped in
# asyncio.run(...) here purely to give it one -- matching this codebase's
# existing pattern for exercising async-adjacent code (see test_api.py's
# auto-cycle test) rather than adding a new pytest-asyncio dependency for
# a single test file.
def _construct(**kwargs) -> OraclePublisher:
    async def _make():
        return OraclePublisher(**kwargs)
    return asyncio.run(_make())


def _fresh_test_key() -> str:
    """A syntactically valid Sui base64 private-key string (1 scheme
    byte + 32 random bytes) -- not tied to any real funded account, and
    never asserted to work for an actual signed transaction."""
    return base64.b64encode(bytes([0x00]) + os.urandom(32)).decode()


def test_constructs_without_an_existing_pysui_config_on_disk(tmp_path, monkeypatch):
    """The actual failure mode hit on a real machine: a host that has
    never run pysui before has no ~/.pysui/PysuiConfig.json, and
    PysuiConfiguration(persist=False) raised ValueError regardless --
    persist only governs whether later changes are written back, not
    whether the file must already exist. Constructing OraclePublisher
    must not depend on that file being present anywhere, including the
    real home directory, which is why HOME is redirected to an empty
    tmp_path here rather than merely hoping the test machine lacks one.
    """
    monkeypatch.setenv("HOME", str(tmp_path))
    target = OraclePublishTarget(package_id="0xabc", oracle_object_id="0xdef")

    publisher = _construct(
        rpc_url="https://fullnode.testnet.sui.io:443",
        publisher_private_key=_fresh_test_key(),
        target=target,
    )

    assert publisher._sender.startswith("0x")
    # Confirms initialize_config's unconditional disk write went to the
    # ephemeral bootstrap directory, not into the redirected (and
    # otherwise still-empty) HOME.
    assert not (tmp_path / ".pysui").exists()


def test_uses_grpc_not_graphql():
    """A second real bug found alongside the first: the pysui group was
    built with GroupProtocol.GRAPHQL, inconsistent with rpc_url being
    the same gRPC endpoint used everywhere else in this project
    (blockchain/sui's adapter, the frontend's dapp-kit) since Sui
    switched JSON-RPC off on public fullnodes. GraphQL is a third,
    different protocol from both, and client_factory would have built a
    client speaking the wrong protocol against this URL.
    """
    target = OraclePublishTarget(package_id="0xabc", oracle_object_id="0xdef")

    publisher = _construct(
        rpc_url="https://fullnode.testnet.sui.io:443",
        publisher_private_key=_fresh_test_key(),
        target=target,
    )

    assert type(publisher._client).__name__ == "GrpcProtocolClient"


def test_two_publishers_do_not_collide():
    """Each OraclePublisher bootstraps its own ephemeral pysui config
    directory, so constructing a second one for a different key must
    not fail or cross-contaminate the first -- e.g. if the AI service
    ever handled more than one market's oracle in one process."""
    target = OraclePublishTarget(package_id="0xabc", oracle_object_id="0xdef")

    first = _construct(
        rpc_url="https://fullnode.testnet.sui.io:443",
        publisher_private_key=_fresh_test_key(),
        target=target,
    )
    second = _construct(
        rpc_url="https://fullnode.testnet.sui.io:443",
        publisher_private_key=_fresh_test_key(),
        target=target,
    )

    assert first._sender != second._sender


def test_rejects_a_malformed_key_rather_than_constructing_something_broken():
    target = OraclePublishTarget(package_id="0xabc", oracle_object_id="0xdef")
    with pytest.raises(Exception):
        _construct(
            rpc_url="https://fullnode.testnet.sui.io:443",
            publisher_private_key="not-a-real-key",
            target=target,
        )
