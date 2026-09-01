import { afterEach, describe, expect, it, vi } from "vitest";

import { describeAgent, isAgentConfigured, resolveAgentConfig } from "./provider";

afterEach(() => {
  vi.unstubAllEnvs();
});

/*
 * isAgentConfigured() is the first line of the POST handler behind the live
 * agent button, outside any try/catch. When it threw, an unknown preset turned
 * the demo's most important control into an unhandled 500 rather than the
 * "no model backend is configured" response the route was written to return.
 */
describe("agent provider under a misconfigured preset", () => {
  const stubUnknownPreset = () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("BOUNCER_ENGINE_API_KEY", "key");
    vi.stubEnv("BOUNCER_ENGINE_BASE_URL", "");
    vi.stubEnv("BOUNCER_AGENT_MODEL", "");
    vi.stubEnv("BOUNCER_ENGINE_PRESET", "not-a-real-preset");
  };

  it("resolveAgentConfig propagates the error, because it returns a config", () => {
    stubUnknownPreset();
    expect(() => resolveAgentConfig()).toThrow(/Unknown BOUNCER_ENGINE_PRESET/);
  });

  it("isAgentConfigured answers false instead of throwing", () => {
    stubUnknownPreset();
    expect(() => isAgentConfigured()).not.toThrow();
    expect(isAgentConfigured()).toBe(false);
  });

  it("describeAgent names the problem instead of crashing a status line", () => {
    stubUnknownPreset();
    expect(describeAgent()).toMatch(/^misconfigured \(/);
  });

  it("still reports not configured when nothing at all is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("BOUNCER_ENGINE_API_KEY", "");
    vi.stubEnv("BOUNCER_ENGINE_PRESET", "");
    vi.stubEnv("BOUNCER_ENGINE_BASE_URL", "");
    expect(isAgentConfigured()).toBe(false);
    expect(describeAgent()).toBe("not configured");
  });
});
