import { Reveal } from "@/app/_components/reveal";
import { redactMiddle } from "@/lib/privacy/redact";
import { IconCart } from "@/app/_components/icons";
import {
  Chip,
  Meter,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/app/_components/ui";
import { capUtilisation, formatMinor, formatTimestamp } from "@/lib/format";
import type { Mandate, PurchaseRequest } from "@/schemas";

function StructuredField({
  name,
  value,
  requestId,
}: {
  name: string;
  value: unknown;
  requestId: string;
}) {
  const rendered =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "null");

  // The merchant account id is the one field in this block that identifies a
  // party rather than describing the purchase, so it is the one that is
  // redacted. The rest is listing metadata a reviewer needs in full.
  if (name === "merchantId" && typeof value === "string") {
    return (
      <>
        <dt className="font-mono text-meta text-ink-3">{name}</dt>
        <dd className="break-words">
          <Reveal
            requestId={requestId}
            field="merchantId"
            label="merchant account id"
            redacted={redactMiddle(value, { keepStart: 4, keepEnd: 0 })}
          />
        </dd>
      </>
    );
  }

  return (
    <>
      <dt className="font-mono text-meta text-ink-3">{name}</dt>
      <dd className="font-mono text-meta break-words text-ink-2">{rendered}</dd>
    </>
  );
}

export function CartPanel({
  request,
  mandate,
}: {
  request: PurchaseRequest;
  mandate: Mandate;
}) {
  const overCap = request.totalMinor > mandate.spendCapMinor;
  const { structuredFields, freeText, injectionMarkerDetected } =
    request.sessionContext;

  return (
    <Panel>
      <PanelHeader
        icon={<IconCart className="h-4 w-4" />}
        title="Attempted cart"
        meta={
          <>
            <Chip tone="quiet">{request.items.length} line</Chip>
            <Chip>{request.id}</Chip>
          </>
        }
      />

      <PanelBody className="flex flex-col gap-4">
        {/*
          The line-item table has four columns of numbers that cannot usefully
          shrink. On a narrow screen it scrolls inside this box rather than
          widening the document — measured at 390px, where it previously pushed
          the whole page 48px sideways.
        */}
        {/* min-w-0: a flex child defaults to min-width:auto, which lets its
            content push past the container and defeats overflow-x-auto. */}
        <div className="-mx-1 min-w-0 overflow-x-auto px-1">
          <table className="w-full min-w-[300px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className="label-caps w-full py-1.5 text-left font-medium">
                  Item
                </th>
                <th className="label-caps py-1.5 pl-4 text-right font-medium">
                  Qty
                </th>
                <th className="label-caps py-1.5 pl-4 text-right font-medium">
                  Unit
                </th>
                <th className="label-caps py-1.5 pl-4 text-right font-medium">
                  Line
                </th>
              </tr>
            </thead>
            <tbody>
              {request.items.map((item) => (
                <tr
                  key={item.sourceListingId}
                  className="border-b border-line-soft align-top"
                >
                  <td className="py-2 pr-3">
                    <div className="text-body text-ink">{item.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-label text-ink-3">
                      <span>{item.category}</span>
                      <span aria-hidden>·</span>
                      <span>{item.sourceListingId}</span>
                    </div>
                  </td>
                  <td className="py-2 pl-4 text-right font-mono text-meta whitespace-nowrap text-ink">
                    {item.quantity}
                  </td>
                  <td className="py-2 pl-4 text-right font-mono text-meta whitespace-nowrap text-ink-2">
                    {formatMinor(item.unitPriceMinor)}
                  </td>
                  <td className="py-2 pl-4 text-right font-mono text-meta whitespace-nowrap text-ink">
                    {formatMinor(item.unitPriceMinor * item.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="label-caps">Cart total</span>
          <span className="font-mono text-head font-medium text-ink">
            {formatMinor(request.totalMinor)}
          </span>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between font-mono text-label text-ink-3">
            <span>
              {capUtilisation(request.totalMinor, mandate.spendCapMinor)} of cap
            </span>
            <span>
              cap {formatMinor(mandate.spendCapMinor)}
              {overCap ? " · exceeded" : ""}
            </span>
          </div>
          <Meter value={request.totalMinor / mandate.spendCapMinor} />
        </div>

        <div className="border-t border-line-soft pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="label-caps">Session context</h3>
            <span className="font-mono text-label tracking-[0.04em] text-ink-3">
              injection marker:{" "}
              <span className={injectionMarkerDetected ? "text-ink" : ""}>
                {injectionMarkerDetected ? "detected" : "none"}
              </span>
            </span>
          </div>

          <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1">
            {Object.entries(structuredFields).map(([name, value]) => (
              <StructuredField
                key={name}
                name={name}
                value={value}
                requestId={request.id}
              />
            ))}
          </dl>

          {freeText ? (
            <div className="mt-2">
              <div className="mb-1 font-mono text-label tracking-[0.04em] text-ink-3">
                free text · untrusted
              </div>
              <p
                className={`rounded-control border bg-inset px-3 py-2 font-mono text-meta leading-[1.6] break-words ${
                  injectionMarkerDetected
                    ? "border-line-strong text-ink"
                    : "border-line-soft text-ink-2"
                }`}
              >
                {freeText}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-baseline justify-between border-t border-line-soft pt-3 font-mono text-label text-ink-3">
          <span>presented</span>
          <span>{formatTimestamp(request.requestedAt)}</span>
        </div>
      </PanelBody>
    </Panel>
  );
}
