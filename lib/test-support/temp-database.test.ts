import { afterEach, describe, expect, it, vi } from "vitest";

import { removeTempDatabase } from "./temp-database";

/*
 * This exists because a teardown bug reported a green run as a failure: 277
 * passing assertions, one FAIL, caused by fs.rmSync throwing EPERM on Windows
 * while SQLite still held the file open. The behaviour is platform-specific,
 * so the lock is injected rather than provoked. Chmod-ing a directory and
 * hoping would prove nothing here: the CI container runs as root, and root
 * ignores directory permissions.
 */

const lockError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: operation not permitted`), { code });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("removing a temp database", () => {
  it("removes the database and every sidecar SQLite may have written", () => {
    const removed: string[] = [];
    removeTempDatabase("/tmp/x.db", (t) => void removed.push(t));
    expect(removed).toEqual([
      "/tmp/x.db",
      "/tmp/x.db-journal",
      "/tmp/x.db-wal",
      "/tmp/x.db-shm",
    ]);
  });

  it("retries a locked file rather than giving up on the first EPERM", () => {
    let calls = 0;
    removeTempDatabase("/tmp/x.db", (t) => {
      if (t.endsWith(".db") && ++calls < 3) throw lockError("EPERM");
    });
    expect(calls).toBe(3);
  });

  it("warns and continues when the handle is never released", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      removeTempDatabase("/tmp/x.db", () => {
        throw lockError("EBUSY");
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain("Disconnect the Prisma client");
  });

  it("still deletes the sidecars after giving up on the main file", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    removeTempDatabase(
      "/tmp/x.db",
      (t) => {
        seen.push(t);
        if (t.endsWith(".db")) throw lockError("EACCES");
      },
      2,
    );
    expect(seen).toContain("/tmp/x.db-wal");
  });

  it("does not swallow an error that is not a lock", () => {
    expect(() =>
      removeTempDatabase("/tmp/x.db", () => {
        throw lockError("ENOSPC");
      }),
    ).toThrow(/ENOSPC/);
  });
});
