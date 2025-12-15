import React from "react";
import { cx } from "./_utils";

type ButtonVariant = "default" | "secondary" | "outline";
type ButtonSize = "sm" | "md";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = "default",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-md border border-transparent px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants: Record<ButtonVariant, string> = {
    default: "bg-foreground text-background hover:opacity-90",
    secondary: "bg-muted text-foreground hover:opacity-90",
    outline: "border-border bg-transparent text-foreground hover:bg-muted/60",
  };
  const sizes: Record<ButtonSize, string> = {
    sm: "h-8 px-3 py-1.5 text-xs",
    md: "h-9",
  };

  return <button type={type} className={cx(base, variants[variant], sizes[size], className)} {...props} />;
}

