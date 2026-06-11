import { defineConfig } from "@playwright/test";

/**
 * Phase 3.2 browser E2E. Runs against a local anvil fork of Sepolia (real deployed
 * Opaque contracts, free test ETH, deterministic) and the vite dev server. Solana
 * stays on devnet for read-only scanning; no Solana writes happen in the suite.
 *
 *   FORK_URL=https://… npx playwright test
 */
const FORK_URL = process.env.FORK_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const ANVIL_PORT = 8545;
const APP_PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 45_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one anvil, one session: serial
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      // Long single-session run: without these, Chromium suspends timers/network in
      // the occluded headless page (ERR_NETWORK_IO_SUSPENDED) and scans stall.
      args: [
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    },
  },
  webServer: [
    {
      command: `anvil --fork-url ${FORK_URL} --chain-id 11155111 --port ${ANVIL_PORT}`,
      port: ANVIL_PORT,
      reuseExistingServer: false, // fresh fork every run: no registry/announcer state bleed
      timeout: 120_000,
    },
    {
      // Production build + preview: the dev server's on-demand dependency
      // re-optimization force-reloads the page mid-session (the WASM glue is a
      // lazily discovered dep), which wipes the in-memory client state.
      command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${APP_PORT} --strictPort`,
      port: APP_PORT,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        VITE_SEPOLIA_RPC_URL: `http://127.0.0.1:${ANVIL_PORT}`,
        VITE_SOLANA_CLUSTER: "devnet",
        // Keep inbox getLogs inside the local fork range (post-fork blocks only).
        VITE_EVM_SCAN_WINDOW: "30",
      },
    },
  ],
});
