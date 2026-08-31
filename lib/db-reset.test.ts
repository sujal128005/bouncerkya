import { describe, expect, it, vi } from "vitest";

import {
  DatabaseLockedError,
  LOCKED_CODES,
  removeDatabaseFiles,
} from "./db-reset";

/**
 * The failure branch is the whole point of this script, and it is the branch
 * that cannot be produced in a test by locking a real file: there is no
 * portable way to do it, and root ignores directory permissions entirely. An
 * earlier attempt to prove it by chmod-ing a directory passed while exercising
 * nothing. So the remover is injected and made to fail on demand.
 */

const DB = "/tmp/proj/prisma/dev.db";
const always = () => true;

describe("removeDatabaseFiles", () => {
  it("removes the database and its SQLite sidecars", () => {
    const removed: string[] = [];
    removeDatabaseFiles(DB, (t) => void removed.push(t), always);
    expect(removed).toEqual([DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]);
  });

  it("skips files that are not there", () => {
    const removed: string[] = [];
    removeDatabaseFiles(DB, (t) => void removed.push(t), (p) => p === DB);
    expect(removed).toEqual([DB]);
  });

  it.each(LOCKED_CODES)("reports a %s lock as a human instruction", (code) => {
    const remover = vi.fn(() => {
      throw Object.assign(new Error("boom"), { code });
    });
    let caught: unknown;
    try {
      removeDatabaseFiles(DB, remover, always);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DatabaseLockedError);
    const message = (caught as Error).message;
    expect(message).toContain("something has it open");
    expect(message).toContain("taskkill /IM node.exe /F");
    expect(message).toContain("Nothing was changed");
    // No Node stack-trace vocabulary: that is what this replaced.
    expect(message).not.toContain("rmSync");
    expect(message).not.toContain("ERR_");
  });

  it("stops at the first lock rather than deleting the sidecars anyway", () => {
    const remover = vi.fn(() => {
      throw Object.assign(new Error("boom"), { code: "EPERM" });
    });
    expect(() => removeDatabaseFiles(DB, remover, always)).toThrow(
      DatabaseLockedError,
    );
    expect(remover).toHaveBeenCalledTimes(1);
  });

  it("rethrows anything that is not a lock, unchanged", () => {
    const remover = vi.fn(() => {
      throw Object.assign(new Error("disk on fire"), { code: "EIO" });
    });
    expect(() => removeDatabaseFiles(DB, remover, always)).toThrow("disk on fire");
  });
});
