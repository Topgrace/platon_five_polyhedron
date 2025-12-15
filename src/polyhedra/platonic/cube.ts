import * as THREE from "three";
import { centerPoses, qFromEuler, suggestCamera, type FacePose, type PolyDef } from "../core";

export function createCubeDef(edge: number): PolyDef {
  const s = edge;

  const net: FacePose[] = [
    { position: new THREE.Vector3(0, 0, 0), quaternion: qFromEuler(0, 0, 0) },
    { position: new THREE.Vector3(-s, 0, 0), quaternion: qFromEuler(0, 0, 0) },
    { position: new THREE.Vector3(s, 0, 0), quaternion: qFromEuler(0, 0, 0) },
    { position: new THREE.Vector3(2 * s, 0, 0), quaternion: qFromEuler(0, 0, 0) },
    { position: new THREE.Vector3(0, s, 0), quaternion: qFromEuler(0, 0, 0) },
    { position: new THREE.Vector3(0, -s, 0), quaternion: qFromEuler(0, 0, 0) },
  ];

  const half = edge / 2;
  const folded: FacePose[] = [
    { position: new THREE.Vector3(0, 0, half), quaternion: qFromEuler(0, 0, 0) },
    { position: new THREE.Vector3(-half, 0, 0), quaternion: qFromEuler(0, -Math.PI / 2, 0) },
    { position: new THREE.Vector3(half, 0, 0), quaternion: qFromEuler(0, Math.PI / 2, 0) },
    { position: new THREE.Vector3(0, 0, -half), quaternion: qFromEuler(0, Math.PI, 0) },
    { position: new THREE.Vector3(0, half, 0), quaternion: qFromEuler(-Math.PI / 2, 0, 0) },
    { position: new THREE.Vector3(0, -half, 0), quaternion: qFromEuler(Math.PI / 2, 0, 0) },
  ];

  const netCentered = centerPoses(net);

  return {
    id: "cube",
    name: "정육면체 (Cube)",
    faceCount: 6,
    face: "square",
    edge,
    net: netCentered,
    folded,
    camera: suggestCamera(netCentered, folded, "square", edge),
  };
}

