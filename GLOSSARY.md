# Web3 Glossary

Plain-English definitions for everything used in this project.

## Blockchain Fundamentals

| Term | Meaning |
|---|---|
| Blockchain | A shared, permanent database no single company controls. Every write ("transaction") is public and irreversible. |
| Transaction | A signed write to the blockchain, e.g. "move 5 USDC" or "place an order". Each costs a small fee. |
| Wallet | Your identity + keychain on a blockchain. A browser extension that holds funds and signs transactions on your behalf. |
| Private key | The secret that authorizes spending from a wallet. Never share, never commit to git. |
| Smart contract | Program code stored on-chain. Runs exactly as written when a transaction calls it; cannot be secretly changed. |
| dApp | Decentralized application — a normal web app whose backend (or part of it) is smart contracts instead of a private server. |
| On-chain / off-chain | On-chain = recorded on the blockchain (the source of truth). Off-chain = runs on normal servers (fast, cheap, but not authoritative). |
| Mainnet | The real network with real money. |
| Testnet | A practice network with worthless tokens. Safe place to develop. |
| Finality | How fast a transaction becomes irreversible. Sui ~0.4 seconds; Ethereum ~12 seconds+. |
| TPS | Transactions per second a chain can process. |
| RPC | "Remote Procedure Call" — the URL/endpoint your code uses to talk to a blockchain node (read state, submit transactions). |
| Gas (fee) | The fee paid to process a transaction. On Ethereum, gas fees spike when the network is congested — which is exactly what GASX makes tradeable. |
| Block | A batch of transactions the network confirms together. |
| Mempool | The waiting room of unconfirmed transactions. A crowded mempool = congestion. |
| Oracle | A service that publishes off-chain data (prices, indices) onto a blockchain so contracts can use it. |
| Bridge | A system that moves assets or messages between two blockchains (e.g. Wormhole). |
| Indexer | A service that watches chain events and stores them in a database for fast queries. |

## Chains & Languages

| Term | Meaning |
|---|---|
| L1 | "Layer 1" — a base blockchain with its own security (Sui, Ethereum). |
| L2 | "Layer 2" — a cheaper/faster chain that settles onto an L1 (Base is Ethereum's L2). |
| Sui | A fast, cheap L1 blockchain built for high throughput. Where GASX's futures market lives. |
| Move | The smart-contract language on Sui. Resource-oriented: assets act like physical objects (can't be copied or lost by accident). |
| Sui object model | Everything on Sui (coins, positions, markets) is an *object* with an owner, instead of a row in one shared ledger. Objects can be processed in parallel — the source of Sui's speed. |
| Base | An Ethereum-compatible L2 blockchain (cheap, fast Ethereum sibling). Where Thetanuts options live. |
| Ethereum / ETH | The biggest smart-contract blockchain; ETH is its native currency. GASX trades stress *of Ethereum's network*. |
| EVM | Ethereum Virtual Machine — the standard smart-contract environment used by Ethereum, Base, Arbitrum, etc. |
| Solidity | The dominant EVM contract language (what Base contracts are written in). |

## Assets

| Term | Meaning |
|---|---|
| Stablecoin | A token pegged to a fiat currency. 1 USDC ≈ 1 USD. The "cash" of crypto. |
| USDC | Circle's USD stablecoin, natively available on both Sui and Base. GASX collateral. |
| Wrapped asset | A representation of one chain's asset on another chain (e.g. ETH on Sui). |

## Financial Products

| Term | Meaning |
|---|---|
| Futures | A contract to buy/sell something at an agreed price at a set expiry. You profit from *direction*, without holding the thing. |
| Long / Short | Long = betting price goes up. Short = betting price goes down. |
| Underlying | The thing a derivative's value is based on (for GASX: the EGSI index). |
| Expiry | The moment a futures/options contract settles and payouts are computed. |
| Settlement | The payout at expiry (final price vs entry price, times quantity). |
| Collateral | Funds locked as a deposit to back your trading (GASX: USDC). |
| Margin | Your locked collateral + the rules around it (how much must stay locked). |
| Position | Your current stake in a market: side (long/short), quantity, entry price, P&L. |
| P&L | Profit & Loss. |
| Option | The right (not obligation) to buy (call) or sell (put) an asset at a set strike price before expiry. Like insurance on a price. |
| Call / Put | Call = bet/insurance on price up. Put = bet/insurance on price down. |
| IV (Implied Volatility) | The market's expectation of how wildly a price will move — extracted from options prices. A "fear thermometer". |
| Skew | Difference between put and call pricing — tells you whether the market is more afraid of crashes or rallies. |
| Strike price | The agreed price an option lets you buy/sell at. |
| Order book | The list of open buy (bid) and sell (ask) orders for a market. |
| Bid / Ask | Bid = highest buy price. Ask = lowest sell price. The gap is the spread. |
| RFQ | "Request for Quote" — instead of trading against an open book, you ask specific market makers to price your trade. |
| MM (Market Maker) | A firm/bot that continuously quotes both sides of a market, providing liquidity. |
| Hedge | A position taken to reduce risk of another position (our Thetanuts options offset GASX's ETH-correlated risk). |
| Slippage | How much worse your fill price is than the displayed price (big orders move markets). |

## Project-Specific

| Term | Meaning |
|---|---|
| EGSI | Ethereum Gas Stress Index — our 0–1000 score of how congested Ethereum is and is likely to become. |
| GASX | The project name: the exchange for EGSI futures. |
| Thetanuts | An options-trading protocol on Base. Our AI agent trades real options there. |
| OptionBook / OptionFactory | Thetanuts' smart contracts: OptionBook is the live options market; OptionFactory deploys new option instruments. Our agent's trades go through these on Base mainnet. |
| Thetanuts SDK | Official TypeScript library for reading/writing Thetanuts from app code (runtime use). |
| Thetanuts MCP | Model Context Protocol server — lets AI agents/devs inspect Thetanuts data and build transactions at development time (read-oriented; not the production path). |
| Thetanuts AgentKit | Official toolkit for autonomous Thetanuts trading, including a safety-policy pattern for an AI-controlled wallet. |
| MCP | Model Context Protocol — a standard way to give AI agents tools/context (here: Thetanuts inspection tools). |
| AgentKit | A framework for AI agents that can sign transactions with a wallet, under a hard-coded safety policy. |
| Sui dApp Kit | Official React toolkit for Sui wallet connection and transactions in a web app. |
| DeepBook | Sui's native on-chain order book (CLOB). Mentioned as reusable reference; not used in the MVP. |
| CLOB | Central Limit Order Book — the classic exchange matching model. |

## Golden Rules

- Mainnet = real money. Start tiny. Never trade user funds with an autonomous wallet.
- Private keys never go in code, git, or logs.
- On-chain = truth. Off-chain services are opinions.
