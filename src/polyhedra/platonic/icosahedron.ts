import * as THREE from "three";
import {
  makeTreeTriangleNet,
  orientFaceOutward,
  poseFromTriangle3,
  suggestCamera,
  type FacePose,
  type PolyDef,
} from "../core";

function makeIcosaFolded(edge: number): FacePose[] {
  const geom = new THREE.IcosahedronGeometry(1, 0);
  const pos = geom.getAttribute("position");

  const tol = 1e-6;
  const k = (x: number) => Math.round(x / tol) * tol;
  const keyV = (v: THREE.Vector3) => `${k(v.x)},${k(v.y)},${k(v.z)}`;

  const uniqueVerts: THREE.Vector3[] = [];
  const remap: number[] = [];
  const uniqMap = new Map<string, number>();

  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const key = keyV(v);
    const existing = uniqMap.get(key);
    if (existing !== undefined) {
      remap[i] = existing;
      continue;
    }
    const idx = uniqueVerts.length;
    uniqueVerts.push(v);
    uniqMap.set(key, idx);
    remap[i] = idx;
  }

  const faces: Array<[number, number, number]> = [];
  for (let i = 0; i < pos.count; i += 3) {
    faces.push([remap[i]!, remap[i + 1]!, remap[i + 2]!]);
  }

  let minEdge = Infinity;
  for (let i = 0; i < uniqueVerts.length; i++) {
    for (let j = i + 1; j < uniqueVerts.length; j++) {
      const d = uniqueVerts[i]!.distanceTo(uniqueVerts[j]!);
      if (d > 1e-6 && d < minEdge) minEdge = d;
    }
  }
  const scale = edge / minEdge;
  for (const v of uniqueVerts) v.multiplyScalar(scale);

  return faces
    .map((f) => orientFaceOutward(uniqueVerts, f))
    .map(([i0, i1, i2]) => poseFromTriangle3(uniqueVerts[i0]!, uniqueVerts[i1]!, uniqueVerts[i2]!));
}

export function createIcosahedronDef(edge: number): PolyDef {
  const folded = makeIcosaFolded(edge);
  const net = makeTreeTriangleNet(edge, folded);

  return {
    id: "icosa",
    name: "정이십면체 (Icosahedron)",
    faceCount: 20,
    face: "triangle",
    edge,
    net,
    folded,
    camera: suggestCamera(net, folded, "triangle", edge),
  };
}

