import { describe, expect, it } from "vitest";

import {
  LEGACY_PREFIX,
  PREFIX,
  SETTINGS,
  bothNames,
  legacyName,
  setting,
  settingName,
  settingSource,
} from "./env-vars";

/*
 * The rename from Bouncer to STEALTH touched ten environment variables. The
 * danger was never the new names; it was that an existing .env would keep
 * parsing, supply nothing, and degrade exactly as it does when a key is
 * genuinely absent. That failure looks identical to the real one, and the
 * database in question is already encrypted under the old key's value.
 */

describe("reading a setting under either name", () => {
  it("prefers the new name", () => {
    expect(
      setting("ENGINE_PRESET", {
        STEALTH_ENGINE_PRESET: "groq",
        BOUNCER_ENGINE_PRESET: "gemini",
      }),
    ).toBe("groq");
  });

  it("falls back to the pre-rename name, so an old .env still works", () => {
    expect(setting("ENGINE_PRESET", { BOUNCER_ENGINE_PRESET: "gemini" })).toBe(
      "gemini",
    );
  });

  it("treats blank as unset under both names", () => {
    expect(
      setting("ENGINE_API_KEY", {
        STEALTH_ENGINE_API_KEY: "   ",
        BOUNCER_ENGINE_API_KEY: "",
      }),
    ).toBeUndefined();
  });

  it("does not fall through to the old name when the new one is blank but the old one is set", () => {
    // A blank new value is not a decision to unset; it is an empty line.
    expect(
      setting("ENGINE_PRESET", {
        STEALTH_ENGINE_PRESET: "",
        BOUNCER_ENGINE_PRESET: "groq",
      }),
    ).toBe("groq");
  });

  it("returns undefined when neither is present", () => {
    expect(setting("ENCRYPTION_KEY", {})).toBeUndefined();
  });

  it("trims, because a trailing space in a .env line is not part of the value", () => {
    expect(setting("ENGINE_MODEL", { STEALTH_ENGINE_MODEL: " gpt-x \n" })).toBe(
      "gpt-x",
    );
  });
});

describe("naming", () => {
  it("builds both spellings from one setting", () => {
    expect(bothNames("ENCRYPTION_KEY")).toEqual([
      "STEALTH_ENCRYPTION_KEY",
      "BOUNCER_ENCRYPTION_KEY",
    ]);
  });

  it("reports which spelling actually supplied the value", () => {
    expect(settingSource("ENGINE_PRESET", { BOUNCER_ENGINE_PRESET: "groq" })).toBe(
      "BOUNCER_ENGINE_PRESET",
    );
    expect(settingSource("ENGINE_PRESET", { STEALTH_ENGINE_PRESET: "groq" })).toBe(
      "STEALTH_ENGINE_PRESET",
    );
    expect(settingSource("ENGINE_PRESET", {})).toBeNull();
  });

  it("keeps the two prefixes distinct", () => {
    expect(PREFIX).not.toBe(LEGACY_PREFIX);
    for (const name of SETTINGS) {
      expect(settingName(name)).not.toBe(legacyName(name));
      expect(settingName(name).startsWith(PREFIX)).toBe(true);
    }
  });

  it("never claims a vendor variable as one of ours", () => {
    // ANTHROPIC_API_KEY is Anthropic's name and is read directly, not through
    // this module. Prefixing it would invent a variable nobody sets.
    expect(SETTINGS as readonly string[]).not.toContain("ANTHROPIC_API_KEY");
  });
});
