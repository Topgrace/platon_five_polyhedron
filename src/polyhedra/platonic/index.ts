import type { PolyDef } from "../core";
import { createCubeDef } from "./cube";
import { createDodecahedronDef } from "./dodecahedron";
import { createIcosahedronDef } from "./icosahedron";
import { createOctahedronDef } from "./octahedron";
import { createTetrahedronDef } from "./tetrahedron";

export function createPlatonicPolyDefs(edge: number): PolyDef[] {
  return [
    createCubeDef(edge),
    createTetrahedronDef(edge),
    createOctahedronDef(edge),
    createIcosahedronDef(edge),
    createDodecahedronDef(edge),
  ];
}

