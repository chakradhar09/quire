// Base parts (components.md: Base, Feedback). No client state, usable from server components.
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { Fragment, ViewTransition } from "react";
import Link from "next/link";
import { AutoHideHeader } from "./auto-hide-header";
import { AlertTriangle, Check, CheckCircle2, Info, Loader2, OctagonAlert, X } from "lucide-react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const VARIANT = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-bg text-text border border-border-input hover:bg-surface",
  ghost: "bg-transparent text-text hover:bg-surface",
  danger: "bg-danger text-on-accent hover:opacity-90",
  // Hover stays light so the dark text keeps its contrast (the page colour is dark green in dark mode).
  shell: "bg-on-shell text-shell hover:bg-on-shell-muted",
  shellGhost: "bg-transparent text-on-shell hover:bg-on-shell/10",
};
const SIZE = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };
const ICON_SIZE = { sm: "h-8 w-8 text-sm", md: "h-10 w-10 text-sm", lg: "h-12 w-12 text-base" };

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  loading?: boolean;
  iconOnly?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
};

// Also for links that look like buttons (<Link className={buttonClass()}>).
export function buttonClass(variant: keyof typeof VARIANT = "primary", size: keyof typeof SIZE = "md", iconOnly?: boolean) {
  return cx(
    "focus-ring inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-[background-color,color,scale] active:scale-[.98]",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
    VARIANT[variant],
    iconOnly ? ICON_SIZE[size] : SIZE[size],
  );
}

export function Button({ variant = "primary", size = "md", loading, iconOnly, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonClass(variant, size, iconOnly), className)}
    >
      {loading && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />}
      {children}
    </button>
  );
}

// hideLabel: for toolbar fields whose purpose is plain from the control; the label stays for screen readers.
export type FieldShell = { id: string; label: string; hint?: string; error?: string; hideLabel?: boolean };

// Label, control, hint or error: shared by every field here and the dropdown in overlays.tsx.
export function FieldFrame({ id, label, hint, error, hideLabel, children }: FieldShell & { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-sm font-semibold"}>{label}</label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export const INPUT = cx(
  "focus-ring w-full rounded-md border border-border-input bg-bg px-3 text-base transition-colors",
  "hover:border-text placeholder:text-muted disabled:bg-surface disabled:text-muted read-only:bg-surface",
  "aria-invalid:border-danger",
);

export const describedBy = (id: string, hint?: string, error?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function TextField({ id, label, hint, error, unit, ...rest }: FieldShell & { unit?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <div className="flex items-center gap-2">
        <input id={id} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, hint, error)} className={cx(INPUT, "h-10")} {...rest} />
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
    </FieldFrame>
  );
}

// Grows with what is typed up to 60% of the screen, then scrolls inside itself, so a long paste never
// stretches the page.
export function TextArea({ id, label, hint, error, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error}>
      <textarea id={id} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, hint, error)}
        className={cx(INPUT, "min-h-60 max-h-[min(60vh,40rem)] overflow-y-auto py-3 font-serif text-doc [field-sizing:content]")} {...rest} />
    </FieldFrame>
  );
}

export function Checkbox({ id, label, ...rest }: { id: string; label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" className="focus-ring size-4 rounded-sm accent-accent" {...rest} />
      {label}
    </label>
  );
}

const ALERT = {
  info: { box: "bg-info-surface", title: "text-info", Icon: Info },
  success: { box: "bg-success-surface", title: "text-success", Icon: CheckCircle2 },
  warning: { box: "bg-warning-surface", title: "text-warning", Icon: AlertTriangle },
  danger: { box: "bg-danger-surface", title: "text-danger", Icon: OctagonAlert },
};

export function InlineAlert({ variant = "info", title, children, live }: { variant?: keyof typeof ALERT; title: string; children?: ReactNode; live?: boolean }) {
  const { box, title: titleClass, Icon } = ALERT[variant];
  return (
    <div role={live ? "alert" : undefined} className={cx("flex gap-3 rounded-md px-4 py-3 text-sm", box)}>
      <Icon aria-hidden className={cx("mt-0.5 size-4 shrink-0", titleClass)} />
      <div>
        <p className={cx("font-semibold", titleClass)}>{title}</p>
        {children && <div className="mt-1 text-text">{children}</div>}
      </div>
    </div>
  );
}

// Known progress fills from the left (scaled, so only transform animates); unknown progress travels the track.
// fillStyle: timing for the fill's transition when it is part of a chain (transit() in lib/motion.ts).
export function ProgressBar({ value, label, fillStyle }: { value?: number; label: string; fillStyle?: CSSProperties }) {
  if (value === undefined) {
    return (
      <div role="progressbar" aria-label={label} className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken">
        <div className="scan-x h-full w-1/3 rounded-pill bg-accent" />
      </div>
    );
  }
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken">
      <div className="h-full origin-left rounded-pill bg-accent transition-transform duration-(--motion-base) ease-(--motion-ease) motion-reduce:transition-none"
        style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})`, ...fillStyle }} />
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return <Loader2 role="img" aria-label={label} className="size-4 text-muted motion-safe:animate-spin" />;
}

const PILL = {
  queued: { cls: "bg-info-surface text-info", text: "Queued", live: true },
  processing: { cls: "bg-info-surface text-info", text: "Checking", live: true },
  recalculating: { cls: "bg-info-surface text-info", text: "Recalculating", live: true },
  waiting: { cls: "bg-warning-surface text-warning", text: "Waiting for worker", live: false },
  error: { cls: "bg-danger-surface text-danger", text: "Check failed", live: false },
  rejected: { cls: "bg-danger-surface text-danger", text: "Can't read file", live: false },
};

export function StatusPill({ status }: { status: keyof typeof PILL }) {
  const { cls, text, live } = PILL[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-sm border border-current/25 px-2 py-0.5 text-xs font-medium", cls)}>
      <span aria-hidden className={cx("size-1.5 rounded-pill bg-current", live && "breathe")} />
      {text}
    </span>
  );
}

// A page of the pad drawn small: ruled lines, the red margin rule down its left. Stands in for a draft in
// the empty state and the checking sequence. filled (0 to 1): the share of lines written in, which the
// checking sequence raises as steps finish; the lines fade in, so nothing moves on load.
function PadPage({ lines, filled = 0, className }: { lines: number[]; filled?: number; className?: string }) {
  return (
    <div aria-hidden className={cx("sheet relative flex shrink-0 flex-col gap-2 rounded-sm py-3 pr-2.5 pl-5",
      "before:absolute before:inset-y-0 before:left-3 before:w-px before:bg-rule/50", className)}>
      {lines.map((w, i) => (
        <span key={i} className="relative h-px bg-border-input/50" style={{ width: `${w * 100}%` }}>
          <span className={cx("absolute inset-0 bg-text/60 transition-opacity duration-(--motion-slow)",
            i < Math.round(filled * lines.length) ? "opacity-100" : "opacity-0")} />
        </span>
      ))}
    </div>
  );
}

// A blank page on the pad: nothing has been written yet.
export function EmptyState({ title, body, action }: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <PadPage lines={[1, 1, 1, 1, 1, 1, 1, 1, 1]} className="mb-3 h-28 w-22" />
      <p className="text-lg">{title}</p>
      <p className="max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("rounded-sm bg-surface-sunken motion-safe:animate-pulse", className)} />;
}

// A title that wraps at its own separators (underscore, dot, slash, hyphen) before it breaks inside a word,
// so "Lab_Report_2_SoilErosionSurvey" splits at an underscore, not mid-word. <wbr> adds nothing to
// copied text.
export function withBreaks(text: string): ReactNode {
  const parts = text.split(/(?<=[_./-])/);
  return parts.length < 2 ? text : parts.map((p, i) => <Fragment key={i}>{p}{i < parts.length - 1 && <wbr />}</Fragment>);
}

// Every draft keeps one entry number for life, in the list, the report headers and the tab title.
export const exhibit = (id: number) => `No. ${String(id).padStart(3, "0")}`;

// Named so the tag and title morph from the drafts list into the report header.
// inline: the number sits in its own narrow column beside the title (lists), centred on the title block
// however many lines it wraps to, and `below` hangs under the title, not the number; otherwise the number
// sits above the title (headers). href links the title only.
// clamp: a long title shows two lines (the whole title is in its tooltip), for headers that must stay short.
export function ExhibitTitle({ id, title, as: Tag = "span", inline, href, below, className, clamp }: {
  id: number; title: string; as?: "span" | "h1"; inline?: boolean; href?: string; below?: ReactNode; className?: string; clamp?: boolean;
}) {
  const link = href ? <Link href={href} className="focus-ring rounded-sm hover:text-accent">{withBreaks(title)}</Link> : withBreaks(title);
  const name = clamp ? <span className="line-clamp-2" title={title}>{link}</span> : link;
  return (
    <ViewTransition name={`exhibit-${id}`} share="exhibit" default="none">
      <Tag className={cx(inline ? "flex items-center gap-3" : "block", className)}>
        <span className={cx("font-mono text-xs font-medium tracking-wider text-accent", inline ? "shrink-0" : "mb-1 block")}>{exhibit(id)}</span>
        {inline ? <span className="block min-w-0">{name}{below}</span> : name}
      </Tag>
    </ViewTransition>
  );
}

// The live checking sequence: a miniature of the draft that is written in as steps finish, and each step's state.
export type StepState = "done" | "active" | "pending" | "failed" | "skipped";
export function Examination({ steps, note, compact }: { steps: { label: string; state: StepState }[]; note?: ReactNode; compact?: boolean }) {
  const filled = steps.filter((s) => s.state === "done" || s.state === "skipped").length / steps.length;
  return (
    <div className="flex items-center gap-5">
      <PadPage lines={[0.8, 1, 0.9, 1, 0.6, 0.95, 0.7, 1, 0.85].slice(0, compact ? 6 : 9)} filled={filled} className={compact ? "h-16 w-12" : "h-24 w-18"} />
      <div className="min-w-0">
        <ol className="space-y-1.5 text-sm">
          {steps.map((s) => (
            <li key={s.label} className={cx("flex items-center gap-2", (s.state === "pending" || s.state === "skipped") && "text-muted")}>
              <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
                {s.state === "done" ? <Check className="size-4 text-accent" /> :
                  s.state === "failed" ? <X className="size-4 text-danger" /> :
                  s.state === "active" ? <span className="breathe size-2.5 rounded-pill bg-accent" /> :
                  <span className="size-2.5 rounded-pill border border-border-input" />}
              </span>
              <span>{s.label}</span>
              <span className="sr-only">
                {s.state === "done" ? "(done)" : s.state === "active" ? "(in progress)" : s.state === "failed" ? "(failed)" : s.state === "skipped" ? "(not run)" : "(next)"}
              </span>
            </li>
          ))}
        </ol>
        {note && <p className="mt-2 text-xs text-muted">{note}</p>}
      </div>
    </div>
  );
}

// The logo: the bookmark Q, a ring whose tail is a notched ribbon. app/icon.svg has the geometry notes; this is
// the same mark in currentColor, cropped to its extents (x 13-51, y 10-55) for use beside the name.
export function QuireMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="13 10 38 45" fill="currentColor" className={className}>
      <path d="M40 41.69A15 15 0 0 0 47 29H51V55L45.5 50.5L40 55Z" />
      <circle cx="32" cy="29" r="15" fill="none" stroke="currentColor" strokeWidth="8" />
    </svg>
  );
}

// intake: the page has its own check-a-draft form, so the header's shortcut to /submit would duplicate it.
// status: the worker light (a server component, so pages pass it in rather than the header reading the database).
// autohide: the landing page's header, hidden over the element with id `hero` (components/auto-hide-header.tsx).
export function AppHeader({ current, intake, status, autohide }: {
  current: "home" | "drafts" | "submit" | "design" | "settings"; intake?: boolean; status?: ReactNode; autohide?: boolean;
}) {
  const link = (key: typeof current, href: string, text: string) => (
    <Link href={href} aria-current={current === key ? "page" : undefined}
      className={cx("focus-ring relative flex h-14 items-center rounded-sm px-1 text-sm transition-colors",
        current === key ? "font-semibold text-on-shell after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-lamp" : "text-on-shell-muted hover:text-on-shell")}>
      {text}
    </Link>
  );
  const bar = (
      <div className="mx-auto flex h-14 w-full max-w-content-max items-center gap-6 px-4 md:px-8">
        <a href="#main" className="focus-ring sr-only rounded-sm focus:not-sr-only">Skip to content</a>
        <Link href="/" className="focus-ring flex items-center gap-2 rounded-sm text-base font-extrabold tracking-tight">
          <QuireMark className="h-5 w-auto text-on-shell" />
          {/* On a phone the mark stands alone so the three links fit; the name stays for screen readers. */}
          <span className="max-sm:sr-only">Quire</span>
        </Link>
        <nav aria-label="Main" className="flex gap-4">
          {link("home", "/", "Home")}
          {link("drafts", "/drafts", "Drafts")}
          {/* The design system check is for working on Quire; production builds don't serve it (app/design/page.tsx). */}
          {process.env.NODE_ENV !== "production" && link("design", "/design", "Design")}
          {link("settings", "/settings", "Settings")}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          {status}
          {current !== "submit" && !intake && (
            <Link href="/submit" className={cx(buttonClass("shell", "sm"), "max-sm:hidden")}>Check a draft</Link>
          )}
        </div>
      </div>
  );
  return autohide
    ? <AutoHideHeader hero="hero">{bar}</AutoHideHeader>
    : <header className="sticky top-0 z-30 bg-shell text-on-shell">{bar}</header>;
}
