import React from "react";
import { cx } from "./_utils";

export type SwitchProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange"
> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

export function Switch({ checked, onCheckedChange, className, disabled, ...props }: SwitchProps) {
  return (
    <label className={cx("relative inline-flex cursor-pointer items-center", disabled && "opacity-60 cursor-not-allowed", className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        className="sr-only"
        {...props}
      />
      <span
        className={cx(
          "h-6 w-10 rounded-full border border-border bg-muted transition-colors",
          checked && "bg-foreground/80",
        )}
      />
      <span
        className={cx(
          "absolute left-1 top-1 h-4 w-4 rounded-full bg-background shadow transition-transform",
          checked && "translate-x-4",
        )}
      />
    </label>
  );
}

