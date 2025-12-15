import React, { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "@react-three/drei";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpVec3(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  return new THREE.Vector3(
    lerp(a.x, b.x, t),
    lerp(a.y, b.y, t),
    lerp(a.z, b.z, t),
  );
}

function slerpQuat(a: THREE.Quaternion, b: THREE.Quaternion, t: number) {
  const q = a.clone();
  q.slerp(b, t);
  return q;
}

type TriEdge = 0 | 1 | 2;

type FacePose = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

type PolyDef = {
  id: "tetra" | "cube" | "octa" | "dodeca" | "icosa";
  name: string;
  faceCount: number;
  face: "square" | "triangle" | "pentagon";
  edge: number;
  net: FacePose[];
  folded: FacePose[];
  camera: { pos: [number, number, number]; fov: number };
};

type NetAdjEdge = {
  a: number;
  b: number;
  edgeA: number;
  edgeB: number;
};

type Hinge = {
  parent: number;
  axis: THREE.Vector3;
  point: THREE.Vector3;
  relNet: THREE.Matrix4;
  angle: number;
};

type HingeModel = {
  root: number;
  order: number[];
  hinges: Array<Hinge | null>;
};

function qFromEuler(x: number, y: number, z: number) {
  const e = new THREE.Euler(x, y, z);
  const q = new THREE.Quaternion();
  q.setFromEuler(e);
  return q;
}

function poseToMatrix(p: FacePose) {
  const m = new THREE.Matrix4();
  m.makeRotationFromQuaternion(p.quaternion);
  m.setPosition(p.position);
  return m;
}

function matrixToPose(m: THREE.Matrix4): FacePose {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(position, quaternion, scale);
  return { position, quaternion };
}

function triangleLocal2(edge: number): [THREE.Vector2, THREE.Vector2, THREE.Vector2] {
  const h = (Math.sqrt(3) / 2) * edge;
  return [
    new THREE.Vector2(-edge / 2, -h / 3),
    new THREE.Vector2(edge / 2, -h / 3),
    new THREE.Vector2(0, (2 * h) / 3),
  ];
}

function triangleLocal3(edge: number) {
  const h = (Math.sqrt(3) / 2) * edge;
  return [
    new THREE.Vector3(-edge / 2, -h / 3, 0),
    new THREE.Vector3(edge / 2, -h / 3, 0),
    new THREE.Vector3(0, (2 * h) / 3, 0),
  ];
}

function squareLocal3(edge: number) {
  return [
    new THREE.Vector3(-edge / 2, -edge / 2, 0),
    new THREE.Vector3(edge / 2, -edge / 2, 0),
    new THREE.Vector3(edge / 2, edge / 2, 0),
    new THREE.Vector3(-edge / 2, edge / 2, 0),
  ];
}

function pentagonLocal3(edge: number) {
  const R = edge / (2 * Math.sin(Math.PI / 5));
  const offset = (-7 * Math.PI) / 10; // -126deg: bottom edge horizontal
  const verts: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const a = offset + (i * 2 * Math.PI) / 5;
    verts.push(new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), 0));
  }
  const centroid = new THREE.Vector3();
  for (const v of verts) centroid.add(v);
  centroid.multiplyScalar(1 / verts.length);
  for (const v of verts) v.sub(centroid);
  return verts;
}

function pentagonLocal2(edge: number) {
  return pentagonLocal3(edge).map((v) => new THREE.Vector2(v.x, v.y));
}

function localVerts3(face: PolyDef["face"], edge: number) {
  if (face === "square") return squareLocal3(edge);
  if (face === "pentagon") return pentagonLocal3(edge);
  return triangleLocal3(edge);
}

function applyPose2({ pos, rot }: { pos: THREE.Vector2; rot: number }, v: THREE.Vector2) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return new THREE.Vector2(v.x * c - v.y * s + pos.x, v.x * s + v.y * c + pos.y);
}

function cross2(a: THREE.Vector2, b: THREE.Vector2) {
  return a.x * b.y - a.y * b.x;
}

function quantKey3(v: THREE.Vector3, tol = 1e-4) {
  const r = (x: number) => Math.round(x / tol) * tol;
  return `${r(v.x)},${r(v.y)},${r(v.z)}`;
}

function netAdjEdges(net: FacePose[], face: PolyDef["face"], edge: number): NetAdjEdge[] {
  const vertsLocal = localVerts3(face, edge);
  const n = vertsLocal.length;

  const edgeMap = new Map<string, Array<{ fi: number; edgeIndex: number }>>();
  for (let fi = 0; fi < net.length; fi++) {
    const p = net[fi]!;
    const wverts = vertsLocal.map((v) => v.clone().applyQuaternion(p.quaternion).add(p.position));
    for (let k = 0; k < n; k++) {
      const a = wverts[k]!;
      const b = wverts[(k + 1) % n]!;
      const ka = quantKey3(a);
      const kb = quantKey3(b);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const arr = edgeMap.get(key) ?? [];
      arr.push({ fi, edgeIndex: k });
      edgeMap.set(key, arr);
    }
  }

  const adj: NetAdjEdge[] = [];
  for (const arr of edgeMap.values()) {
    if (arr.length === 2) {
      const [e0, e1] = arr;
      adj.push({ a: e0.fi, b: e1.fi, edgeA: e0.edgeIndex, edgeB: e1.edgeIndex });
    }
  }
  return adj;
}

function signedAngleAroundAxis(from: THREE.Vector3, to: THREE.Vector3, axis: THREE.Vector3) {
  const a = axis.clone().normalize();
  const v0 = from.clone().sub(a.clone().multiplyScalar(a.dot(from)));
  const v1 = to.clone().sub(a.clone().multiplyScalar(a.dot(to)));
  const l0 = v0.length();
  const l1 = v1.length();
  if (l0 < 1e-10 || l1 < 1e-10) return 0;
  v0.multiplyScalar(1 / l0);
  v1.multiplyScalar(1 / l1);
  const sin = a.dot(v0.clone().cross(v1));
  const cos = v0.dot(v1);
  return Math.atan2(sin, cos);
}

function rotationAroundAxisLine(axisUnit: THREE.Vector3, pointOnAxis: THREE.Vector3, angle: number) {
  const T1 = new THREE.Matrix4().makeTranslation(pointOnAxis.x, pointOnAxis.y, pointOnAxis.z);
  const T2 = new THREE.Matrix4().makeTranslation(-pointOnAxis.x, -pointOnAxis.y, -pointOnAxis.z);
  const R = new THREE.Matrix4().makeRotationAxis(axisUnit, angle);
  return T1.multiply(R).multiply(T2);
}

function buildHingeModel(def: PolyDef): HingeModel {
  const { faceCount } = def;
  const vertsLocal = localVerts3(def.face, def.edge);
  const nVerts = vertsLocal.length;
  const root = 0;

  const foldAdj = netAdjEdges(def.folded, def.face, def.edge);
  const foldPairs = new Set<string>();
  for (const e of foldAdj) {
    const key = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
    foldPairs.add(key);
  }

  const adj = netAdjEdges(def.net, def.face, def.edge).filter((e) => {
    const key = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
    return foldPairs.has(key);
  });
  const adjList = Array.from({ length: faceCount }, () => [] as Array<{ to: number; edgeFrom: number; edgeTo: number }>);
  for (const e of adj) {
    adjList[e.a].push({ to: e.b, edgeFrom: e.edgeA, edgeTo: e.edgeB });
    adjList[e.b].push({ to: e.a, edgeFrom: e.edgeB, edgeTo: e.edgeA });
  }

  const parent = new Array<number>(faceCount).fill(-1);
  const parentEdge = new Array<number>(faceCount).fill(-1);
  parent[root] = root;
  const q: number[] = [root];
  const order: number[] = [root];
  while (q.length) {
    const v = q.shift()!;
    for (const e of adjList[v]!) {
      if (parent[e.to] !== -1) continue;
      parent[e.to] = v;
      parentEdge[e.to] = e.edgeFrom;
      q.push(e.to);
      order.push(e.to);
    }
  }

  const netM = def.net.map(poseToMatrix);
  const foldM = def.folded.map(poseToMatrix);

  const hinges: Array<Hinge | null> = new Array(faceCount).fill(null);
  const localNormal = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < faceCount; i++) {
    if (i === root) continue;
    const p = parent[i];
    if (p === -1) continue;

    const relNet = netM[p]!.clone().invert().multiply(netM[i]!);
    const relFold = foldM[p]!.clone().invert().multiply(foldM[i]!);

    const qRelNet = new THREE.Quaternion().setFromRotationMatrix(relNet);
    const qRelFold = new THREE.Quaternion().setFromRotationMatrix(relFold);
    const n0 = localNormal.clone().applyQuaternion(qRelNet).normalize();
    const n1 = localNormal.clone().applyQuaternion(qRelFold).normalize();

    const eIdx = parentEdge[i];
    if (eIdx < 0) continue;
    const pA = vertsLocal[eIdx]!;
    const pB = vertsLocal[(eIdx + 1) % nVerts]!;
    const axis = pB.clone().sub(pA).normalize();
    const angle = signedAngleAroundAxis(n0, n1, axis);

    hinges[i] = {
      parent: p,
      axis,
      point: pA.clone(),
      relNet,
      angle,
    };
  }

  return { root, order, hinges };
}

function hingePoses(def: PolyDef, model: HingeModel, t: number): FacePose[] {
  const root = model.root;
  const worldM: Array<THREE.Matrix4 | null> = new Array(def.faceCount).fill(null);

  const rootPose: FacePose = {
    position: lerpVec3(def.net[root]!.position, def.folded[root]!.position, t),
    quaternion: slerpQuat(def.net[root]!.quaternion, def.folded[root]!.quaternion, t),
  };
  worldM[root] = poseToMatrix(rootPose);

  for (const i of model.order) {
    if (i === root) continue;
    const h = model.hinges[i];
    if (!h) continue;
    const parentM = worldM[h.parent];
    if (!parentM) continue;
    const H = rotationAroundAxisLine(h.axis, h.point, h.angle * t);
    worldM[i] = parentM.clone().multiply(H).multiply(h.relNet);
  }

  return worldM.map((m, i) => (m ? matrixToPose(m) : def.net[i]!));
}

function attachTriangle(parent: { pos: THREE.Vector2; rot: number }, edge: TriEdge, tri: [THREE.Vector2, THREE.Vector2, THREE.Vector2]) {
  const pv = tri.map((v) => applyPose2(parent, v));

  const edgeDef: Record<TriEdge, { i0: number; i1: number; iOpp: number }> = {
    0: { i0: 0, i1: 1, iOpp: 2 }, // AB
    1: { i0: 1, i1: 2, iOpp: 0 }, // BC
    2: { i0: 2, i1: 0, iOpp: 1 }, // CA
  };

  const { i0, i1, iOpp } = edgeDef[edge];
  const e0 = pv[i0]!;
  const e1 = pv[i1]!;
  const parentThird = pv[iOpp]!;

  const localA = tri[0];
  const localC = tri[2];

  const v01 = new THREE.Vector2(e1.x - e0.x, e1.y - e0.y);
  const baseAngle = Math.atan2(v01.y, v01.x);
  const parentSide = cross2(v01, new THREE.Vector2(parentThird.x - e0.x, parentThird.y - e0.y));

  const candidates = [
    // A->e0, B->e1
    {
      rot: baseAngle,
      pos: new THREE.Vector2(
        e0.x - (localA.x * Math.cos(baseAngle) - localA.y * Math.sin(baseAngle)),
        e0.y - (localA.x * Math.sin(baseAngle) + localA.y * Math.cos(baseAngle)),
      ),
    },
    // A->e1, B->e0 (swap)
    {
      rot: baseAngle + Math.PI,
      pos: new THREE.Vector2(
        e1.x - (localA.x * Math.cos(baseAngle + Math.PI) - localA.y * Math.sin(baseAngle + Math.PI)),
        e1.y - (localA.x * Math.sin(baseAngle + Math.PI) + localA.y * Math.cos(baseAngle + Math.PI)),
      ),
    },
  ];

  const pick = (cand: { pos: THREE.Vector2; rot: number }) => {
    const cWorld = applyPose2(cand, localC);
    const childSide = cross2(v01, new THREE.Vector2(cWorld.x - e0.x, cWorld.y - e0.y));
    return parentSide === 0 ? childSide : parentSide * childSide;
  };

  return pick(candidates[0]) < 0 ? candidates[0] : candidates[1];
}

function attachTriangleAlongEdge(
  parent: { pos: THREE.Vector2; rot: number },
  parentEdge: TriEdge,
  childEdge: TriEdge,
  tri: [THREE.Vector2, THREE.Vector2, THREE.Vector2],
) {
  const pv = tri.map((v) => applyPose2(parent, v));

  const edgeDef: Record<TriEdge, { i0: number; i1: number; iOpp: number }> = {
    0: { i0: 0, i1: 1, iOpp: 2 }, // AB
    1: { i0: 1, i1: 2, iOpp: 0 }, // BC
    2: { i0: 2, i1: 0, iOpp: 1 }, // CA
  };

  const p = edgeDef[parentEdge];
  const c = edgeDef[childEdge];

  const e0 = pv[p.i0]!;
  const e1 = pv[p.i1]!;
  const parentThird = pv[p.iOpp]!;

  const local0 = tri[c.i0]!;
  const local1 = tri[c.i1]!;
  const localOpp = tri[c.iOpp]!;

  const v01 = new THREE.Vector2(e1.x - e0.x, e1.y - e0.y);
  const parentSide = cross2(v01, new THREE.Vector2(parentThird.x - e0.x, parentThird.y - e0.y));

  const solve = (t0: THREE.Vector2, t1: THREE.Vector2) => {
    const vTarget = new THREE.Vector2(t1.x - t0.x, t1.y - t0.y);
    const vLocal = new THREE.Vector2(local1.x - local0.x, local1.y - local0.y);
    const rot = Math.atan2(vTarget.y, vTarget.x) - Math.atan2(vLocal.y, vLocal.x);
    const cRot = Math.cos(rot);
    const sRot = Math.sin(rot);
    const pos = new THREE.Vector2(
      t0.x - (local0.x * cRot - local0.y * sRot),
      t0.y - (local0.x * sRot + local0.y * cRot),
    );
    return { pos, rot };
  };

  const candidates = [
    solve(e0, e1),
    solve(e1, e0), // swap
  ];

  const pick = (cand: { pos: THREE.Vector2; rot: number }) => {
    const thirdWorld = applyPose2(cand, localOpp);
    const childSide = cross2(v01, new THREE.Vector2(thirdWorld.x - e0.x, thirdWorld.y - e0.y));
    return parentSide === 0 ? childSide : parentSide * childSide;
  };

  return pick(candidates[0]) < 0 ? candidates[0] : candidates[1];
}

function attachPolygonAlongEdge(
  parent: { pos: THREE.Vector2; rot: number },
  parentEdge: number,
  childEdge: number,
  poly: THREE.Vector2[],
) {
  const n = poly.length;
  if (n < 3) return parent;

  const pv = poly.map((v) => applyPose2(parent, v));
  const e0 = pv[parentEdge % n]!;
  const e1 = pv[(parentEdge + 1) % n]!;

  const centroidParent = new THREE.Vector2();
  for (const v of pv) centroidParent.add(v);
  centroidParent.multiplyScalar(1 / n);

  const v01 = new THREE.Vector2(e1.x - e0.x, e1.y - e0.y);
  const parentSide = cross2(v01, new THREE.Vector2(centroidParent.x - e0.x, centroidParent.y - e0.y));

  const local0 = poly[childEdge % n]!;
  const local1 = poly[(childEdge + 1) % n]!;

  const solve = (t0: THREE.Vector2, t1: THREE.Vector2) => {
    const vTarget = new THREE.Vector2(t1.x - t0.x, t1.y - t0.y);
    const vLocal = new THREE.Vector2(local1.x - local0.x, local1.y - local0.y);
    const rot = Math.atan2(vTarget.y, vTarget.x) - Math.atan2(vLocal.y, vLocal.x);
    const cRot = Math.cos(rot);
    const sRot = Math.sin(rot);
    const pos = new THREE.Vector2(
      t0.x - (local0.x * cRot - local0.y * sRot),
      t0.y - (local0.x * sRot + local0.y * cRot),
    );
    return { pos, rot };
  };

  const candidates = [solve(e0, e1), solve(e1, e0)];

  const sideFor = (cand: { pos: THREE.Vector2; rot: number }) => {
    const centroidChild = new THREE.Vector2();
    for (const v of poly) centroidChild.add(applyPose2(cand, v));
    centroidChild.multiplyScalar(1 / n);
    return cross2(v01, new THREE.Vector2(centroidChild.x - e0.x, centroidChild.y - e0.y));
  };

  const side0 = sideFor(candidates[0]);
  const side1 = sideFor(candidates[1]);
  const pick0 = parentSide === 0 ? side0 : parentSide * side0;
  const pick1 = parentSide === 0 ? side1 : parentSide * side1;

  return pick0 < 0 ? candidates[0] : candidates[1];
}

function centerPoses(poses: FacePose[]) {
  const center = new THREE.Vector3();
  for (const p of poses) center.add(p.position);
  center.multiplyScalar(1 / poses.length);
  return poses.map((p) => ({
    position: p.position.clone().sub(center),
    quaternion: p.quaternion.clone(),
  }));
}

function faceRadius(face: PolyDef["face"], edge: number) {
  if (face === "square") return (Math.SQRT2 * edge) / 2;
  if (face === "pentagon") return edge / (2 * Math.sin(Math.PI / 5));
  return edge / Math.sqrt(3);
}

function estimateRadius(poses: FacePose[], face: PolyDef["face"], edge: number) {
  let r = 0;
  for (const p of poses) r = Math.max(r, p.position.length());
  return r + faceRadius(face, edge);
}

function suggestCamera(net: FacePose[], folded: FacePose[], face: PolyDef["face"], edge: number) {
  const fov = 45;
  const radius = Math.max(estimateRadius(net, face, edge), estimateRadius(folded, face, edge));
  const dist = (radius / Math.tan((fov * Math.PI) / 360)) * 1.15;
  const dir = new THREE.Vector3(1, 0.85, 1.15).normalize();
  const p = dir.multiplyScalar(dist);
  return { pos: [p.x, p.y, p.z] as [number, number, number], fov };
}

function poseFromTriangle3(v0: THREE.Vector3, v1: THREE.Vector3, v2: THREE.Vector3): FacePose {
  const position = v0.clone().add(v1).add(v2).multiplyScalar(1 / 3);

  const xAxis = v1.clone().sub(v0).normalize();
  const normal = v1.clone().sub(v0).cross(v2.clone().sub(v0)).normalize();
  const yAxis = normal.clone().cross(xAxis).normalize();

  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  return { position, quaternion };
}

function poseFromPolygon3(verts: THREE.Vector3[]): FacePose {
  const position = new THREE.Vector3();
  for (const v of verts) position.add(v);
  position.multiplyScalar(1 / verts.length);

  const v0 = verts[0]!;
  const v1 = verts[1]!;
  const v2 = verts[2]!;
  const xAxis = v1.clone().sub(v0).normalize();
  let normal = v1.clone().sub(v0).cross(v2.clone().sub(v0)).normalize();
  if (normal.dot(position) < 0) normal.negate();
  const yAxis = normal.clone().cross(xAxis).normalize();

  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  return { position, quaternion };
}

function orientFaceOutward(vertices: THREE.Vector3[], face: [number, number, number]): [number, number, number] {
  const [a, b, c] = face;
  const v0 = vertices[a]!;
  const v1 = vertices[b]!;
  const v2 = vertices[c]!;
  const normal = v1.clone().sub(v0).cross(v2.clone().sub(v0));
  const centroid = v0.clone().add(v1).add(v2).multiplyScalar(1 / 3);
  if (normal.dot(centroid) < 0) return [a, c, b];
  return face;
}

function makeTetraFolded(edge: number): FacePose[] {
  const s = edge / (2 * Math.sqrt(2));
  const verts = [
    new THREE.Vector3(1, 1, 1).multiplyScalar(s),
    new THREE.Vector3(1, -1, -1).multiplyScalar(s),
    new THREE.Vector3(-1, 1, -1).multiplyScalar(s),
    new THREE.Vector3(-1, -1, 1).multiplyScalar(s),
  ];

  const faces: Array<[number, number, number]> = [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ];

  return faces
    .map((f) => orientFaceOutward(verts, f))
    .map(([i0, i1, i2]) => poseFromTriangle3(verts[i0]!, verts[i1]!, verts[i2]!));
}

function makeOctaFolded(edge: number): FacePose[] {
  const s = edge / Math.sqrt(2);
  const verts = [
    new THREE.Vector3(1, 0, 0).multiplyScalar(s),
    new THREE.Vector3(-1, 0, 0).multiplyScalar(s),
    new THREE.Vector3(0, 1, 0).multiplyScalar(s),
    new THREE.Vector3(0, -1, 0).multiplyScalar(s),
    new THREE.Vector3(0, 0, 1).multiplyScalar(s),
    new THREE.Vector3(0, 0, -1).multiplyScalar(s),
  ];

  const faces: Array<[number, number, number]> = [
    [4, 0, 2],
    [4, 2, 1],
    [4, 1, 3],
    [4, 3, 0],
    [5, 2, 0],
    [5, 1, 2],
    [5, 3, 1],
    [5, 0, 3],
  ];

  return faces
    .map((f) => orientFaceOutward(verts, f))
    .map(([i0, i1, i2]) => poseFromTriangle3(verts[i0]!, verts[i1]!, verts[i2]!));
}

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

function makeTetraNet(edge: number, folded: FacePose[]): FacePose[] {
  const tri = triangleLocal2(edge);
  const faceCount = folded.length;

  const adj = netAdjEdges(folded, "triangle", edge);
  const adjList = Array.from({ length: faceCount }, () => [] as Array<{ to: number; edgeFrom: number; edgeTo: number }>);
  for (const e of adj) {
    adjList[e.a].push({ to: e.b, edgeFrom: e.edgeA, edgeTo: e.edgeB });
    adjList[e.b].push({ to: e.a, edgeFrom: e.edgeB, edgeTo: e.edgeA });
  }

  const root = 0;
  const parent = new Array<number>(faceCount).fill(-1);
  const parentEdge = new Array<number>(faceCount).fill(-1);
  const childEdge = new Array<number>(faceCount).fill(-1);
  parent[root] = root;
  const q: number[] = [root];
  const order: number[] = [root];
  while (q.length) {
    const v = q.shift()!;
    for (const e of adjList[v]!) {
      if (parent[e.to] !== -1) continue;
      parent[e.to] = v;
      parentEdge[e.to] = e.edgeFrom;
      childEdge[e.to] = e.edgeTo;
      q.push(e.to);
      order.push(e.to);
    }
  }

  const poses2: Array<{ pos: THREE.Vector2; rot: number } | null> = new Array(faceCount).fill(null);
  poses2[root] = { pos: new THREE.Vector2(0, 0), rot: 0 };
  for (const i of order) {
    if (i === root) continue;
    const p = parent[i];
    const pp = poses2[p];
    if (!pp) continue;
    poses2[i] = attachTriangleAlongEdge(pp, parentEdge[i] as TriEdge, childEdge[i] as TriEdge, tri);
  }

  return centerPoses(
    poses2.map((p) => ({
      position: new THREE.Vector3(p?.pos.x ?? 0, p?.pos.y ?? 0, 0),
      quaternion: qFromEuler(0, 0, p?.rot ?? 0),
    })),
  );
}

function makeOctaNet(edge: number, folded: FacePose[]): FacePose[] {
  const tri = triangleLocal2(edge);
  const faceCount = folded.length;

  const adj = netAdjEdges(folded, "triangle", edge);
  const adjList = Array.from({ length: faceCount }, () => [] as Array<{ to: number; edgeFrom: number; edgeTo: number }>);
  for (const e of adj) {
    adjList[e.a].push({ to: e.b, edgeFrom: e.edgeA, edgeTo: e.edgeB });
    adjList[e.b].push({ to: e.a, edgeFrom: e.edgeB, edgeTo: e.edgeA });
  }

  const root = 0;
  const parent = new Array<number>(faceCount).fill(-1);
  const parentEdge = new Array<number>(faceCount).fill(-1);
  const childEdge = new Array<number>(faceCount).fill(-1);
  parent[root] = root;
  const q: number[] = [root];
  const order: number[] = [root];
  while (q.length) {
    const v = q.shift()!;
    for (const e of adjList[v]!) {
      if (parent[e.to] !== -1) continue;
      parent[e.to] = v;
      parentEdge[e.to] = e.edgeFrom;
      childEdge[e.to] = e.edgeTo;
      q.push(e.to);
      order.push(e.to);
    }
  }

  const poses2: Array<{ pos: THREE.Vector2; rot: number } | null> = new Array(faceCount).fill(null);
  poses2[root] = { pos: new THREE.Vector2(0, 0), rot: 0 };
  for (const i of order) {
    if (i === root) continue;
    const p = parent[i];
    const pp = poses2[p];
    if (!pp) continue;
    poses2[i] = attachTriangleAlongEdge(pp, parentEdge[i] as TriEdge, childEdge[i] as TriEdge, tri);
  }

  return centerPoses(
    poses2.map((p) => ({
      position: new THREE.Vector3(p?.pos.x ?? 0, p?.pos.y ?? 0, 0),
      quaternion: qFromEuler(0, 0, p?.rot ?? 0),
    })),
  );
}

function makeIcosaNet(edge: number, folded: FacePose[]): FacePose[] {
  const tri = triangleLocal2(edge);
  const faceCount = folded.length;

  const adj = netAdjEdges(folded, "triangle", edge);
  const adjList = Array.from({ length: faceCount }, () => [] as Array<{ to: number; edgeFrom: number; edgeTo: number }>);
  for (const e of adj) {
    adjList[e.a].push({ to: e.b, edgeFrom: e.edgeA, edgeTo: e.edgeB });
    adjList[e.b].push({ to: e.a, edgeFrom: e.edgeB, edgeTo: e.edgeA });
  }

  const root = 0;
  const parent = new Array<number>(faceCount).fill(-1);
  const parentEdge = new Array<number>(faceCount).fill(-1);
  const childEdge = new Array<number>(faceCount).fill(-1);
  parent[root] = root;
  const q: number[] = [root];
  const order: number[] = [root];
  while (q.length) {
    const v = q.shift()!;
    for (const e of adjList[v]!) {
      if (parent[e.to] !== -1) continue;
      parent[e.to] = v;
      parentEdge[e.to] = e.edgeFrom;
      childEdge[e.to] = e.edgeTo;
      q.push(e.to);
      order.push(e.to);
    }
  }

  const poses2: Array<{ pos: THREE.Vector2; rot: number } | null> = new Array(faceCount).fill(null);
  poses2[root] = { pos: new THREE.Vector2(0, 0), rot: 0 };
  for (const i of order) {
    if (i === root) continue;
    const p = parent[i];
    const pp = poses2[p];
    if (!pp) continue;
    poses2[i] = attachTriangleAlongEdge(pp, parentEdge[i] as TriEdge, childEdge[i] as TriEdge, tri);
  }

  return centerPoses(
    poses2.map((p) => ({
      position: new THREE.Vector3(p?.pos.x ?? 0, p?.pos.y ?? 0, 0),
      quaternion: qFromEuler(0, 0, p?.rot ?? 0),
    })),
  );
}

function makeDodecaNet(edge: number, folded: FacePose[]): FacePose[] {
  const poly = pentagonLocal2(edge);
  const faceCount = folded.length;

  const adj = netAdjEdges(folded, "pentagon", edge);
  const adjList = Array.from({ length: faceCount }, () => [] as Array<{ to: number; edgeFrom: number; edgeTo: number }>);
  for (const e of adj) {
    adjList[e.a].push({ to: e.b, edgeFrom: e.edgeA, edgeTo: e.edgeB });
    adjList[e.b].push({ to: e.a, edgeFrom: e.edgeB, edgeTo: e.edgeA });
  }

  const root = 0;
  const parent = new Array<number>(faceCount).fill(-1);
  const parentEdge = new Array<number>(faceCount).fill(-1);
  const childEdge = new Array<number>(faceCount).fill(-1);
  parent[root] = root;
  const q: number[] = [root];
  const order: number[] = [root];
  while (q.length) {
    const v = q.shift()!;
    for (const e of adjList[v]!) {
      if (parent[e.to] !== -1) continue;
      parent[e.to] = v;
      parentEdge[e.to] = e.edgeFrom;
      childEdge[e.to] = e.edgeTo;
      q.push(e.to);
      order.push(e.to);
    }
  }

  const poses2: Array<{ pos: THREE.Vector2; rot: number } | null> = new Array(faceCount).fill(null);
  poses2[root] = { pos: new THREE.Vector2(0, 0), rot: 0 };
  for (const i of order) {
    if (i === root) continue;
    const p = parent[i];
    const pp = poses2[p];
    if (!pp) continue;
    poses2[i] = attachPolygonAlongEdge(pp, parentEdge[i]!, childEdge[i]!, poly);
  }

  return centerPoses(
    poses2.map((p) => ({
      position: new THREE.Vector3(p?.pos.x ?? 0, p?.pos.y ?? 0, 0),
      quaternion: qFromEuler(0, 0, p?.rot ?? 0),
    })),
  );
}

function makeTriangleGeometry(edge: number) {
  const h = (Math.sqrt(3) / 2) * edge;
  const shape = new THREE.Shape();
  const A = new THREE.Vector2(-edge / 2, -h / 3);
  const B = new THREE.Vector2(edge / 2, -h / 3);
  const C = new THREE.Vector2(0, (2 * h) / 3);
  shape.moveTo(A.x, A.y);
  shape.lineTo(B.x, B.y);
  shape.lineTo(C.x, C.y);
  shape.lineTo(A.x, A.y);
  const geom = new THREE.ShapeGeometry(shape);
  geom.computeVertexNormals();
  return geom;
}

function makeSquareGeometry(edge: number) {
  const geom = new THREE.PlaneGeometry(edge, edge);
  geom.computeVertexNormals();
  return geom;
}

function makePentagonGeometry(edge: number) {
  const verts = pentagonLocal2(edge);
  const shape = new THREE.Shape();
  shape.moveTo(verts[0]!.x, verts[0]!.y);
  for (let i = 1; i < verts.length; i++) shape.lineTo(verts[i]!.x, verts[i]!.y);
  shape.lineTo(verts[0]!.x, verts[0]!.y);
  const geom = new THREE.ShapeGeometry(shape);
  geom.computeVertexNormals();
  return geom;
}

function usePolyDefs(): PolyDef[] {
  return useMemo(() => {
    const edge = 1.6;
    const s = edge;

    const cubeNet: FacePose[] = [
      { position: new THREE.Vector3(0, 0, 0), quaternion: qFromEuler(0, 0, 0) },
      { position: new THREE.Vector3(-s, 0, 0), quaternion: qFromEuler(0, 0, 0) },
      { position: new THREE.Vector3(s, 0, 0), quaternion: qFromEuler(0, 0, 0) },
      { position: new THREE.Vector3(2 * s, 0, 0), quaternion: qFromEuler(0, 0, 0) },
      { position: new THREE.Vector3(0, s, 0), quaternion: qFromEuler(0, 0, 0) },
      { position: new THREE.Vector3(0, -s, 0), quaternion: qFromEuler(0, 0, 0) },
    ];

    const half = edge / 2;
    const cubeFolded: FacePose[] = [
      { position: new THREE.Vector3(0, 0, half), quaternion: qFromEuler(0, 0, 0) },
      { position: new THREE.Vector3(-half, 0, 0), quaternion: qFromEuler(0, -Math.PI / 2, 0) },
      { position: new THREE.Vector3(half, 0, 0), quaternion: qFromEuler(0, Math.PI / 2, 0) },
      { position: new THREE.Vector3(0, 0, -half), quaternion: qFromEuler(0, Math.PI, 0) },
      { position: new THREE.Vector3(0, half, 0), quaternion: qFromEuler(-Math.PI / 2, 0, 0) },
      { position: new THREE.Vector3(0, -half, 0), quaternion: qFromEuler(Math.PI / 2, 0, 0) },
    ];

    const tetraFolded = makeTetraFolded(edge);
    const tetraNet = makeTetraNet(edge, tetraFolded);

    const octaFolded = makeOctaFolded(edge);
    const octaNet = makeOctaNet(edge, octaFolded);

    const icosaFolded = makeIcosaFolded(edge);
    const icosaNet = makeIcosaNet(edge, icosaFolded);

    const dodecaFolded = makeDodecaFolded(edge);
    const dodecaNet = makeDodecaNet(edge, dodecaFolded);

    const cubeNetCentered = centerPoses(cubeNet);

    const defs: PolyDef[] = [
      {
        id: "cube",
        name: "정육면체 (Cube)",
        faceCount: 6,
        face: "square",
        edge,
        net: cubeNetCentered,
        folded: cubeFolded,
        camera: suggestCamera(cubeNetCentered, cubeFolded, "square", edge),
      },
      {
        id: "tetra",
        name: "정사면체 (Tetrahedron)",
        faceCount: 4,
        face: "triangle",
        edge,
        net: tetraNet,
        folded: tetraFolded,
        camera: suggestCamera(tetraNet, tetraFolded, "triangle", edge),
      },
      {
        id: "octa",
        name: "정팔면체 (Octahedron)",
        faceCount: 8,
        face: "triangle",
        edge,
        net: octaNet,
        folded: octaFolded,
        camera: suggestCamera(octaNet, octaFolded, "triangle", edge),
      },
      {
        id: "icosa",
        name: "정이십면체 (Icosahedron)",
        faceCount: 20,
        face: "triangle",
        edge,
        net: icosaNet,
        folded: icosaFolded,
        camera: suggestCamera(icosaNet, icosaFolded, "triangle", edge),
      },
      {
        id: "dodeca",
        name: "정십이면체 (Dodecahedron)",
        faceCount: 12,
        face: "pentagon",
        edge,
        net: dodecaNet,
        folded: dodecaFolded,
        camera: suggestCamera(dodecaNet, dodecaFolded, "pentagon", edge),
      },
    ];

    return defs;
  }, []);
}

function NetSVG({ def }: { def: PolyDef }) {
  const edge = def.edge;
  const triLocal = triangleLocal2(edge);
  const squareLocal = [
    new THREE.Vector2(-edge / 2, -edge / 2),
    new THREE.Vector2(edge / 2, -edge / 2),
    new THREE.Vector2(edge / 2, edge / 2),
    new THREE.Vector2(-edge / 2, edge / 2),
  ];
  const pentLocal = pentagonLocal2(edge);

  const local = def.face === "square" ? squareLocal : def.face === "pentagon" ? pentLocal : triLocal;

  const faces = def.net.map((p) => {
    const e = new THREE.Euler().setFromQuaternion(p.quaternion);
    const rot = e.z;
    const pos = new THREE.Vector2(p.position.x, p.position.y);
    const verts = local.map((v) => applyPose2({ pos, rot }, v));
    return verts;
  });

  const allPts = faces.flat();
  const minX = Math.min(...allPts.map((p) => p.x)) - edge;
  const maxX = Math.max(...allPts.map((p) => p.x)) + edge;
  const minY = Math.min(...allPts.map((p) => p.y)) - edge;
  const maxY = Math.max(...allPts.map((p) => p.y)) + edge;
  const width = maxX - minX;
  const height = maxY - minY;
  const viewBox = `${minX} ${-maxY} ${width} ${height}`;

  const facePath = (verts: THREE.Vector2[]) => {
    const parts = verts.map((v) => `${v.x} ${-v.y}`);
    return `M ${parts[0]} L ${parts.slice(1).join(" L ")} Z`;
  };

  return (
    <svg viewBox={viewBox} className="h-full w-full">
      <g>
        {faces.map((verts, i) => (
          <path
            key={i}
            d={facePath(verts)}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.04}
            opacity={0.85}
          />
        ))}
      </g>
    </svg>
  );
}

function Faces({ def, t, autoRotate }: { def: PolyDef; t: number; autoRotate: boolean }) {
  const group = useRef<THREE.Group>(null);

  const geom = useMemo(() => {
    if (def.face === "square") return makeSquareGeometry(def.edge);
    if (def.face === "pentagon") return makePentagonGeometry(def.edge);
    return makeTriangleGeometry(def.edge);
  }, [def.face, def.edge]);

  const edgesGeom = useMemo(() => new THREE.EdgesGeometry(geom, 1), [geom]);

  const hingeModel = useMemo(() => buildHingeModel(def), [def]);
  const poses = useMemo(() => hingePoses(def, hingeModel, t), [def, hingeModel, t]);

  const baseMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color("#ffffff"),
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96,
    });
  }, []);

  const edgeMaterial = useMemo(() => {
    return new THREE.LineBasicMaterial({
      color: new THREE.Color("#111111"),
      transparent: true,
      opacity: 0.65,
    });
  }, []);

  const faceColors = useMemo(() => {
    const arr: THREE.Color[] = [];
    for (let i = 0; i < def.faceCount; i++) {
      arr.push(new THREE.Color().setHSL((i / def.faceCount) * 0.9, 0.35, 0.85));
    }
    return arr;
  }, [def.faceCount]);

  const materials = useMemo(() => {
    return faceColors.map((c) => {
      const m = baseMaterial.clone();
      m.color = c;
      return m;
    });
  }, [baseMaterial, faceColors]);

  useFrame((_, dt) => {
    if (!group.current) return;
    if (autoRotate) {
      const k = t;
      group.current.rotation.y += dt * 0.4 * k;
      group.current.rotation.x += dt * 0.15 * k;
    }
  });

  return (
    <group ref={group}>
      {Array.from({ length: def.faceCount }).map((_, i) => {
        const p = poses[i] ?? def.net[i];

        return (
          <group key={i} position={p.position} quaternion={p.quaternion}>
            <mesh geometry={geom} material={materials[i]} />
            <lineSegments
              geometry={edgesGeom}
              material={edgeMaterial}
              renderOrder={1}
            />
          </group>
        );
      })}
    </group>
  );
}

function Scene({ def, t, autoRotate }: { def: PolyDef; t: number; autoRotate: boolean }) {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 6, 4]} intensity={1.1} />
      <directionalLight position={[-5, -2, -3]} intensity={0.35} />
      <Faces def={def} t={t} autoRotate={autoRotate} />
      <OrbitControls enableDamping dampingFactor={0.08} />
      <gridHelper args={[14, 14]} position={[0, -4, 0]} />
    </>
  );
}

export default function PolyNetSliderApp() {
  const defs = usePolyDefs();
  const [polyId, setPolyId] = useState<PolyDef["id"]>("cube");
  const [t, setT] = useState(0.0);
  const [autoRotate, setAutoRotate] = useState(true);

  const def = defs.find((d) => d.id === polyId) ?? defs[0];

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            정다면체 전개도 ↔ 입체 슬라이더 시각화
          </h1>
          <p className="text-sm text-muted-foreground">
            슬라이더를 움직이면 전개도(0)에서 입체(1)로 면들이 공통변(edge)을 경첩처럼 기준으로
            실제로 접히도록 계산합니다.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">컨트롤</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <div className="text-sm font-medium">정다면체 선택</div>
                <Select value={polyId} onValueChange={(v) => setPolyId(v as PolyDef["id"])}>
                  <SelectTrigger>
                    <SelectValue placeholder="선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {defs.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">접힘 정도</div>
                  <div className="text-xs text-muted-foreground">t = {t.toFixed(2)}</div>
                </div>
                <Slider
                  value={[t]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={(v) => setT(v[0] ?? 0)}
                />
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setT(0)}>
                    전개도
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setT(1)}>
                    입체
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setT(0)}
                    className="ml-auto"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    초기화
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border p-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">자동 회전</div>
                  <div className="text-xs text-muted-foreground">입체를 돌려가며 보기</div>
                </div>
                <Switch checked={autoRotate} onCheckedChange={setAutoRotate} />
              </div>

              <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground leading-relaxed">
                <div className="font-medium text-foreground">확장 아이디어</div>
                <ul className="mt-1 list-disc pl-4">
                  <li>정십이면체/정이십면체 추가</li>
                  <li>실제 경첩(면-면 공통변) 기준 접힘 (적용됨)</li>
                  <li>전개도 자동 생성(그래프 기반)</li>
                  <li>면에 번호/패턴/학습용 주석 표시</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">전개도 미리보기 (2D)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="aspect-square w-full rounded-xl border border-border bg-muted/30 p-2">
                <NetSVG def={def} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                이 영역은 전개도 배치를 SVG로 빠르게 보여줍니다. 3D에서 슬라이더로 접히는 효과를
                확인하세요.
              </p>
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">3D 시각화</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="aspect-square w-full overflow-hidden rounded-xl border border-border">
                <Canvas camera={{ position: def.camera.pos, fov: def.camera.fov }}>
                  <Scene def={def} t={t} autoRotate={autoRotate} />
                </Canvas>
              </div>
              <div className="mt-3 text-xs text-muted-foreground leading-relaxed">
                마우스로 드래그: 회전 · 휠: 확대/축소 · 오른쪽 드래그: 이동
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">프로젝트에 붙이는 방법</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground leading-relaxed">
            <ol className="list-decimal pl-5 space-y-1">
              <li>
                패키지 설치:{" "}
                <span className="font-mono text-foreground">
                  @react-three/fiber @react-three/drei three
                </span>
              </li>
              <li>
                위 컴포넌트를 페이지에 렌더링 (Next.js라면{" "}
                <span className="font-mono text-foreground">app/...</span> 또는{" "}
                <span className="font-mono text-foreground">pages/...</span>에 import)
              </li>
              <li>shadcn/ui가 없다면 버튼/슬라이더/셀렉트를 일반 HTML로 바꿔도 동작합니다.</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
