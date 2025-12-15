import * as THREE from "three";
import {
  makeTreeTriangleNet,
  orientFaceOutward,
  poseFromTriangle3,
  suggestCamera,
  type FacePose,
  type PolyDef,
} from "../core";

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

export function createOctahedronDef(edge: number): PolyDef {
  const folded = makeOctaFolded(edge);
  const net = makeTreeTriangleNet(edge, folded);

  return {
    id: "octa",
    name: "정팔면체 (Octahedron)",
    faceCount: 8,
    face: "triangle",
    edge,
    net,
    folded,
    camera: suggestCamera(net, folded, "triangle", edge),
  };
}

