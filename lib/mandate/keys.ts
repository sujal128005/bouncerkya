import crypto, { type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonicalMandatePayload, type SignableMandate } from "./canonical";

/**
 * Agent key material.
 *
 * `publicKeyRef` on an Agent ("kms://stealth/agent-keys/vega-01") is a
 * reference into a key management system, not a key. The keystore is what that
 * reference resolves against: a JSON file outside the application database,
 * because that is the shape a real KMS lookup has — swapping this module for an
 * actual KMS client should not require a schema migration. It holds public keys
 * only. Private keys are generated in memory during seeding, used to sign, and
 * never written anywhere.
 */

const SIGNATURE_PREFIX = "ed25519:";

/** publicKeyRef -> base64-encoded SPKI DER public key. */
export type AgentKeystore = Record<string, string>;

export type AgentKeyPair = {
  publicKey: KeyObject;
  privateKey: KeyObject;
};

export function keystorePath(): string {
  return path.join(process.cwd(), "keystore", "agent-keys.json");
}

export function generateAgentKeyPair(): AgentKeyPair {
  return crypto.generateKeyPairSync("ed25519");
}

export function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
}

export function importPublicKey(encoded: string): KeyObject {
  return crypto.createPublicKey({
    key: Buffer.from(encoded, "base64"),
    format: "der",
    type: "spki",
  });
}

export function writeKeystore(keystore: AgentKeystore): void {
  const file = keystorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(keystore, null, 2)}\n`, "utf8");
}

/** Returns an empty keystore if the file is missing or unreadable. */
export function readKeystore(): AgentKeystore {
  const file = keystorePath();
  if (!fs.existsSync(file)) return {};

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const keystore: AgentKeystore = {};
    for (const [ref, value] of Object.entries(parsed)) {
      if (typeof value === "string") keystore[ref] = value;
    }
    return keystore;
  } catch {
    return {};
  }
}

/** Resolve a publicKeyRef to a usable key. Unknown or corrupt refs yield null. */
export function resolvePublicKey(
  keystore: AgentKeystore,
  publicKeyRef: string,
): KeyObject | null {
  const encoded = keystore[publicKeyRef];
  if (!encoded) return null;

  try {
    return importPublicKey(encoded);
  } catch {
    return null;
  }
}

/** Signs the canonical payload and returns the stored "ed25519:<base64>" form. */
export function signMandate(
  mandate: SignableMandate,
  privateKey: KeyObject,
): string {
  const signature = crypto.sign(
    null,
    canonicalMandatePayload(mandate),
    privateKey,
  );
  return `${SIGNATURE_PREFIX}${signature.toString("base64")}`;
}

/** Parses "ed25519:<base64>". Anything else is not a signature we can check. */
export function decodeSignature(signature: string): Buffer | null {
  if (!signature.startsWith(SIGNATURE_PREFIX)) return null;

  const encoded = signature.slice(SIGNATURE_PREFIX.length);
  if (encoded.length === 0) return null;

  try {
    const bytes = Buffer.from(encoded, "base64");
    // Ed25519 signatures are exactly 64 bytes; base64 silently tolerates junk.
    return bytes.length === 64 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Flips one bit of a real signature. Used by the seed to produce a mandate
 * whose signature is well-formed but wrong — a tampered credential, not a
 * missing one.
 */
export function tamperSignature(signature: string): string {
  const bytes = decodeSignature(signature);
  if (!bytes) throw new Error("cannot tamper with an unparseable signature");

  const tampered = Buffer.from(bytes);
  tampered[0] ^= 0x01;
  return `${SIGNATURE_PREFIX}${tampered.toString("base64")}`;
}
