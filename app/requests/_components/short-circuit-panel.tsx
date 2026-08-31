import { Chip, Panel, PanelBody, PanelHeader } from "@/app/_components/ui";
import type { MandateVerification } from "@/lib/mandate";

/**
 * Shown in place of the Authorization Diff when the Mandate Verifier rejected
 * the credential. There is nothing to diff: the request never reached the
 * Intent-Cart Engine, so no model was called and no diff exists.
 */
export function ShortCircuitPanel({
  verification,
  latencyMs,
}: {
  verification: MandateVerification;
  latencyMs: number;
}) {
  return (
    <Panel>
      <PanelHeader
        title="Authorization diff"
        meta={<Chip>not produced</Chip>}
      />

      <PanelBody className="flex flex-col gap-4">
        <div>
          <p className="text-body leading-[1.55] text-ink">
            Blocked before reaching AI reasoning. Mandate Verifier failed:{" "}
            <span className="font-mono">{verification.failureReason}</span>.
          </p>
          <p className="mt-2 text-meta leading-[1.55] text-ink-2">
            {verification.detail}
          </p>
        </div>

        <dl className="grid grid-cols-[128px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-line-soft pt-3">
          <dt className="label-caps pt-px">Diff produced</dt>
          <dd className="font-mono text-meta text-ink">none</dd>
          <dt className="label-caps pt-px">Model calls</dt>
          <dd className="font-mono text-meta text-ink">0</dd>
          <dt className="label-caps pt-px">Resolved in</dt>
          <dd className="font-mono text-meta text-ink-2">
            {latencyMs === 0 ? "<1 ms" : `${latencyMs} ms`}
          </dd>
          <dt className="label-caps pt-px">Full checks</dt>
          <dd className="text-meta text-ink-2">see the Mandate panel</dd>
        </dl>

        <p className="border-l-2 border-line-strong pl-3 text-meta leading-[1.5] text-ink-3">
          Credential failures are decidable without a model. Resolving them here
          keeps the Intent-Cart Engine for questions that actually need
          judgement.
        </p>
      </PanelBody>
    </Panel>
  );
}
