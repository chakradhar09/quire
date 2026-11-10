"use client";
// Radix-backed parts (components.md: Menu, Modal, Tooltip, Toast, Side panel tabs, Switch, Dropdown).
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Dialog, DropdownMenu, Select, Switch as RSwitch, Tabs as RTabs, Toast, Tooltip } from "radix-ui";
import { Check, ChevronDown, X } from "lucide-react";
import { Button, FieldFrame, INPUT, cx, describedBy, type FieldShell } from "./ui";

// ---------------------------------------------------------------- Dropdown
// A field whose choices open on a pad sheet rather than the system's own list: titles wrap to two lines,
// each can carry a detail line and a tag ("Suggested"), and groups are labelled. Keyboard and typeahead
// as Radix gives them; with `name` it submits with its form like a native select.
export type DropdownItem = { value: string; label: ReactNode; detail?: string; tag?: string };
export function Dropdown({ id, name, label, hint, error, hideLabel, value, onValueChange, groups }: FieldShell & {
  name?: string; value: string; onValueChange: (v: string) => void; groups: { label?: string; items: DropdownItem[] }[];
}) {
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <Select.Root name={name} value={value} onValueChange={onValueChange}>
        <Select.Trigger id={id} aria-invalid={!!error || undefined} aria-describedby={describedBy(id, hint, error)}
          className={cx(INPUT, "group flex h-10 min-w-0 items-center justify-between gap-2 text-left data-[state=open]:border-accent")}>
          <span className="min-w-0 truncate"><Select.Value /></span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted transition-transform duration-(--motion-base) ease-(--motion-standard) group-data-[state=open]:rotate-180" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Content position="popper" sideOffset={6} collisionPadding={16}
            className="pop-in z-50 w-(--radix-select-trigger-width) min-w-64 origin-(--radix-select-content-transform-origin) overflow-hidden rounded-md border border-border bg-bg shadow-pop">
            <Select.Viewport className="max-h-[min(22rem,var(--radix-select-content-available-height))] p-1">
              {groups.filter((g) => g.items.length > 0).map((g, i) => (
                <Select.Group key={g.label ?? i}>
                  {i > 0 && <Select.Separator className="mx-2 my-1 h-px bg-border" />}
                  {g.label && <Select.Label className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{g.label}</Select.Label>}
                  {g.items.map((it) => (
                    <Select.Item key={it.value} value={it.value}
                      className="relative flex cursor-default items-start gap-2 rounded-sm py-2 pr-3 pl-8 text-sm outline-none select-none data-[highlighted]:bg-surface data-[state=checked]:font-semibold">
                      <Select.ItemIndicator className="absolute top-2.5 left-2"><Check aria-hidden className="size-4 text-accent" /></Select.ItemIndicator>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 [overflow-wrap:anywhere]"><Select.ItemText>{it.label}</Select.ItemText></span>
                        {it.detail && <span className="mt-0.5 block font-mono text-xs font-normal text-muted">{it.detail}</span>}
                      </span>
                      {it.tag && <span className="shrink-0 rounded-sm bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent">{it.tag}</span>}
                    </Select.Item>
                  ))}
                </Select.Group>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </FieldFrame>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({ trigger, title, body, confirmLabel, destructive, onConfirm }: {
  trigger: ReactNode; title: string; body: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-40 bg-shell/60" />
        <Dialog.Content
          onOpenAutoFocus={destructive ? (e) => { e.preventDefault(); document.getElementById("modal-cancel")?.focus(); } : undefined}
          className="pop-in fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-1/2 rounded-lg border border-border bg-bg p-6 shadow-pop">
          <Dialog.Title className="text-lg">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted">{body}</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild><Button id="modal-cancel" variant="secondary">Cancel</Button></Dialog.Close>
            <Dialog.Close asChild>
              <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------- Menu
export type MenuItem = { label: string; onSelect: () => void; danger?: boolean } | "separator";

export function Menu({ trigger, items }: { trigger: ReactNode; items: MenuItem[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="pop-in z-50 min-w-48 origin-(--radix-dropdown-menu-content-transform-origin) rounded-md border border-border bg-bg p-1 shadow-pop">
          {items.map((item, i) =>
            item === "separator" ? (
              <DropdownMenu.Separator key={i} className="my-1 h-px bg-border" />
            ) : (
              <DropdownMenu.Item key={item.label} onSelect={item.onSelect}
                className={cx("flex h-9 cursor-default items-center rounded-sm px-3 text-sm outline-none data-highlighted:bg-surface",
                  item.danger && "text-danger")}>
                {item.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ---------------------------------------------------------------- Tooltip
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={400}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={4} className="fade-in z-50 rounded-sm bg-shell px-2 py-1 text-xs text-on-shell">{label}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// ---------------------------------------------------------------- Tabs (side panel)
export function PanelTabs({ tabs, value, onValueChange }: {
  tabs: { value: string; label: string; content: ReactNode }[]; value: string; onValueChange: (v: string) => void;
}) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} className="flex h-full flex-col">
      <RTabs.List aria-label="Report panels" className="flex overflow-x-auto border-b border-border px-2">
        {tabs.map((t) => (
          <RTabs.Trigger key={t.value} value={t.value}
            className="focus-ring -mb-px shrink-0 border-b-2 border-transparent px-2.5 py-3 text-sm font-semibold whitespace-nowrap text-muted transition-colors hover:text-text data-[state=active]:border-accent data-[state=active]:text-text">
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="focus-ring fade-in flex-1 overflow-y-auto p-4">{t.content}</RTabs.Content>
      ))}
    </RTabs.Root>
  );
}

// ---------------------------------------------------------------- Switch
export function Switch({ id, label, hint, checked, onCheckedChange }: {
  id: string; label: string; hint?: string; checked: boolean; onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3">
      <div>
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
      </div>
      <RSwitch.Root id={id} checked={checked} onCheckedChange={onCheckedChange} aria-describedby={hint ? `${id}-hint` : undefined}
        className="focus-ring relative h-6 w-10 shrink-0 rounded-pill bg-border-input transition-colors duration-200 data-[state=checked]:bg-accent">
        <RSwitch.Thumb className="block size-5 translate-x-0.5 rounded-pill bg-bg transition-transform duration-200 ease-standard data-[state=checked]:translate-x-4.5" />
      </RSwitch.Root>
    </div>
  );
}

// ---------------------------------------------------------------- Toasts
// With `undo`, the toast carries an Undo button; `onClose` runs when it goes any other way (timeout, close
// button, Escape, swipe), which is when an undoable action becomes final.
type ToastOptions = { undo?: () => void; onClose?: () => void; duration?: number };
type ToastMsg = ToastOptions & { id: number; text: string; variant: "success" | "error"; settled?: boolean };
const ToastCtx = createContext<(text: string, variant?: ToastMsg["variant"], options?: ToastOptions) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function Providers({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const push = useCallback((text: string, variant: ToastMsg["variant"] = "success", options: ToastOptions = {}) => {
    setToasts((t) => [...t, { id: Date.now() + Math.random(), text, variant, ...options }]);
  }, []);
  const close = (t: ToastMsg, undone: boolean) => {
    if (t.settled) return;
    t.settled = true;
    (undone ? t.undo : t.onClose)?.();
    setToasts((all) => all.filter((x) => x.id !== t.id));
  };
  return (
    <Tooltip.Provider>
      <Toast.Provider duration={5000}>
        <ToastCtx.Provider value={push}>{children}</ToastCtx.Provider>
        {toasts.map((t) => (
          <Toast.Root key={t.id} type={t.variant === "error" ? "foreground" : "background"} duration={t.duration}
            onOpenChange={(open) => !open && close(t, false)}
            className="pop-in flex items-center gap-3 rounded-md bg-shell px-4 py-3 text-sm text-on-shell shadow-pop">
            <Toast.Description className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t.text}</Toast.Description>
            {t.undo && (
              <Toast.Action altText="Undo" onClick={() => close(t, true)}
                className="focus-ring shrink-0 rounded-sm px-1 font-semibold underline underline-offset-2 hover:no-underline">
                Undo
              </Toast.Action>
            )}
            <Toast.Close aria-label="Dismiss" className="focus-ring rounded-sm"><X aria-hidden className="size-4" /></Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 max-sm:right-1/2 max-sm:translate-x-1/2" />
      </Toast.Provider>
    </Tooltip.Provider>
  );
}
