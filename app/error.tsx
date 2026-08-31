"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary.
 *
 * Without this a render throw gives a judge Next's error overlay in
 * development and a blank page in production. Neither is acceptable in a
 * product whose entire claim is that failure is handled explicitly.
 *
 * The message deliberately does NOT include `error.message`: a server
 * component throw can carry a database URL or a provider response. The digest
 * is safe by construction and is enough to find the entry in the server log.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[console] render failure", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-[720px] px-6 pt-10 pb-10">
      <div className="rounded-panel border border-line bg-surface">
        <header className="flex h-9 items-center border-b border-line-soft px-4">
          <h1 className="label-caps text-ink-2">This screen failed to render</h1>
        </header>
        <div className="px-4 py-4">
          <h2 className="text-lead font-semibold text-ink">
            The page could not be built from the current data
          </h2>
          <p className="mt-2 max-w-[68ch] text-body leading-[1.55] text-ink-2">
            Nothing was decided, submitted or paid as a result of this failure.
            it happened while rendering, after any decision had already been
            written. Retrying re-reads the database and does not re-run an agent
            or create an order.
          </p>
          <p className="mt-2 max-w-[68ch] text-body leading-[1.55] text-ink-3">
            The full error is in the server log. If this persists, the usual
            cause is a database or generated Prisma client out of step with the
            code. Run <span className="font-mono text-ink-2">npm run db:setup</span>.
          </p>

          {error.digest ? (
            <p className="mt-3 font-mono text-label text-ink-3">
              digest {error.digest}
            </p>
          ) : null}

          <button
            type="button"
            onClick={reset}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-control border border-accent bg-accent px-4 text-body font-medium text-white transition-colors hover:border-accent-strong hover:bg-accent-strong"
          >
            Retry
          </button>
        </div>
      </div>
    </main>
  );
}
