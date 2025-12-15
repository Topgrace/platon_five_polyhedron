import { useMemo } from "react";
import type { PolyDef } from "./core";
import { createPlatonicPolyDefs } from "./platonic";

export function usePolyDefs(): PolyDef[] {
  return useMemo(() => {
    const edge = 1.6;
    return createPlatonicPolyDefs(edge);
  }, []);
}

