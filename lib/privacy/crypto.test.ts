import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DecryptionError,
  ENCRYPTION_KEY_ENV,
  blobVersion,
  decryptField,
  encryptField,
  encryptionConfigured,
  fieldAad,
  generateEncryptionKey,
  isEncrypted,
  readEncryptionKey,
} from "./crypto";

const KEY = Buffer.from(generateEncryptionKey(), "base64");
const OTHER_KEY = Buffer.from(generateEncryptionKey(), "base64");
const AAD = fieldAad("CartItem", "name", "itm_0001");

describe("key handling", () => {
  it("generates a 32-byte key", () => {
    expect(Buffer.from(generateEncryptionKey(), "base64")).toHaveLength(32);
  });

  it("rejects a missing key by name, without inventing a default", () => {
    expect(() => readEncryptionKey({})).toThrow(ENCRYPTION_KEY_ENV);
  });

  it("rejects a key of the wrong length and reports the length, never the value", () => {
    const short = crypto.randomBytes(16).toString("base64");
    let message = "";
    try {
      readEncryptionKey({ [ENCRYPTION_KEY_ENV]: short });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("16 bytes");
    expect(message).not.toContain(short);
  });

  it("reports configured state without throwing", () => {
    expect(encryptionConfigured({})).toBe(false);
    expect(
      encryptionConfigured({ [ENCRYPTION_KEY_ENV]: generateEncryptionKey() }),
    ).toBe(true);
  });
});

describe("encryptField / decryptField", () => {
  it("round-trips", () => {
    const blob = encryptField("Strider Flow 3 Running Shoes", AAD, KEY);
    expect(decryptField(blob, AAD, KEY)).toBe("Strider Flow 3 Running Shoes");
  });

  it("does not leave the plaintext in the ciphertext", () => {
    const blob = encryptField("Aarav Menon", AAD, KEY);
    expect(blob).not.toContain("Aarav");
    expect(blob).not.toContain("Menon");
    expect(isEncrypted(blob)).toBe(true);
  });

  it("produces a different ciphertext every time for the same input", () => {
    // A deterministic ciphertext would let anyone with the file see which rows
    // hold equal values, which for a name column is most of what they wanted.
    const a = encryptField("Divya Iyer", AAD, KEY);
    const b = encryptField("Divya Iyer", AAD, KEY);
    expect(a).not.toBe(b);
    expect(decryptField(a, AAD, KEY)).toBe(decryptField(b, AAD, KEY));
  });

  it("fails under the wrong key", () => {
    const blob = encryptField("Aarav Menon", AAD, KEY);
    expect(() => decryptField(blob, AAD, OTHER_KEY)).toThrow(DecryptionError);
  });

  it("fails when the ciphertext is modified", () => {
    const blob = encryptField("Aarav Menon", AAD, KEY);
    const parts = blob.split(".");
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] ^= 0xff;
    parts[3] = bytes.toString("base64url");
    expect(() => decryptField(parts.join("."), AAD, KEY)).toThrow(DecryptionError);
  });

  it("fails when the authentication tag is modified", () => {
    const blob = encryptField("Aarav Menon", AAD, KEY);
    const parts = blob.split(".");
    const tag = Buffer.from(parts[2], "base64url");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64url");
    expect(() => decryptField(parts.join("."), AAD, KEY)).toThrow(DecryptionError);
  });

  it("REFUSES A CIPHERTEXT MOVED TO ANOTHER ROW", () => {
    // The property the AAD exists for. Without it this decrypts perfectly:
    // the bytes are authentic, they are just in the wrong place, and the
    // application would show one person's cart line on another's request.
    const blob = encryptField("Universal Prepaid Gift Card", AAD, KEY);
    const otherRow = fieldAad("CartItem", "name", "itm_0002");
    expect(() => decryptField(blob, otherRow, KEY)).toThrow(DecryptionError);
  });

  it("refuses a ciphertext moved to another column of the same row", () => {
    const blob = encryptField("acc_QK19xTdP", fieldAad("PurchaseRequest", "sessionStructuredFields", "req_1"), KEY);
    const otherColumn = fieldAad("PurchaseRequest", "sessionFreeText", "req_1");
    expect(() => decryptField(blob, otherColumn, KEY)).toThrow(DecryptionError);
  });

  it("refuses a ciphertext moved to another model", () => {
    const blob = encryptField("Aarav Menon", fieldAad("Principal", "displayName", "x"), KEY);
    expect(() =>
      decryptField(blob, fieldAad("CartItem", "displayName", "x"), KEY),
    ).toThrow(DecryptionError);
  });

  it("rejects a value that is not in this format", () => {
    expect(() => decryptField("Aarav Menon", AAD, KEY)).toThrow(DecryptionError);
    expect(() => decryptField("bnc1.a.b", AAD, KEY)).toThrow(DecryptionError);
    expect(isEncrypted("Aarav Menon")).toBe(false);
  });

  it("never puts key material or plaintext into an error", () => {
    let message = "";
    try {
      decryptField(encryptField("Aarav Menon", AAD, KEY), AAD, OTHER_KEY);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("Aarav");
    expect(message).not.toContain(KEY.toString("base64"));
    expect(message).not.toContain(OTHER_KEY.toString("base64"));
  });

  it("round-trips empty and unicode content", () => {
    for (const value of ["", "₹20,000.00 — gift card", "日本語", "a".repeat(5000)]) {
      expect(decryptField(encryptField(value, AAD, KEY), AAD, KEY)).toBe(value);
    }
  });
});

/*
 * The rename from Bouncer to STEALTH moved the ciphertext prefix from `bnc1`
 * to `stl1`. That prefix is inside the AAD, so it is not a label: change it
 * without care and every row already in a database stops authenticating. The
 * failure would arrive as "could not be decrypted", which reads like a wrong
 * key, and the natural response to a wrong key is to generate a new one and
 * lose the data for good.
 */
describe("reading values written before the rename", () => {
  const MODEL = "CartItem";
  const FIELD = "name";
  const ID = "itm_0001";
  const PLAIN = "Strider Flow 3 Running Shoes";

  /** Byte-for-byte how the pre-rename code wrote a value. */
  const writtenAsBnc1 = () =>
    encryptField(PLAIN, fieldAad(MODEL, FIELD, ID, "bnc1"), KEY).replace(
      /^stl1\./,
      "bnc1.",
    );

  it("new values are written under the current scheme", () => {
    expect(encryptField(PLAIN, AAD, KEY).startsWith("stl1.")).toBe(true);
  });

  it("a bnc1 row still decrypts, under its own scheme", () => {
    const legacy = writtenAsBnc1();
    expect(legacy.startsWith("bnc1.")).toBe(true);
    expect(
      decryptField(legacy, fieldAad(MODEL, FIELD, ID, "bnc1"), KEY),
    ).toBe(PLAIN);
  });

  it("a bnc1 row does NOT authenticate under the new scheme's AAD", () => {
    // The guarantee that makes the version meaningful rather than cosmetic.
    expect(() =>
      decryptField(writtenAsBnc1(), fieldAad(MODEL, FIELD, ID, "stl1"), KEY),
    ).toThrow(DecryptionError);
  });

  it("recognises both schemes as ours, so re-encryption stays idempotent", () => {
    expect(isEncrypted(writtenAsBnc1())).toBe(true);
    expect(isEncrypted(encryptField(PLAIN, AAD, KEY))).toBe(true);
    expect(isEncrypted("acc_QK19xTdP")).toBe(false);
    expect(isEncrypted("xxxx.a.b.c")).toBe(false);
  });

  it("reports the scheme a stored value was written under", () => {
    expect(blobVersion(writtenAsBnc1())).toBe("bnc1");
    expect(blobVersion(encryptField(PLAIN, AAD, KEY))).toBe("stl1");
    expect(blobVersion("not encrypted")).toBeNull();
  });

  it("relocation is still refused across schemes", () => {
    const legacy = writtenAsBnc1();
    expect(() =>
      decryptField(legacy, fieldAad(MODEL, FIELD, "itm_0002", "bnc1"), KEY),
    ).toThrow(DecryptionError);
  });
});
