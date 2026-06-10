# Frontend — Opaque Wallet UI

Reference wallet application for the Opaque protocol. Built with React, TypeScript, Vite, and Tailwind CSS. Chain-neutral: connect an Ethereum wallet (MetaMask or any injected wallet, Sepolia), a Solana wallet (Phantom, Solflare), or both — register, send, scan, sweep, and use ZK reputation on whichever chains are connected. All protocol logic lives in the `@opaquecash/opaque` SDK; stealth address cryptography and Groth16 proof generation run entirely in the browser.

## Features

| View | Description |
|:-----|:------------|
| **Landing / Setup** | Connect one or both wallets, choose which wallet derives your stealth keys (signature over `SETUP_MESSAGE` via HKDF-SHA256), and confirm your meta-address before entering |
| **Registration Wizard** | Registers your stealth meta-address on each connected chain that does not have it yet (Ethereum registry contract / Solana registry program) |
| **Dashboard** | Quick-action navigation and recent activity tagged by chain |
| **Send** | Pick a chain (enabled per connected wallet), derive a one-time stealth destination, and send ETH or SOL — with optional Wormhole relay of the announcement to the other chain |
| **Receive** | Share your stealth meta-address (QR code or copyable text), or generate ghost addresses for offline use |
| **Private Balance** | Unified inbox: scans Ethereum and Solana announcements (native + cross-chain UAB) via WASM, shows outputs tagged by chain and source, sweeps to any address on the output's chain |
| **Reputation (PSR)** | Create schemas, issue attestations, discover traits, generate Groth16 ZK proofs, and submit verification on Ethereum or Solana |
| **Transaction History** | Locally tracked history of stealth sends, receives, and sweeps, with per-chain explorer links |
| **Profile** | View your stealth meta-address and manage settings |

## Identity model

Stealth keys derive from a wallet signature over the canonical `SETUP_MESSAGE`. An Ethereum `personal_sign` and a Solana `signMessage` produce different signatures, so they derive **different meta-addresses**. The app makes the derivation source an explicit choice at onboarding and never merges identities silently. Cross-chain portability comes from registering the **same** meta-address on both chains, not from any wallet producing the same keys.

Writes on a chain (register, send, PSR transactions) require that chain's wallet to be connected. Reads (scan, balances) and sweeps work on both chains regardless — outputs are spent by the reconstructed one-time stealth key, not by your wallet.

## Tech Stack

- **React 19** + **TypeScript** — UI framework
- **Vite 7** — Build tool with WASM plugin support
- **Tailwind CSS 4** — Styling
- **Zustand** — Lightweight state management (session store, ghost address store, tx history)
- **@opaquecash/opaque** — Protocol SDK (`OpaqueClient`: register, send, scan, sweep, PSR, UAB relay)
- **wagmi** + **viem** — Ethereum (Sepolia) wallet connection and RPC
- **@solana/web3.js** + **@solana/wallet-adapter** — Solana RPC and Phantom/Solflare connectors
- **WASM scanner** — Rust-compiled WebAssembly module for high-performance announcement scanning
- **snarkjs** — In-browser Groth16 proof generation
- **Framer Motion** — Animations
- **driver.js** — Onboarding tour
- **qrcode.react** — QR code generation for receive addresses

## Getting Started

### Prerequisites

- Node.js 18+
- An Ethereum wallet extension (MetaMask) and/or a Solana wallet extension (Phantom or Solflare) — either one is enough

### Install & Run

```bash
npm install
npm run dev
```

The app starts at `http://localhost:5173`.

### Environment Variables

Create a `.env` file in the app directory:

```env
VITE_SOLANA_CLUSTER=devnet
```

Optional overrides:

```env
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com
VITE_WASM_URL=/pkg/cryptography.js
```

### Build & Checks

```bash
npm run build                # tsc + vite build
npm run check:setup-message  # guards the canonical SETUP_MESSAGE (never inline or fork it)
npm run preview
```

## Project Structure

```
src/
├── App.tsx                     # Root app: session gating, registration, tabs
├── main.tsx                    # Entry point (providers: wagmi + Solana wallet adapter)
├── opaque/
│   ├── useOpaqueSession.ts     # Wallet signature -> OpaqueClient; derivation source; signer sync
│   ├── store.ts                # Zustand session store (client, meta-address, derivation source)
│   ├── config.ts               # Sepolia + Solana RPC/cluster config
│   ├── sendOnly.ts             # Identity-less client for the public /pay page
│   ├── wagmi.ts                # wagmi config (injected connector, Sepolia)
│   └── OpaqueProviders.tsx     # wagmi + react-query providers
├── components/                 # UI views and modals
│   ├── LandingView.tsx         # Dual-wallet onboarding + derivation choice
│   ├── RegistrationWizard.tsx  # Per-chain registration
│   ├── SendView.tsx            # Chain selector + stealth send + Wormhole relay
│   ├── PrivateBalanceView.tsx  # Cross-chain scan + sweep
│   ├── PayPage.tsx             # Public payment page (either-chain payer)
│   ├── ChainToggle.tsx         # Generic chain segmented control
│   ├── SchemaStudio.tsx / AttestationManager.tsx / ManageView.tsx  # PSR on either chain
│   └── ...
├── hooks/
│   ├── useConnectedWallets.ts  # Chain-neutral wallet connection state
│   ├── useWallet.ts            # Solana wallet adapter wrapper
│   ├── usePsrChain.ts          # Chain choice for PSR actions
│   ├── useRegistrationStatus.ts# Per-connected-chain registration checks
│   └── useScanner.ts           # Solana announcement cache (IndexedDB)
├── lib/
│   ├── chainAssets.ts          # Native asset metadata + amount parsing per chain
│   ├── explorer.ts             # Etherscan (Sepolia) / Solana Explorer URL helpers
│   ├── chain.ts                # Solana RPC + cluster utilities
│   └── ...
└── store/                      # vault, ghost address, tx history stores
```

## Key Flows

### Stealth Send

1. User picks a chain (Ethereum or Solana) and enters a recipient meta-address.
2. `client.sendStealthPayment({ chain, recipient, amount, announce, relay })` derives a one-time stealth destination (DKSAP), transfers the native asset, and publishes the announcement.
3. With relay enabled, the announcement is also forwarded to the other chain over Wormhole (UAB), so the recipient discovers it on either side.

### Private Balance Scan

1. `client.scan({ chains: ["solana", "ethereum"] })` fetches announcements from both chains and merges cross-chain (UAB) re-emissions.
2. The WASM scanner performs view-tag pre-filtering, then full EC derivation for candidates.
3. Matching outputs are displayed with balances, tagged by chain and discovery source.
4. `client.sweep({ output, chain, destination })` reconstructs the one-time stealth key and sends funds to any address on that chain.

### ZK Reputation Proof

1. Traits are discovered from announcements via `client.discoverTraits`.
2. `client.generateReputationProof` produces a Groth16 proof in-browser (no private data leaves the device).
3. `client.submitReputationVerification(chain, …)` submits to the verifier on the selected chain; the nullifier is consumed on-chain.
