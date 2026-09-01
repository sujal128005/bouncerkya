import { describe, expect, it } from "vitest";

import { assertConfiguration, checkConfiguration } from "./config-check";

/** 32 bytes, so it is a structurally valid AES-256 key. Fixed rather than
 *  random so a failure is reproducible; it encrypts nothing real. */
const TEST_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

const OK = {
  DATABASE_URL: "file:./prisma/dev.db",
  BOUNCER_ENCRYPTION_KEY: TEST_KEY,
  BOUNCER_ENGINE_PRESET: "groq",
  BOUNCER_ENGINE_API_KEY: "gsk_placeholder",
  RAZORPAY_KEY_ID: "rzp_test_abc123",
  RAZORPAY_KEY_SECRET: "secret",
};

const fatalVariables = (env: Record<string, string | undefined>) =>
  checkConfiguration(env)
    .filter((p) => p.severity === "fatal")
    .map((p) => p.variable);

describe("configuration validation", () => {
  it("accepts a fully configured environment", () => {
    expect(fatalVariables(OK)).toEqual([]);
    expect(() => assertConfiguration(OK)).not.toThrow();
  });

  it("refuses to start without a database URL", () => {
    expect(fatalVariables({ ...OK, DATABASE_URL: undefined })).toContain(
      "DATABASE_URL",
    );
  });

  it("treats a blank string as unset, not as configured", () => {
    expect(fatalVariables({ ...OK, DATABASE_URL: "   " })).toContain(
      "DATABASE_URL",
    );
  });

  it("REFUSES A LIVE RAZORPAY KEY — the one that would move real money", () => {
    const problems = checkConfiguration({ ...OK, RAZORPAY_KEY_ID: "rzp_live_abc123" });
    const fatal = problems.find(
      (p) => p.variable === "RAZORPAY_KEY_ID" && p.severity === "fatal",
    );
    expect(fatal).toBeDefined();
    expect(() => assertConfiguration({ ...OK, RAZORPAY_KEY_ID: "rzp_live_abc" })).toThrow(
      /TEST-mode/,
    );
  });

  it("rejects a key id with a Razorpay key but no secret", () => {
    expect(fatalVariables({ ...OK, RAZORPAY_KEY_SECRET: undefined })).toContain(
      "RAZORPAY_KEY_SECRET",
    );
  });

  it("rejects an unknown engine preset", () => {
    expect(fatalVariables({ ...OK, BOUNCER_ENGINE_PRESET: "gpt5-turbo" })).toContain(
      "BOUNCER_ENGINE_PRESET",
    );
  });

  it("rejects a preset configured without an API key", () => {
    expect(fatalVariables({ ...OK, BOUNCER_ENGINE_API_KEY: undefined })).toContain(
      "BOUNCER_ENGINE_API_KEY",
    );
  });

  it("does NOT refuse to boot when optional backends are simply absent", () => {
    // The encryption key is part of the minimum now: it is the one capability
    // that may not silently degrade, because a deployment that fell back to
    // plaintext would still describe itself as encrypted.
    const minimal = {
      DATABASE_URL: "file:./prisma/dev.db",
      BOUNCER_ENCRYPTION_KEY: TEST_KEY,
    };
    expect(fatalVariables(minimal)).toEqual([]);
    expect(() => assertConfiguration(minimal)).not.toThrow();

    // ...but it does say what will degrade.
    const warnings = checkConfiguration(minimal).filter((p) => p.severity === "warning");
    expect(warnings.map((w) => w.variable)).toEqual(
      expect.arrayContaining(["BOUNCER_ENGINE_API_KEY", "RAZORPAY_KEY_ID"]),
    );
  });

  it("never puts a configured value into a message", () => {
    const secretish = "rzp_live_SUPERSECRETVALUE";
    const problems = checkConfiguration({ ...OK, RAZORPAY_KEY_ID: secretish });
    for (const problem of problems) {
      expect(problem.detail).not.toContain(secretish);
      expect(problem.detail).not.toContain("SUPERSECRET");
    }
  });
});

describe("the encryption key", () => {
  it("is fatal when missing, with no plaintext fallback", () => {
    const problems = checkConfiguration({
      ...OK,
      BOUNCER_ENCRYPTION_KEY: undefined,
    });
    const problem = problems.find(
      (p) => p.variable === "BOUNCER_ENCRYPTION_KEY",
    );
    expect(problem?.severity).toBe("fatal");
    expect(problem?.detail).toContain("will not fall back to plaintext");
  });

  it("is fatal when the wrong length, and reports the length not the value", () => {
    const short = "c2hvcnRrZXk=";
    const problems = checkConfiguration({
      ...OK,
      BOUNCER_ENCRYPTION_KEY: short,
    });
    const problem = problems.find(
      (p) => p.variable === "BOUNCER_ENCRYPTION_KEY",
    );
    expect(problem?.severity).toBe("fatal");
    expect(problem?.detail).toContain("bytes");
    expect(problem?.detail).not.toContain(short);
  });

  it("accepts a correct 32-byte key", () => {
    const problems = checkConfiguration(OK).filter(
      (p) => p.variable === "BOUNCER_ENCRYPTION_KEY",
    );
    expect(problems).toEqual([]);
  });
});

/*
 * These cover a mistake that actually happened, not a hypothetical one. Two
 * variables were written on one line of .env; dotenv gave the first a value
 * containing the second's name and never defined the second; the seeder threw
 * on "unknown preset" after deleting the old rows; and the console reported an
 * empty database. Every message in that chain described a symptom.
 */
describe("two variables on one line", () => {
  const MERGED = {
    ...OK,
    BOUNCER_ENGINE_PRESET: 'gemini" BOUNCER_ENGINE_API_KEY="AQ.Ab8RN6K',
    BOUNCER_ENGINE_API_KEY: undefined,
  };

  it("is fatal, and names the variable that got swallowed", () => {
    const problem = checkConfiguration(MERGED).find(
      (p) => p.variable === "BOUNCER_ENGINE_PRESET" && p.detail.includes("one line"),
    );
    expect(problem?.severity).toBe("fatal");
    expect(problem?.detail).toContain("BOUNCER_ENGINE_API_KEY");
  });

  it("is reported before the unknown-preset complaint it causes", () => {
    const details = checkConfiguration(MERGED)
      .filter((p) => p.variable === "BOUNCER_ENGINE_PRESET")
      .map((p) => p.detail);
    const merged = details.findIndex((d) => d.includes("one line"));
    const unknown = details.findIndex((d) => d.includes("Unknown preset"));
    expect(merged).toBeGreaterThanOrEqual(0);
    expect(unknown).toBeGreaterThanOrEqual(0);
    expect(merged).toBeLessThan(unknown);
  });

  it("never reports the value itself, only the name it swallowed", () => {
    for (const problem of checkConfiguration(MERGED)) {
      expect(problem.detail).not.toContain("AQ.Ab8RN6K");
    }
  });

  it("does not fire on a legitimate value that merely contains an equals sign", () => {
    // Base64 pads with "=", and a connection string can carry "?x=1".
    const problems = checkConfiguration({
      ...OK,
      DATABASE_URL: "file:./prisma/dev.db?connection_limit=1",
      BOUNCER_ENGINE_API_KEY: "gsk_abc==",
    }).filter((p) => p.detail.includes("one line"));
    expect(problems).toEqual([]);
  });
});
