"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { IconHuman } from "@/app/_components/icons";
import {
  Chip,
  Meter,
  OutcomeBadge,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/app/_components/ui";
import type { StepUpStatus } from "@/schemas";

export type StepUpCardProps = {
  stepUpId: string;
  decisionId: string;
  requestId: string;
  status: StepUpStatus;
  respondedAt: string | null;
  principalName: string;
  agentName: string;
  itemName: string;
  itemCategory: string;
  quantity: number;
  totalFormatted: string;
  capFormatted: string;
  capUse: string;
  categoryScope: string[];
  confidence: string;
  confidenceValue: number;
  reason: string;
  clauseSummary: string;
  requestedAt: string;
  decidedAt: string;
};

const RESOLVED_COPY: Record<"approved" | "rejected" | "expired", string> = {
  approved: "Approved by the principal",
  rejected: "Rejected by the principal",
  expired: "Expired without an answer",
};

export function StepUpCard(props: StepUpCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolved = props.status !== "pending";
  const busy = submitting !== null || pending;

  async function respond(action: "approve" | "reject") {
    setSubmitting(action);
    setError(null);

    try {
      const response = await fetch(`/api/step-up/${props.stepUpId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { detail?: string }
          | null;
        setError(body?.detail ?? `request failed with ${response.status}`);
        return;
      }

      // Re-read from the server. The card renders persisted state, never a
      // local guess about what the server did.
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Panel>
      <PanelHeader
        icon={<IconHuman className="h-4 w-4" />}
        title="Step-up request"
        meta={
          <>
            <Chip tone="quiet">{props.stepUpId}</Chip>
            {resolved ? <Chip>answered</Chip> : <OutcomeBadge outcome="STEP_UP" />}
          </>
        }
      />

      <PanelBody className="flex flex-col gap-4">
        <div>
          <p className="text-body leading-[1.5] text-ink">
            <span className="font-medium">{props.agentName}</span> wants to buy{" "}
            <span className="font-medium">{props.itemName}</span> for{" "}
            <span className="font-mono">{props.totalFormatted}</span> on{" "}
            {props.principalName}&rsquo;s mandate.
          </p>
          <p className="mt-2 text-body leading-[1.55] text-ink-2">
            {props.reason}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line-soft pt-3 sm:grid-cols-2">
          <dl className="grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
            {/*
              Same treatment as the console's clause rows: one axis, one type
              size, a neutral rule on what was authorized and an amber rule on
              what was attempted. A step-up is by definition unresolved, so the
              deviation is marked for review — never as a decline.
            */}
            <dt className="label-caps pt-px">Authorized</dt>
            <dd className="border-l-2 border-line pl-3 font-mono text-meta text-ink-2">
              {props.categoryScope.join(", ")}
            </dd>
            <dt className="label-caps pt-px">Attempted</dt>
            <dd className="border-l-2 border-stepup pl-3 font-mono text-meta text-ink">
              {props.itemCategory}
            </dd>
            <dt className="label-caps pt-px">Quantity</dt>
            <dd className="border-l-2 border-transparent pl-3 font-mono text-meta text-ink-2">
              {props.quantity}
            </dd>
          </dl>

          <dl className="grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
            <dt className="label-caps pt-px">Amount</dt>
            <dd className="font-mono text-meta text-ink">
              {props.totalFormatted}
            </dd>
            <dt className="label-caps pt-px">Cap</dt>
            <dd className="font-mono text-meta text-ink-2">
              {props.capFormatted} · {props.capUse} used
            </dd>
            <dt className="label-caps pt-px">Confidence</dt>
            <dd className="flex items-center gap-2 font-mono text-meta text-ink-2">
              <span>{props.confidence}</span>
              <span className="w-16">
                <Meter value={props.confidenceValue} />
              </span>
            </dd>
          </dl>
        </div>

        <div className="border-t border-line-soft pt-3">
          <h3 className="label-caps mb-2">Why this was escalated</h3>
          <p className="text-meta leading-[1.55] text-ink-2">
            {props.clauseSummary}
          </p>
        </div>

        {error ? (
          <p className="rounded-control border border-line-strong bg-inset px-3 py-2 font-mono text-meta text-ink">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
          <div className="font-mono text-label text-ink-3">
            {/*
              The id is a link now. A reviewer looking at a one-paragraph
              summary and being asked to approve a payment should be one click
              from the full evidence, not expected to go and find it.
            */}
            <Link
              href={`/requests/${props.requestId}`}
              className="text-accent underline underline-offset-2 hover:text-accent-strong"
            >
              {props.requestId}
            </Link>{" "}
            · presented {props.requestedAt} · decided {props.decidedAt}
          </div>

          {resolved ? (
            <div className="flex items-center gap-3">
              <span className="font-mono text-meta text-ink">
                {RESOLVED_COPY[props.status as "approved" | "rejected" | "expired"]}
              </span>
              {props.respondedAt ? (
                <span className="font-mono text-label text-ink-3">
                  {props.respondedAt}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond("reject")}
                className="inline-flex h-9 items-center justify-center rounded-control px-4 transition-colors disabled:opacity-50 border border-line bg-surface text-body text-ink-2 hover:border-line-strong hover:text-ink"
              >
                {submitting === "reject" ? "Rejecting…" : "Reject"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond("approve")}
                className="inline-flex h-9 items-center justify-center rounded-control px-4 transition-colors disabled:opacity-50 border border-accent bg-accent text-body font-medium text-white hover:border-accent-strong hover:bg-accent-strong"
              >
                {submitting === "approve" ? "Approving…" : "Approve"}
              </button>
            </div>
          )}
        </div>

        {resolved ? (
          <p className="border-l-2 border-line-strong pl-3 text-meta leading-[1.5] text-ink-3">
            Written to the database and hash-chained into the audit log. Reload
            the page. This state persists.
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
