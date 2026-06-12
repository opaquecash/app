# Opaque — reference wallet UI

Reference wallet for the [Opaque protocol](https://opaque.cash). React + TypeScript +
Vite, chain-neutral: connect an Ethereum wallet (Sepolia), a Solana wallet (devnet), or
both — register, send, scan, sweep, and use ZK reputation on whichever chains are
connected. All protocol logic lives in the
[`@opaquecash/opaque` SDK](https://github.com/opaquecash/sdk); stealth cryptography and
Groth16 proving run entirely in the browser (no server). Guides:
[docs.opaque.cash](https://docs.opaque.cash).

## Views

| View | Does |
|---|---|
| Setup / Registration | Dual-wallet onboarding, explicit key-derivation source, per-chain meta-address registration |
| Send / Pay | Chain-selected stealth send (ETH or SOL), optional Wormhole relay to the other chain, names accepted (`.opqtest.eth` / `.eth` / `.sol`) |
| Receive | Meta-address QR/text, ONS name register/claim, offline ghost addresses |
| Private Balance | Unified both-chains inbox (native + cross-chain UAB), WASM scan, sweep to any address |
| Reputation (PSR) | Schemas, attestations, trait discovery, in-browser Groth16 proofs, on-chain verification on either chain |
| History / Profile | Locally tracked activity with per-chain explorer links |

## Identity model

Stealth keys derive from a wallet signature over the canonical `SETUP_MESSAGE`
(guarded by `npm run check:setup-message` — never inline or fork it). Ethereum and
Solana signatures derive **different** meta-addresses, so the derivation source is an
explicit onboarding choice; cross-chain portability comes from registering the same
meta-address on both chains. Writes need that chain's wallet; scans and sweeps work on
both regardless (outputs are spent by the reconstructed one-time key, not your wallet).

## Run

Node 18+, MetaMask and/or Phantom/Solflare.

```bash
npm install
echo "VITE_SOLANA_CLUSTER=devnet" > .env
npm run dev          # http://localhost:5173
```

Optional `.env` overrides: `VITE_SOLANA_RPC_URL`, `VITE_SEPOLIA_RPC_URL`,
`VITE_WASM_URL` (defaults to the hosted scanner build — see
[`opaquecash/scanner`](https://github.com/opaquecash/scanner)).

```bash
npm run build && npm run check:setup-message   # CI gate
```

E2E happy-path (Playwright, anvil fork): see `e2e/` and `.github/workflows/e2e.yml`.
