import crypto from "node:crypto";
import { setting, settingName } from "@/lib/env-vars";

/**
 * Field-level encryption at rest.
 *
 * THREAT MODEL
 *
 * This protects exactly one thing: an attacker who obtains the database file
 * and not the key. That is not a hypothetical class of attacker — it is the
 * commonest one. Databases leak through stolen backups, misconfigured object
 * storage, a laptop, a stale snapshot, a support export, a repository someone
 * committed `dev.db` into. In every one of those the file travels and the
 * process environment does not.
 *
 * It protects against nothing else, and the /privacy page says so in the same
 * size type. An attacker with the running process, the environment, or root on
 * the host has the key and therefore has the plaintext.
 *
 * CONSTRUCTION
 *
 * AES-256-GCM. A fresh 96-bit IV per encryption, never reused, generated from
 * the CSPRNG. The 128-bit authentication tag is stored alongside, so a
 * modified ciphertext fails to decrypt rather than decrypting to garbage that
 * the application then trusts.
 *
 * The interesting part is the ADDITIONAL AUTHENTICATED DATA. Each ciphertext
 * is bound to the exact model, field and row id it belongs to. Confidentiality
 * alone would let an attacker with write access to the file MOVE a ciphertext:
 * copy the encrypted spend-related row of one principal over another's, or
 * swap two cart line names between requests. Every one of those decrypts
 * perfectly under plain AES-GCM, because the bytes are authentic; they are
 * simply in the wrong place. Binding the AAD to `model.field.id` makes a
 * relocated ciphertext fail to authenticate, which turns a silent data-integrity
 * attack into a loud decryption error.
 *
 * FORMAT
 *
 *   stl1.<iv>.<tag>.<ciphertext>      all base64url, no padding
 *
 * The version prefix exists so a change of scheme can re-encrypt in place and
 * still read what the previous one wrote. The rename from Bouncer to STEALTH
 * is the first time that mattered: new values are written as `stl1`, and
 * `bnc1` rows already in the database stay readable.
 *
 * The prefix is part of the AAD, so it is NOT cosmetic. Reading an old row
 * requires authenticating it under the version it was written with, which is
 * why the version is parsed from the blob rather than assumed.
 */

/** What new values are written as. */
const VERSION = "stl1";

/** What can be read. Newest first; every entry must stay readable forever. */
export const ACCEPTED_VERSIONS = ["stl1", "bnc1"] as const;
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size AES-GCM is specified for
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256
export const ENCRYPTION_KEY_ENV = settingName("ENCRYPTION_KEY");

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** Generates a fresh key, base64 encoded, for pasting into .env. */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_BYTES).toString("base64");
}

/** A bag of environment variables. Deliberately looser than NodeJS.ProcessEnv
 *  so a test can pass an empty object without inventing a NODE_ENV. */
export type EnvLike = Record<string, string | undefined>;

/**
 * Reads and validates the key.
 *
 * Deliberately not cached: a cached key survives a `.env` change in dev and
 * produces a confusing "this used to work" failure. Reading 32 bytes and
 * checking a length is not a cost worth caching against.
 */
export function readEncryptionKey(env: EnvLike = process.env): Buffer {
  // Accepts the pre-rename BOUNCER_ENCRYPTION_KEY too. A .env written before
  // the rename must keep working: silently finding no key here would look
  // exactly like never having set one, and the database it unlocks is already
  // encrypted under it.
  const raw = setting("ENCRYPTION_KEY", env);
  if (!raw) {
    throw new Error(
      `${ENCRYPTION_KEY_ENV} is not set, so encrypted fields cannot be read or written. ` +
        "Generate one with `npm run privacy:keygen` and put it in .env.",
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error(`${ENCRYPTION_KEY_ENV} is not valid base64.`);
  }

  if (key.length !== KEY_BYTES) {
    // The length is safe to report; the value is not, and is never printed.
    throw new Error(
      `${ENCRYPTION_KEY_ENV} decodes to ${key.length} bytes, but AES-256 needs ${KEY_BYTES}. ` +
        "Generate a correct one with `npm run privacy:keygen`.",
    );
  }
  return key;
}

/** True when the key is present and usable. Never throws, never logs. */
export function encryptionConfigured(env: EnvLike = process.env): boolean {
  try {
    readEncryptionKey(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * The binding between a ciphertext and its home.
 *
 * `version.model.field.id` and nothing else. Including a timestamp would break
 * re-reads; including the plaintext would defeat the purpose.
 *
 * The version is a parameter because it is inside the AAD. A row written as
 * `bnc1` only authenticates against an AAD that begins `bnc1`, so a reader must
 * pass the version it found in the blob rather than the one it would write.
 */
export function fieldAad(
  model: string,
  field: string,
  id: string,
  version: string = VERSION,
): Buffer {
  return Buffer.from(`${version}.${model}.${field}.${id}`, "utf8");
}

/** The scheme a stored value was written under, or null if it is not one of ours. */
export function blobVersion(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  return (ACCEPTED_VERSIONS as readonly string[]).includes(parts[0])
    ? parts[0]
    : null;
}

/** True for a value this module produced. Used to keep re-encryption idempotent. */
export function isEncrypted(value: string): boolean {
  return blobVersion(value) !== null;
}

export function encryptField(
  plaintext: string,
  aad: Buffer,
  key: Buffer = readEncryptionKey(),
): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64url(iv), b64url(tag), b64url(ciphertext)].join(".");
}

export class DecryptionError extends Error {
  constructor(detail: string) {
    super(`Encrypted field could not be decrypted: ${detail}`);
    this.name = "DecryptionError";
  }
}

export function decryptField(
  blob: string,
  aad: Buffer,
  key: Buffer = readEncryptionKey(),
): string {
  const parts = blob.split(".");
  if (blobVersion(blob) === null) {
    throw new DecryptionError(
      `unrecognised format (expected one of ${ACCEPTED_VERSIONS.join(", ")} with four segments)`,
    );
  }

  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");

  if (iv.length !== IV_BYTES) throw new DecryptionError("wrong IV length");
  if (tag.length !== TAG_BYTES) throw new DecryptionError("wrong tag length");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM cannot tell these apart, and saying so is more useful than a bare
    // "unsupported state" from OpenSSL. The message never includes the key,
    // the AAD or any ciphertext bytes.
    throw new DecryptionError(
      "authentication failed. The key is wrong, the ciphertext was modified, " +
        "or it belongs to a different row or column than the one reading it",
    );
  }
}
