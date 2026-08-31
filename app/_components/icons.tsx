/**
 * The icon set.
 *
 * ONE family, drawn to one spec: 1.5px strokes, 24x24 viewBox, round caps,
 * `currentColor` so an icon inherits the meaning of the text beside it. Mixing
 * icon families is one of the fastest ways to make an interface look assembled
 * rather than designed, so everything here is hand-drawn to match.
 *
 * Every icon is SEMANTIC. Each one names a stage of the pipeline or a state a
 * decision can be in, and none exists to fill space. If a heading would read
 * exactly the same without its icon, the icon should not be there — the icons
 * are here so the eye can find "the credential section" or "the verdict"
 * without reading, which is the actual navigation complaint they answer.
 *
 * `aria-hidden` on all of them: every icon sits beside a text label, so a
 * screen reader announcing both would just stutter. Meaning is never carried
 * by the glyph alone.
 */

type IconProps = { className?: string };

const base = "shrink-0";

function Svg({
  className = "",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`${base} ${className}`}
    >
      {children}
    </svg>
  );
}

/** Mandate — a signed credential. */
export function IconMandate({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <circle cx="12" cy="13" r="2.5" />
      <path d="M12 15.5V19l-1.5-1-1.5 1v-3.5" />
    </Svg>
  );
}

/** Cart — what the agent is attempting. */
export function IconCart({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 4h2l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h7.9a1.5 1.5 0 0 0 1.5-1.2L20 7H6" />
      <circle cx="9" cy="19.5" r="1.2" />
      <circle cx="17" cy="19.5" r="1.2" />
    </Svg>
  );
}

/** Diff — the authorized/attempted comparison. */
export function IconDiff({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h7M4 12h7M4 17h7" />
      <path d="M17 4v16" />
      <path d="M14 8l3-3 3 3" />
    </Svg>
  );
}

/** Outcome — the deterministic verdict. */
export function IconVerdict({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

/** Audit chain — linked, tamper-evident records. */
export function IconChain({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9.5 14.5l5-5" />
      <path d="M13 7l1.5-1.5a3.5 3.5 0 0 1 5 5L18 12" />
      <path d="M11 17l-1.5 1.5a3.5 3.5 0 0 1-5-5L6 12" />
    </Svg>
  );
}

/** Step-up — escalated to a human. */
export function IconHuman({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  );
}

/**
 * Live agent: a program acting on someone's behalf.
 *
 * This was a robot head — rounded box, antenna, two dot eyes — which is the
 * single most overused glyph in software that touches a model, and it is a
 * face, which makes the agent look like a character with intentions. This
 * product's entire argument is that the agent is untrusted software, not a
 * personality. A terminal prompt says "a program is doing this" without
 * inviting anyone to sympathise with it.
 */
export function IconAgent({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10l2.5 2L7 14" />
      <path d="M12.5 14.5h4" />
    </Svg>
  );
}

/** Requests table — a ledger of attempts. */
export function IconLedger({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 9h16M9 9v11" />
    </Svg>
  );
}
