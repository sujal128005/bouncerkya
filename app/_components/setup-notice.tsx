/**
 * Shown instead of a stack trace when the database, the generated Prisma
 * client or the keystore is out of step with the code — the usual state after
 * pulling changes and starting the dev server before re-running setup.
 */
export function SetupNotice({
  title,
  message,
  command = "npm run db:setup",
}: {
  title: string;
  message: string;
  command?: string;
}) {
  return (
    <main className="mx-auto max-w-[720px] px-6 pt-10 pb-10">
      <div className="rounded-panel border border-line bg-surface">
        <header className="flex h-9 items-center border-b border-line-soft px-4">
          <h1 className="label-caps text-ink-2">Database not ready</h1>
        </header>
        <div className="px-4 py-3">
          <h2 className="text-lead font-semibold text-ink">{title}</h2>
          <p className="mt-2 text-body leading-[1.55] text-ink-2">
            {message}
          </p>
          <p className="mt-3 label-caps">Run this, then reload</p>
          <pre className="mt-2 overflow-x-auto rounded-control border border-line-soft bg-inset px-3 py-2 font-mono text-meta text-ink">
            {command}
          </pre>
        </div>
      </div>
    </main>
  );
}
