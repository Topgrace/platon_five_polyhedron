import React from "react";
import { cx } from "./_utils";

export type SliderProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  value: number[];
  onValueChange?: (value: number[]) => void;
};

export function Slider({ value, onValueChange, className, ...props }: SliderProps) {
  const v = value[0] ?? 0;
  return (
    <input
      type="range"
      value={v}
      onChange={(e) => onValueChange?.([Number(e.target.value)])}
      className={cx("w-full", className)}
      {...props}
    />
  );
}

