import { IconMandate } from "@/app/_components/icons";
import { Reveal } from "@/app/_components/reveal";
import {
  Chip,
  Field,
  FieldList,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/app/_components/ui";
import { formatDate, formatMinor, formatTimestamp } from "@/lib/format";
import { redactMiddle } from "@/lib/privacy/redact";
import type { MandateVerification } from "@/lib/mandate";
import type { Agent, Mandate, Principal } from "@/schemas";

import { VerificationChecks } from "./verification-checks";

export function MandatePanel({
  mandate,
  principal,
  agent,
  verification,
  purchaseRequestId,
}: {
  mandate: Mandate;
  principal: Principal;
  agent: Agent;
  verification: MandateVerification;
  /** Keys the reveal endpoint; the redacted values alone cannot address a row. */
  purchaseRequestId: string;
}) {
  return (
    <Panel>
      <PanelHeader
        icon={<IconMandate className="h-4 w-4" />}
        title="Mandate"
        meta={
          verification.valid ? (
            <Chip tone="quiet">verified</Chip>
          ) : (
            <span className="inline-flex items-center rounded-control border border-line-strong bg-inset px-2 py-[1px] font-mono text-label font-medium tracking-[0.04em] text-ink">
              verification failed
            </span>
          )
        }
      />
      <PanelBody className="flex flex-col gap-4">
        <FieldList>
          <Field label="Mandate ID">{mandate.id}</Field>
          <Field label="Principal" mono={false}>
            {principal.displayName}{" "}
            <span className="font-mono text-meta text-ink-3">
              {principal.id}
            </span>
          </Field>
          <Field label="Agent" mono={false}>
            {agent.operatorName}{" "}
            <span className="font-mono text-meta text-ink-3">
              {agent.id}
            </span>
          </Field>
          <Field label="Platform">{agent.platform}</Field>
        </FieldList>

        <div className="border-t border-line-soft pt-3">
          <FieldList>
            <Field label="Category scope" mono={false}>
              <span className="flex flex-wrap gap-1">
                {mandate.categoryScope.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-control border border-line bg-inset px-2 py-[1px] font-mono text-meta text-ink"
                  >
                    {scope}
                  </span>
                ))}
              </span>
            </Field>
            <Field label="Spend cap">
              <span className="text-body font-medium">
                {formatMinor(mandate.spendCapMinor)}
              </span>{" "}
              <span className="text-label text-ink-3">
                {mandate.spendCapMinor} paise
              </span>
            </Field>
            <Field label="Currency">{mandate.currency}</Field>
            <Field label="Expires">{formatDate(mandate.expiresAt)}</Field>
            <Field label="Issued">{formatTimestamp(mandate.createdAt)}</Field>
          </FieldList>
        </div>

        <div className="border-t border-line-soft pt-3">
          <FieldList>
            {/*
              Redacted on the SERVER. The full values are not in this markup,
              not in the React payload and not in view-source; the reveal
              button fetches one explicitly. A CSS blur here would have hidden
              them from the reader and from nobody else.
            */}
            <Field label="Nonce">
              <Reveal
                requestId={purchaseRequestId}
                field="nonce"
                label="mandate nonce"
                redacted={redactMiddle(mandate.nonce, { keepStart: 8, keepEnd: 4 })}
              />
            </Field>
            <Field label="Key ref">
              <Reveal
                requestId={purchaseRequestId}
                field="keyRef"
                label="agent key reference"
                redacted={redactMiddle(agent.publicKeyRef, { keepStart: 18, keepEnd: 4 })}
              />
            </Field>
            <Field label="Signature">
              <Reveal
                requestId={purchaseRequestId}
                field="signature"
                label="mandate signature"
                redacted={redactMiddle(mandate.signature, { keepStart: 16, keepEnd: 6 })}
              />
            </Field>
          </FieldList>
        </div>

        <div className="border-t border-line-soft pt-3">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="label-caps">Mandate verifier</h3>
            <span className="font-mono text-label tracking-[0.04em] text-ink-3">
              ed25519 · computed on read
            </span>
          </div>
          <VerificationChecks checks={verification.checks} />
        </div>
      </PanelBody>
    </Panel>
  );
}
