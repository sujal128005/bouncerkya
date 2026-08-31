import { Chip, Panel, PanelBody, PanelHeader } from "@/app/_components/ui";

/**
 * Mandate passed verification, so the request reached the Intent-Cart Engine —
 * but no diff exists, either because no API key was configured or because the
 * engine call failed. Both are reported as themselves. Inventing a diff to
 * fill this panel would be the single most dishonest thing this product could
 * do, so it does not.
 */
export function NoDiffPanel({
  failure,
}: {
  failure: { reason: string; details: string } | null;
}) {
  return (
    <Panel>
      <PanelHeader title="Authorization diff" meta={<Chip>not produced</Chip>} />
      <PanelBody className="flex flex-col gap-4">
        {failure ? (
          <div>
            <p className="text-body leading-[1.55] text-ink">
              The Intent-Cart Engine was called and did not return a usable
              diff: <span className="font-mono">{failure.reason}</span>.
            </p>
            <p className="mt-2 font-mono text-meta leading-[1.55] break-words text-ink-2">
              {failure.details}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-body leading-[1.55] text-ink">
              The Intent-Cart Engine was not called: no{" "}
              <span className="font-mono">ANTHROPIC_API_KEY</span> was
              configured when this scenario was seeded.
            </p>
            <p className="mt-2 text-meta leading-[1.55] text-ink-2">
              Set the key in <span className="font-mono">.env</span> and run{" "}
              <span className="font-mono">npm run db:reset</span> to compute
              this diff for real.
            </p>
          </div>
        )}

        <p className="border-l-2 border-line-strong pl-3 text-meta leading-[1.5] text-ink-3">
          No diff is shown rather than a fabricated one. A missing engine result
          is a real state, and Prompt 4&rsquo;s Policy Engine is what decides
          what it means.
        </p>
      </PanelBody>
    </Panel>
  );
}
