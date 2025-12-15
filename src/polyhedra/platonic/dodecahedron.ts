import * as THREE from "three";
import {
  makeTreePolygonNet,
  poseFromPolygon3,
  suggestCamera,
  type FacePose,
  type PolyDef,
} from "../core";

function makeDodecaFolded(edge: number): FacePose[] {
  const geom = new THREE.DodecahedronGeometry(1, 0);
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

  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i < pos.count; i += 3) {
    triangles.push([remap[i]!, remap[i + 1]!, remap[i + 2]!]);
  }

  const quantNormalKey = (n: THREE.Vector3, t = 1e-3) => {
    const r = (x: number) => Math.round(x / t) * t;
    return `${r(n.x)},${r(n.y)},${r(n.z)}`;
  };

  const groups = new Map<string, { tris: Array<[number, number, number]>; normal: THREE.Vector3 }>();
  for (const tri of triangles) {
    const [a, b, c] = tri;
    const v0 = uniqueVerts[a]!;
    const v1 = uniqueVerts[b]!;
    const v2 = uniqueVerts[c]!;

    const n = v1.clone().sub(v0).cross(v2.clone().sub(v0));
    const centroid = v0.clone().add(v1).add(v2).multiplyScalar(1 / 3);
    if (n.dot(centroid) < 0) n.negate();
    n.normalize();

    const key = quantNormalKey(n);
    const g = groups.get(key) ?? { tris: [], normal: new THREE.Vector3() };
    g.tris.push(tri);
    g.normal.add(n);
    groups.set(key, g);
  }

  const faces: number[][] = [];
  for (const g of groups.values()) {
    const ids = new Set<number>();
    for (const [a, b, c] of g.tris) {
      ids.add(a);
      ids.add(b);
      ids.add(c);
    }

    const normal = g.normal.clone().normalize();
    const centroid = new THREE.Vector3();
    for (const i of ids) centroid.add(uniqueVerts[i]!);
    centroid.multiplyScalar(1 / ids.size);

    const idList = Array.from(ids);
    const ref = uniqueVerts[idList[0]!]!.clone().sub(centroid).normalize();
    idList.sort((ia, ib) => {
      const va = uniqueVerts[ia]!.clone().sub(centroid);
      const vb = uniqueVerts[ib]!.clone().sub(centroid);
      const angA = Math.atan2(normal.dot(ref.clone().cross(va)), ref.dot(va));
      const angB = Math.atan2(normal.dot(ref.clone().cross(vb)), ref.dot(vb));
      return angA - angB;
    });
    faces.push(idList);
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

  return faces.map((ids) => poseFromPolygon3(ids.map((i) => uniqueVerts[i]!)));
}

export function createDodecahedronDef(edge: number): PolyDef {
  const folded = makeDodecaFolded(edge);
  const net = makeTreePolygonNet(edge, folded, 5);

  return {
    id: "dodeca",
    name: "정십이면체 (Dodecahedron)",
    faceCount: 12,
    face: "pentagon",
    edge,
    net,
    folded,
    camera: suggestCamera(net, folded, "pentagon", edge),
  };
}

