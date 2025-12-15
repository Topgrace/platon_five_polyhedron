import * as THREE from "three";
import {
  makeTreeTriangleNet,
  orientFaceOutward,
  poseFromTriangle3,
  suggestCamera,
  type FacePose,
  type PolyDef,
} from "../core";

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

export function createTetrahedronDef(edge: number): PolyDef {
  const folded = makeTetraFolded(edge);
  const net = makeTreeTriangleNet(edge, folded);

  return {
    id: "tetra",
    name: "정사면체 (Tetrahedron)",
    faceCount: 4,
    face: "triangle",
    edge,
    net,
    folded,
    camera: suggestCamera(net, folded, "triangle", edge),
  };
}

