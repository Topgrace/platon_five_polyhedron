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
import {
  applyPose2,
  buildHingeModel,
  hingePoses,
  makePentagonGeometry,
  makeSquareGeometry,
  makeTriangleGeometry,
  pentagonLocal2,
  triangleLocal2,
  type PolyDef,
} from "@/polyhedra/core";
import { usePolyDefs } from "@/polyhedra/use-poly-defs";

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

  const local =
    def.face === "square" ? squareLocal : def.face === "pentagon" ? pentLocal : triLocal;

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
            <lineSegments geometry={edgesGeom} material={edgeMaterial} renderOrder={1} />
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
                  <Button variant="outline" size="sm" onClick={() => setT(0)} className="ml-auto">
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

