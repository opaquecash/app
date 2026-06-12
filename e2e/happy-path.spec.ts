/**
 * Phase 3.2 happy path: connect wallet -> derive keys -> register meta-address ->
 * send a stealth payment (native + cross-chain relay) -> scan the inbox -> sweep.
 *
 * The browser wallet is a minimal injected EIP-1193 provider backed by anvil's
 * unlocked dev account #0 (anvil signs personal_sign and eth_sendTransaction
 * server-side), so no extension is involved. The chain is an anvil fork of Sepolia:
 * the real deployed registry, announcer, UAB sender, and Wormhole core, with free ETH.
 */
import { test, expect, type Page } from "@playwright/test";
import { hexToBytes, bytesToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";

const ANVIL_RPC = "http://127.0.0.1:8545";
// anvil dev account #0 (funded with 10k ETH on the fork).
const PK0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const account = privateKeyToAccount(PK0);

// Mirrors @opaquecash/opaque key derivation (CSAP 2.2); inlined so the spec does not
// load the SDK's ESM JSON imports under the Playwright node runtime.
const SETUP_MESSAGE =
  "Sign this message to derive your Opaque Cash stealth keys. This does not approve any transaction.";

/** The meta-address the app will derive for this wallet (signature is deterministic). */
async function expectedMetaAddress(): Promise<string> {
  const signature = await account.signMessage({ message: SETUP_MESSAGE });
  const okm = hkdf(sha256, hexToBytes(signature), undefined, "opaque-cash-v1", 64);
  const viewing = secp256k1.getPublicKey(okm.slice(0, 32), true);
  const spending = secp256k1.getPublicKey(okm.slice(32, 64), true);
  return bytesToHex(new Uint8Array([...viewing, ...spending]));
}

/** Inject a window.ethereum that proxies to anvil and reports our dev account. */
async function injectWallet(page: Page) {
  await page.addInitScript(
    ({ rpcUrl, address }) => {
      let id = 1;
      const rpc = async (method: string, params: unknown[]) => {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
        });
        const body = (await res.json()) as {
          result?: unknown;
          error?: { code: number; message: string };
        };
        if (body.error) {
          throw Object.assign(new Error(body.error.message), { code: body.error.code });
        }
        return body.result;
      };
      const provider = {
        isMetaMask: true,
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [address];
            case "wallet_switchEthereumChain":
            case "wallet_requestPermissions":
              return null;
            default:
              return rpc(method, params as unknown[]);
          }
        },
        on: () => provider,
        removeListener: () => provider,
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    },
    { rpcUrl: ANVIL_RPC, address: account.address },
  );
}

test("register, send (native + relay), scan, and sweep on the Sepolia fork", async ({ page }) => {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      console.log(`[console.${m.type()}]`, m.text().slice(0, 200));
    }
  });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await injectWallet(page);
  const metaAddress = await expectedMetaAddress();

  await test.step("connect wallet and derive stealth keys", async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open wallet" }).click();

    // The Ethereum row renders first; its Connect is the first Connect button.
    await page.getByRole("button", { name: "Connect", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();

    await page.getByRole("button", { name: "Sign & derive stealth keys" }).click();

    // The identity screen shows the derived meta-address; it must equal the one we
    // derive from the same wallet signature outside the app (CSAP 2.2 determinism).
    await expect(page.getByRole("heading", { name: "Your stealth identity" })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText(metaAddress)).toBeVisible();
    // Dismiss the first-run "Your ID" coach marks, then enter the app.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close" })
      .click({ timeout: 5_000 })
      .catch(() => {});
    await page.getByRole("button", { name: "Continue to app" }).click();
  });

  await test.step("register the meta-address on Ethereum", async () => {
    // Post-derive we land either on the registration wizard (fresh registry state)
    // or straight on the dashboard (already registered on this fork).
    const wizard = page.getByRole("heading", { name: "Registration required" });
    const dashboard = page.getByRole("heading", { name: "Dashboard" });
    await expect(wizard.or(dashboard)).toBeVisible({ timeout: 90_000 });
    if (await wizard.isVisible()) {
      // A first-run "Your ID" hint dialog can open over the wizard; dismiss it.
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close" })
        .click({ timeout: 5_000 })
        .catch(() => {});
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: /Register on Ethereum/ }).click();
      await expect(page.getByText("Vault Unlocked")).toBeVisible({ timeout: 90_000 });
    }
    await expect(dashboard).toBeVisible({ timeout: 30_000 });
    // Dismiss the hint dialog if it opens over the dashboard instead.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close" })
      .click({ timeout: 3_000 })
      .catch(() => {});
  });

  await test.step("send a native stealth payment to our own meta-address", async () => {
    await page.getByRole("button", { name: "Send Private send" }).click();
    await page.getByPlaceholder("0x02… meta-address or alice.opqtest.eth").fill(metaAddress);
    await page.getByPlaceholder("0.01").fill("0.05");
    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    await expect(page.getByText("Sent.")).toBeVisible({ timeout: 90_000 });
  });

  await test.step("send with cross-chain relay (UAB over the forked Wormhole core)", async () => {
    await page.getByPlaceholder("0x02… meta-address or alice.opqtest.eth").fill(metaAddress);
    await page.getByPlaceholder("0.01").fill("0.03");
    await page.getByText("Also relay the announcement").click();
    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    await expect(page.getByText("Sent.")).toBeVisible({ timeout: 90_000 });
  });

  await test.step("scan the inbox and sweep one output", async () => {
    await page.getByRole("link", { name: "Opaque." }).click(); // back to dashboard
    await page.getByRole("button", { name: "Private balance" }).click();

    // The WASM scanner must surface both payments. Re-scans can transiently come
    // back empty on the fork; nudge with Refresh until both rows are present.
    await expect(async () => {
      if (await page.getByText("No incoming payments found yet.").isVisible()) {
        await page.getByRole("button", { name: "Refresh" }).click();
      }
      await expect(page.getByText("0.05 ETH")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText("0.03 ETH")).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 180_000, intervals: [1_000] });

    // Sweep the 0.05 output to a fresh address (anvil dev account #1). Re-scans can
    // briefly blank the list; retry the whole row interaction until the click lands.
    const fresh = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    await expect(async () => {
      if (await page.getByText("No incoming payments found yet.").isVisible()) {
        await page.getByRole("button", { name: "Refresh" }).click();
      }
      const card = page
        .locator("div")
        .filter({ has: page.getByText("0.05 ETH") })
        .filter({ has: page.getByRole("button", { name: "Withdraw" }) })
        .last();
      await card.getByPlaceholder(/Destination Ethereum address/).fill(fresh, { timeout: 15_000 });
      await card.getByRole("button", { name: "Withdraw" }).click({ timeout: 5_000 });
    }).toPass({ timeout: 120_000, intervals: [2_000] });
    // Confirm in the modal if one opens.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Withdraw|Confirm/ })
      .click({ timeout: 10_000 })
      .catch(() => {});
    await expect(page.getByText("Withdrawal successful")).toBeVisible({ timeout: 120_000 });
  });
});
