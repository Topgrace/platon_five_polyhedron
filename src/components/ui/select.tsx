import React, { createContext, useContext, useMemo, useState } from "react";
import { cx } from "./_utils";

type SelectCtx = {
  value?: string;
  setValue: (v: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
};

const SelectContext = createContext<SelectCtx | null>(null);

function useSelectCtx() {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error("Select components must be used within <Select>.");
  return ctx;
}

export function Select({
  value,
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ctx = useMemo<SelectCtx>(
    () => ({
      value,
      setValue: (v) => onValueChange?.(v),
      open,
      setOpen,
    }),
    [onValueChange, open, value],
  );

  return <SelectContext.Provider value={ctx}>{children}</SelectContext.Provider>;
}

export function SelectTrigger({
  className,
  children,
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  const { open, setOpen } = useSelectCtx();
  return (
    <button
      type="button"
      className={cx("flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm", className)}
      onClick={() => setOpen(!open)}
    >
      {children}
      <span className="ml-2 text-xs opacity-60">▼</span>
    </button>
  );
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  const { value } = useSelectCtx();
  return <span className={cx(!value && "opacity-60")}>{value ?? placeholder}</span>;
}

export function SelectContent({ className, children }: { className?: string; children: React.ReactNode }) {
  const { open } = useSelectCtx();
  if (!open) return null;
  return (
    <div className={cx("mt-2 w-full rounded-md border border-border bg-background p-1 shadow", className)}>
      {children}
    </div>
  );
}

export function SelectItem({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { setValue, setOpen } = useSelectCtx();
  return (
    <button
      type="button"
      className={cx("block w-full rounded px-2 py-2 text-left text-sm hover:bg-muted", className)}
      onClick={() => {
        setValue(value);
        setOpen(false);
      }}
    >
      {children}
    </button>
  );
}

