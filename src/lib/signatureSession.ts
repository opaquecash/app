import { openDB, type IDBPDatabase } from "idb";

type Hex = `0x${string}`;

type SignatureSessionRecord = {
  signatureHex: Hex;
  address: string;
  cluster: string;
  message: string;
  issuedAt: number;
  expiresAt: number;
};

const DATA_KEY = "opaque.signature.session.data.v1";
// Legacy key: earlier builds stored the raw AES key in sessionStorage beside the ciphertext,
// so anyone who could read sessionStorage could decrypt the cached setup signature (which
// derives both spending and viewing keys) — the "encryption" was cosmetic (OPQ-013). We now
// wrap with a non-extractable WebCrypto key held in IndexedDB, and proactively purge any
// lingering legacy raw key so an upgrade closes the hole rather than leaving it readable.
const LEGACY_AES_KEY_KEY = "opaque.signature.session.aes.v1";
const PREF_KEY = "opaque.signature.session.pref.v1";
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// The wrapping key lives in IndexedDB as a non-extractable CryptoKey: structured-clone keeps
// it usable for encrypt/decrypt but its raw bytes can never be read back out, so a storage
// reader (XSS payload that only exfiltrates values, forensic dump, shared machine) gets the
// ciphertext but nothing it can decrypt offline.
const KEY_DB_NAME = "opaque.signature.session";
const KEY_STORE = "wrap-keys";
const KEY_ID = "aes-gcm-v1";

function normalizeWalletAddress(address: string): string {
  return address.startsWith("0x") ? address.toLowerCase() : address;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function cryptoAvailable(): boolean {
  return typeof window !== "undefined" && !!window.crypto?.subtle && typeof indexedDB !== "undefined";
}

function keyDb(): Promise<IDBPDatabase> {
  return openDB(KEY_DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    },
  });
}

/** The existing non-extractable wrap key, or null if none has been created yet. */
async function loadWrapKey(): Promise<CryptoKey | null> {
  if (!cryptoAvailable()) return null;
  try {
    const db = await keyDb();
    const key = (await db.get(KEY_STORE, KEY_ID)) as CryptoKey | undefined;
    return key ?? null;
  } catch {
    return null;
  }
}

/** Get the wrap key, generating and persisting a fresh non-extractable one on first use. */
async function getOrCreateWrapKey(): Promise<CryptoKey | null> {
  const existing = await loadWrapKey();
  if (existing) return existing;
  if (!cryptoAvailable()) return null;
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    const db = await keyDb();
    await db.put(KEY_STORE, key, KEY_ID);
    return key;
  } catch {
    return null;
  }
}

async function deleteWrapKey(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await keyDb();
    await db.delete(KEY_STORE, KEY_ID);
  } catch {
    /* best-effort */
  }
}

export function setRememberSignaturePreference(remember: boolean): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PREF_KEY, remember ? "1" : "0");
}

export function getRememberSignaturePreference(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(PREF_KEY) === "1";
}

export function clearSignatureSession(): void {
  if (typeof window === "undefined") return;
  // Remove the ciphertext synchronously so the secret is gone the instant we return; the
  // wrap-key deletion is best-effort in the background (the key alone decrypts nothing).
  sessionStorage.removeItem(DATA_KEY);
  sessionStorage.removeItem(LEGACY_AES_KEY_KEY);
  sessionStorage.removeItem(PREF_KEY);
  void deleteWrapKey();
}

export async function saveSignatureSession(params: {
  signatureHex: Hex;
  address: string;
  cluster: string;
  message: string;
  remember: boolean;
  ttlMs?: number;
}): Promise<void> {
  if (typeof window === "undefined") return;
  const { remember } = params;
  setRememberSignaturePreference(remember);
  if (!remember) {
    clearSignatureSession();
    return;
  }

  // Never leave a legacy raw key sitting in sessionStorage next to the ciphertext.
  sessionStorage.removeItem(LEGACY_AES_KEY_KEY);

  const aesKey = await getOrCreateWrapKey();
  if (!aesKey) return;

  const now = Date.now();
  const record: SignatureSessionRecord = {
    signatureHex: params.signatureHex,
    address: normalizeWalletAddress(params.address),
    cluster: params.cluster,
    message: params.message,
    issuedAt: now,
    expiresAt: now + (params.ttlMs ?? DEFAULT_TTL_MS),
  };

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(record));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, aesKey, plaintext)
  );
  sessionStorage.setItem(
    DATA_KEY,
    JSON.stringify({
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
    })
  );
}

export async function loadSignatureSession(params: {
  address: string;
  cluster: string;
  message: string;
}): Promise<Hex | null> {
  if (typeof window === "undefined") return null;
  // Purge any legacy plaintext key from before the IndexedDB migration.
  sessionStorage.removeItem(LEGACY_AES_KEY_KEY);
  const rawPayload = sessionStorage.getItem(DATA_KEY);
  if (!rawPayload) return null;
  const aesKey = await loadWrapKey();
  if (!aesKey) {
    clearSignatureSession();
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as { iv: string; ciphertext: string };
    const iv = base64ToBytes(parsed.iv);
    const ciphertext = base64ToBytes(parsed.ciphertext);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      aesKey,
      toArrayBuffer(ciphertext)
    );
    const text = new TextDecoder().decode(new Uint8Array(decrypted));
    const record = JSON.parse(text) as SignatureSessionRecord;

    const expired = Date.now() > record.expiresAt;
    const addressMismatch = record.address !== normalizeWalletAddress(params.address);
    const clusterMismatch = record.cluster !== params.cluster;
    const messageMismatch = record.message !== params.message;
    if (expired || addressMismatch || clusterMismatch || messageMismatch) {
      clearSignatureSession();
      return null;
    }
    return record.signatureHex;
  } catch {
    clearSignatureSession();
    return null;
  }
}

