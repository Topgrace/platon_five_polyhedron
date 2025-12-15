import * as THREE from "three";

export type PolyId = "tetra" | "cube" | "octa" | "dodeca" | "icosa";
export type FaceKind = "square" | "triangle" | "pentagon";

export type FacePose = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

export type PolyDef = {
  id: PolyId;
  name: string;
  faceCount: number;
  face: FaceKind;
  edge: number;
  net: FacePose[];
  folded: FacePose[];
  camera: { pos: [number, number, number]; fov: number };
};

export type TriEdge = 0 | 1 | 2;

type NetAdjEdge = {
  a: number;
  b: number;
  edgeA: number;
  edgeB: number;
};

export type Hinge = {
  parent: number;
  axis: THREE.Vector3;
  point: THREE.Vector3;
  relNet: THREE.Matrix4;
  angle: number;
};

export type HingeModel = {
  root: number;
  order: number[];
  hinges: Array<Hinge | null>;
};

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

export function qFromEuler(x: number, y: number, z: number) {
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

export function triangleLocal2(edge: number): [THREE.Vector2, THREE.Vector2, THREE.Vector2] {
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

export function pentagonLocal2(edge: number) {
  return pentagonLocal3(edge).map((v) => new THREE.Vector2(v.x, v.y));
}

function localVerts3(face: FaceKind, edge: number) {
  if (face === "square") return squareLocal3(edge);
  if (face === "pentagon") return pentagonLocal3(edge);
  return triangleLocal3(edge);
}

export function applyPose2(
  { pos, rot }: { pos: THREE.Vector2; rot: number },
  v: THREE.Vector2,
) {
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

function netAdjEdges(net: FacePose[], face: FaceKind, edge: number): NetAdjEdge[] {
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

export function buildHingeModel(def: PolyDef): HingeModel {
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

export function hingePoses(def: PolyDef, model: HingeModel, t: number): FacePose[] {
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

export function attachTriangleAlongEdge(
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

export function attachPolygonAlongEdge(
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

export function centerPoses(poses: FacePose[]) {
  const center = new THREE.Vector3();
  for (const p of poses) center.add(p.position);
  center.multiplyScalar(1 / poses.length);
  return poses.map((p) => ({
    position: p.position.clone().sub(center),
    quaternion: p.quaternion.clone(),
  }));
}

function faceRadius(face: FaceKind, edge: number) {
  if (face === "square") return (Math.SQRT2 * edge) / 2;
  if (face === "pentagon") return edge / (2 * Math.sin(Math.PI / 5));
  return edge / Math.sqrt(3);
}

function estimateRadius(poses: FacePose[], face: FaceKind, edge: number) {
  let r = 0;
  for (const p of poses) r = Math.max(r, p.position.length());
  return r + faceRadius(face, edge);
}

export function suggestCamera(net: FacePose[], folded: FacePose[], face: FaceKind, edge: number) {
  const fov = 45;
  const radius = Math.max(estimateRadius(net, face, edge), estimateRadius(folded, face, edge));
  const dist = (radius / Math.tan((fov * Math.PI) / 360)) * 1.15;
  const dir = new THREE.Vector3(1, 0.85, 1.15).normalize();
  const p = dir.multiplyScalar(dist);
  return { pos: [p.x, p.y, p.z] as [number, number, number], fov };
}

export function poseFromTriangle3(v0: THREE.Vector3, v1: THREE.Vector3, v2: THREE.Vector3): FacePose {
  const position = v0.clone().add(v1).add(v2).multiplyScalar(1 / 3);

  const xAxis = v1.clone().sub(v0).normalize();
  const normal = v1.clone().sub(v0).cross(v2.clone().sub(v0)).normalize();
  const yAxis = normal.clone().cross(xAxis).normalize();

  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  return { position, quaternion };
}

export function poseFromPolygon3(verts: THREE.Vector3[]): FacePose {
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

export function orientFaceOutward(
  vertices: THREE.Vector3[],
  face: [number, number, number],
): [number, number, number] {
  const [a, b, c] = face;
  const v0 = vertices[a]!;
  const v1 = vertices[b]!;
  const v2 = vertices[c]!;
  const normal = v1.clone().sub(v0).cross(v2.clone().sub(v0));
  const centroid = v0.clone().add(v1).add(v2).multiplyScalar(1 / 3);
  if (normal.dot(centroid) < 0) return [a, c, b];
  return face;
}

export function makeTriangleGeometry(edge: number) {
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

export function makeSquareGeometry(edge: number) {
  const geom = new THREE.PlaneGeometry(edge, edge);
  geom.computeVertexNormals();
  return geom;
}

export function makePentagonGeometry(edge: number) {
  const verts = pentagonLocal2(edge);
  const shape = new THREE.Shape();
  shape.moveTo(verts[0]!.x, verts[0]!.y);
  for (let i = 1; i < verts.length; i++) shape.lineTo(verts[i]!.x, verts[i]!.y);
  shape.lineTo(verts[0]!.x, verts[0]!.y);
  const geom = new THREE.ShapeGeometry(shape);
  geom.computeVertexNormals();
  return geom;
}

export function makeTreeTriangleNet(edge: number, folded: FacePose[]): FacePose[] {
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
    poses2[i] = attachTriangleAlongEdge(
      pp,
      parentEdge[i] as TriEdge,
      childEdge[i] as TriEdge,
      tri,
    );
  }

  return centerPoses(
    poses2.map((p) => ({
      position: new THREE.Vector3(p?.pos.x ?? 0, p?.pos.y ?? 0, 0),
      quaternion: qFromEuler(0, 0, p?.rot ?? 0),
    })),
  );
}

export function makeTreePolygonNet(edge: number, folded: FacePose[], sides: number): FacePose[] {
  if (sides === 3) return makeTreeTriangleNet(edge, folded);
  if (sides !== 5) throw new Error(`Unsupported polygon sides: ${sides}`);

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

