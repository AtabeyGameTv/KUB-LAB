import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  COLOR_META,
  FACE_AXIS_SPEC,
  parseMove,
  STICKER_GEOMS,
} from './cubeMath';
import type { DraftFacelets, FaceName, MoveName } from './types';

export interface QueuedTurn {
  move: MoveName;
  durationMs: number;
  onComplete?: () => void;
}

export interface Cube3DHandle {
  enqueueTurn: (turn: QueuedTurn) => void;
  clearQueue: () => void;
  setFaceletsImmediate: (facelets: DraftFacelets) => void;
  focusFace: (face: FaceName) => void;
  focusSolveView: () => void;
  resetCamera: () => void;
}

interface Cube3DViewportProps {
  initialFacelets: DraftFacelets;
  onBusyChange?: (busy: boolean) => void;
}

const CUBIE_SIZE = 0.94;
const CUBIE_SPACING = 1.0;
const GRAY_STICKER_HEX = 0x3b4046;
const SOLVE_CAM_POS = new THREE.Vector3(4.15, 3.3, 4.55);
const DEFAULT_CAM_TARGET = new THREE.Vector3(0, 0, 0);
const CAM_GLIDE_MS = 820;

const FACE_CAM_POS: Record<FaceName, THREE.Vector3> = {
  F: new THREE.Vector3(0.5, 0.72, 5.45),
  R: new THREE.Vector3(5.45, 0.72, 0.5),
  B: new THREE.Vector3(-0.5, 0.72, -5.45),
  L: new THREE.Vector3(-5.45, 0.72, -0.5),
  U: new THREE.Vector3(0, 5.45, 1.2),
  D: new THREE.Vector3(0, -5.45, 1.2),
};

// Pre-allocated math helpers (zero GC inside render loop)
const _tmpVec = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpMat = new THREE.Matrix4();
const _camLerpDir = new THREE.Vector3();

function createRoundedStickerGeometry(size = 0.77, radius = 0.085): THREE.ExtrudeGeometry {
  const half = size / 2;
  const r = Math.min(radius, half * 0.45);
  const shape = new THREE.Shape();
  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.quadraticCurveTo(half, -half, half, -half + r);
  shape.lineTo(half, half - r);
  shape.quadraticCurveTo(half, half, half - r, half);
  shape.lineTo(-half + r, half);
  shape.quadraticCurveTo(-half, half, -half, half - r);
  shape.lineTo(-half, -half + r);
  shape.quadraticCurveTo(-half, -half, -half + r, -half);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.014,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.center();
  return geo;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 124);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.28)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function snapMatrix90(obj: THREE.Object3D): void {
  obj.position.set(
    Math.round(obj.position.x / CUBIE_SPACING) * CUBIE_SPACING,
    Math.round(obj.position.y / CUBIE_SPACING) * CUBIE_SPACING,
    Math.round(obj.position.z / CUBIE_SPACING) * CUBIE_SPACING
  );
  _tmpMat.makeRotationFromQuaternion(obj.quaternion);
  const e = _tmpMat.elements;
  for (let i = 0; i < 16; i++) {
    if (i % 4 === 3 || i >= 12) continue;
    const v = e[i];
    if (Math.abs(v) < 0.5) e[i] = 0;
    else e[i] = v > 0 ? 1 : -1;
  }
  obj.quaternion.setFromRotationMatrix(_tmpMat).normalize();
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export const Cube3DViewport = forwardRef<Cube3DHandle, Cube3DViewportProps>(
  function Cube3DViewport({ initialFacelets, onBusyChange }, ref) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [webglError, setWebglError] = useState<string | null>(null);

    const onBusyChangeRef = useRef(onBusyChange);
    onBusyChangeRef.current = onBusyChange;

    const apiRef = useRef<{
      enqueueTurn: (turn: QueuedTurn) => void;
      clearQueue: () => void;
      setFaceletsImmediate: (facelets: DraftFacelets) => void;
      focusFace: (face: FaceName) => void;
      focusSolveView: () => void;
      resetCamera: () => void;
    } | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        enqueueTurn: (turn) => apiRef.current?.enqueueTurn(turn),
        clearQueue: () => apiRef.current?.clearQueue(),
        setFaceletsImmediate: (f) => apiRef.current?.setFaceletsImmediate(f),
        focusFace: (face) => apiRef.current?.focusFace(face),
        focusSolveView: () => apiRef.current?.focusSolveView(),
        resetCamera: () => apiRef.current?.resetCamera(),
      }),
      []
    );

    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      // 1. Software WebGL probe
      const isSoftwareGl = (() => {
        try {
          const testCanvas = document.createElement('canvas');
          const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
          if (!gl) return true;
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
          const gpu = String(gl.getParameter(param));
          gl.getExtension('WEBGL_lose_context')?.loseContext();
          return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
        } catch {
          return true;
        }
      })();

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: !isSoftwareGl,
          powerPreference: 'high-performance',
        });
      } catch {
        setWebglError('Brauzerdə WebGL 3D görüntüləməsi işə düşmədi.');
        return;
      }

      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;

      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = !isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const canvas = renderer.domElement;
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      container.appendChild(canvas);

      // Scene & Camera
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x121212);
      scene.fog = new THREE.FogExp2(0x121212, 0.038);

      const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 80);
      camera.position.copy(FACE_CAM_POS.F);

      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = !isSoftwareGl;
      controls.dampingFactor = 0.07;
      controls.enablePan = false;
      controls.minDistance = 4.2;
      controls.maxDistance = 12;
      controls.target.copy(DEFAULT_CAM_TARGET);

      // Procedural Studio Reflection (RoomEnvironment)
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTexture;
      pmremGenerator.dispose();

      // 3-Point Studio Lighting (Warm key + Cool hemi fill + Crisp/Emerald rim)
      const hemiLight = new THREE.HemisphereLight(0xa5c8ff, 0x0e1714, 0.72);
      scene.add(hemiLight);

      const keyLight = new THREE.DirectionalLight(0xfff5e8, 2.05);
      keyLight.position.set(5.5, 8.0, 6.2);
      keyLight.castShadow = !isSoftwareGl;
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 25;
      keyLight.shadow.camera.left = -3.6;
      keyLight.shadow.camera.right = 3.6;
      keyLight.shadow.camera.top = 3.6;
      keyLight.shadow.camera.bottom = -3.6;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0xb7dcff, 0.65);
      fillLight.position.set(-6.0, 2.5, -4.5);
      scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0x34d399, 0.75);
      rimLight.position.set(-3.5, -4.0, -5.5);
      scene.add(rimLight);

      // Grounding studio pedestal & contact shadow
      const studioGroup = new THREE.Group();
      scene.add(studioGroup);

      const shadowTex = createContactShadowTexture();
      const shadowGeo = new THREE.PlaneGeometry(5.6, 5.6);
      const shadowMat = new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      });
      const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.position.y = -2.38;
      studioGroup.add(shadowPlane);

      // Subtle architectural ring pedestal below the cube
      const ringGeo = new THREE.RingGeometry(2.15, 2.2, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = -2.37;
      studioGroup.add(ringMesh);

      const outerRingGeo = new THREE.RingGeometry(2.65, 2.67, 64);
      const outerRingMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
      });
      const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
      outerRingMesh.rotation.x = -Math.PI / 2;
      outerRingMesh.position.y = -2.37;
      studioGroup.add(outerRingMesh);

      // Build Composite Rubik's Cube (26 outer cubies + internal machined core)
      const cubeRoot = new THREE.Group();
      scene.add(cubeRoot);

      const pivotGroup = new THREE.Group();
      cubeRoot.add(pivotGroup);

      // Internal core spider (visible during slice rotation seams)
      const coreGroup = new THREE.Group();
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0x1d2925,
        metalness: 0.85,
        roughness: 0.24,
      });
      const coreSphereGeo = new THREE.SphereGeometry(0.62, 24, 24);
      const coreSphere = new THREE.Mesh(coreSphereGeo, coreMat);
      coreGroup.add(coreSphere);

      const axleGeo = new THREE.CylinderGeometry(0.14, 0.14, 1.85, 16);
      const axleX = new THREE.Mesh(axleGeo, coreMat);
      axleX.rotation.z = Math.PI / 2;
      const axleY = new THREE.Mesh(axleGeo, coreMat);
      const axleZ = new THREE.Mesh(axleGeo, coreMat);
      axleZ.rotation.x = Math.PI / 2;
      coreGroup.add(axleX, axleY, axleZ);
      cubeRoot.add(coreGroup);

      // Cubie geometries and materials
      const bodyGeo = new RoundedBoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE, 4, 0.072);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x111514,
        roughness: 0.42,
        metalness: 0.08,
      });
      const stickerGeo = createRoundedStickerGeometry(0.76, 0.085);

      const stickerGeomsMap = new Map<string, number>();
      for (const s of STICKER_GEOMS) {
        stickerGeomsMap.set(`${s.x},${s.y},${s.z}|${s.nx},${s.ny},${s.nz}`, s.index);
      }

      interface CubieRecord {
        group: THREE.Group;
        homeX: number;
        homeY: number;
        homeZ: number;
      }

      const cubies: CubieRecord[] = [];
      const stickerMeshes: THREE.Mesh[] = [];
      const disposableMaterials: THREE.Material[] = [
        bodyMat,
        coreMat,
        shadowMat,
        ringMat,
        outerRingMat,
      ];

      for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
          for (let z = -1; z <= 1; z++) {
            if (x === 0 && y === 0 && z === 0) continue;
            const cubieGroup = new THREE.Group();
            cubieGroup.position.set(x * CUBIE_SPACING, y * CUBIE_SPACING, z * CUBIE_SPACING);

            const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
            bodyMesh.castShadow = !isSoftwareGl;
            bodyMesh.receiveShadow = !isSoftwareGl;
            cubieGroup.add(bodyMesh);

            const normals: [number, number, number][] = [];
            if (y === 1) normals.push([0, 1, 0]);
            if (y === -1) normals.push([0, -1, 0]);
            if (x === 1) normals.push([1, 0, 0]);
            if (x === -1) normals.push([-1, 0, 0]);
            if (z === 1) normals.push([0, 0, 1]);
            if (z === -1) normals.push([0, 0, -1]);

            for (const [nx, ny, nz] of normals) {
              const sIdx = stickerGeomsMap.get(`${x},${y},${z}|${nx},${ny},${nz}`);
              if (sIdx === undefined) continue;
              const initialColor = initialFacelets[sIdx];
              const sMat = new THREE.MeshPhysicalMaterial({
                color: initialColor ? COLOR_META[initialColor].threeHex : GRAY_STICKER_HEX,
                roughness: initialColor ? 0.16 : 0.45,
                metalness: 0.0,
                clearcoat: initialColor ? 0.9 : 0.15,
                clearcoatRoughness: 0.1,
              });
              disposableMaterials.push(sMat);

              const sMesh = new THREE.Mesh(stickerGeo, sMat);
              sMesh.userData.stickerIndex = sIdx;
              const offset = CUBIE_SIZE / 2 + 0.008;
              sMesh.position.set(nx * offset, ny * offset, nz * offset);

              // Orient extruded tile (+Z default) along outward normal
              _tmpVec.set(nx, ny, nz);
              _tmpQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _tmpVec);
              sMesh.quaternion.copy(_tmpQuat);

              cubieGroup.add(sMesh);
              stickerMeshes.push(sMesh);
            }

            cubeRoot.add(cubieGroup);
            cubies.push({ group: cubieGroup, homeX: x, homeY: y, homeZ: z });
          }
        }
      }

      if (!isSoftwareGl) {
        renderer.compile(scene, camera);
      }

      // Animation & Render-on-demand loop
      let frameId = 0;
      let disposed = false;
      let renderBusy = false;
      let renderDirty = false;
      let cameraAnimating = false;
      let camAnimElapsed = 0;
      let camStartRadius = FACE_CAM_POS.F.length();
      let camEndRadius = FACE_CAM_POS.F.length();
      const camStartDir = new THREE.Vector3().copy(FACE_CAM_POS.F).normalize();
      const camEndDir = new THREE.Vector3().copy(FACE_CAM_POS.F).normalize();
      const camStartTarget = new THREE.Vector3().copy(DEFAULT_CAM_TARGET);
      const desiredCamPos = new THREE.Vector3().copy(FACE_CAM_POS.F);
      let lastTime = performance.now();

      const turnQueue: QueuedTurn[] = [];
      let activeTurn: {
        turn: QueuedTurn;
        axis: 'x' | 'y' | 'z';
        targetAngle: number;
        elapsed: number;
        sliceCubies: THREE.Group[];
      } | null = null;

      const updateBusyState = () => {
        const busy = activeTurn !== null || turnQueue.length > 0;
        onBusyChangeRef.current?.(busy);
      };

      function startNextTurn() {
        if (activeTurn || turnQueue.length === 0) {
          updateBusyState();
          return;
        }
        const next = turnQueue.shift()!;
        const { base, turns } = parseMove(next.move);
        const spec = FACE_AXIS_SPEC[base];
        const angleSteps = turns === 3 ? -1 : turns; // 1 => +90 deg cw, 2 => +180 deg cw, 3 => -90 deg cw
        const targetAngle = spec.cwDir * angleSteps * (Math.PI / 2);

        const sliceCubies: THREE.Group[] = [];
        for (const c of cubies) {
          const coord =
            spec.axis === 'x'
              ? Math.round(c.group.position.x / CUBIE_SPACING)
              : spec.axis === 'y'
                ? Math.round(c.group.position.y / CUBIE_SPACING)
                : Math.round(c.group.position.z / CUBIE_SPACING);
          if (coord === spec.layer) {
            sliceCubies.push(c.group);
          }
        }

        pivotGroup.rotation.set(0, 0, 0);
        pivotGroup.updateMatrixWorld();
        for (const cg of sliceCubies) {
          pivotGroup.attach(cg);
        }

        activeTurn = {
          turn: next,
          axis: spec.axis,
          targetAngle,
          elapsed: 0,
          sliceCubies,
        };
        updateBusyState();
      }

      function finishActiveTurn() {
        if (!activeTurn) return;
        pivotGroup.rotation[activeTurn.axis] = activeTurn.targetAngle;
        pivotGroup.updateMatrixWorld();

        for (const cg of activeTurn.sliceCubies) {
          cubeRoot.attach(cg);
          snapMatrix90(cg);
        }
        pivotGroup.rotation.set(0, 0, 0);

        const cb = activeTurn.turn.onComplete;
        activeTurn = null;
        cb?.();
        startNextTurn();
      }

      function afterDraw(cb: () => void) {
        if (disposed) return;
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (gl && typeof gl.fenceSync === 'function') {
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          const poll = () => {
            if (disposed) return;
            const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
            if (state === gl.UNSIGNALED) {
              frameId = window.setTimeout(poll, 5);
            } else {
              if (sync) gl.deleteSync(sync);
              frameId = window.setTimeout(cb, 80);
            }
          };
          frameId = window.setTimeout(poll, 5);
        } else {
          frameId = window.setTimeout(cb, 80);
        }
      }

      function requestRender() {
        if (disposed) return;
        if (renderBusy) {
          renderDirty = true;
          return;
        }
        renderBusy = true;
        frameId = requestAnimationFrame(() => {
          if (disposed) return;
          renderDirty = false;
          const now = performance.now();
          const dt = Math.min((now - lastTime) / 1000, 0.05);
          lastTime = now;

          let needsMore = false;

          // Advance active turn animation
          if (!activeTurn && turnQueue.length > 0) {
            startNextTurn();
          }

          if (activeTurn) {
            activeTurn.elapsed += dt * 1000;
            const dur = Math.max(1, activeTurn.turn.durationMs);
            const rawT = Math.min(1, activeTurn.elapsed / dur);
            const eased = easeInOutCubic(rawT);
            pivotGroup.rotation[activeTurn.axis] = activeTurn.targetAngle * eased;
            if (rawT >= 1) {
              finishActiveTurn();
            }
            if (activeTurn || turnQueue.length > 0) {
              needsMore = true;
            }
          }

          // Smooth spherical camera glide
          if (cameraAnimating) {
            camAnimElapsed += dt * 1000;
            const rawT = Math.min(1, camAnimElapsed / CAM_GLIDE_MS);
            const eased = easeInOutCubic(rawT);

            _camLerpDir.copy(camStartDir).lerp(camEndDir, eased);
            if (camStartDir.dot(camEndDir) < -0.92) {
              const arc = Math.sin(eased * Math.PI) * 0.45;
              _camLerpDir.x += arc;
              _camLerpDir.y += arc * 0.6;
            }
            if (_camLerpDir.lengthSq() < 1e-6) {
              _camLerpDir.set(0, 1, 0);
            }
            _camLerpDir.normalize();
            const r = THREE.MathUtils.lerp(camStartRadius, camEndRadius, eased);
            camera.position.copy(_camLerpDir).multiplyScalar(r);
            controls.target.lerpVectors(camStartTarget, DEFAULT_CAM_TARGET, eased);

            if (rawT >= 1) {
              camera.position.copy(desiredCamPos);
              controls.target.copy(DEFAULT_CAM_TARGET);
              cameraAnimating = false;
            } else {
              needsMore = true;
            }
          }

          const controlsChanged = controls.update();
          if (controlsChanged) needsMore = true;

          renderer.render(scene, camera);

          const done = () => {
            renderBusy = false;
            if (disposed) return;
            if (renderDirty || needsMore) {
              requestRender();
            }
          };

          if (isSoftwareGl) {
            afterDraw(done);
          } else {
            done();
          }
        });
      }

      const handleControlsStart = () => {
        cameraAnimating = false;
      };
      const handleControlsChange = () => {
        requestRender();
      };
      controls.addEventListener('start', handleControlsStart);
      controls.addEventListener('change', handleControlsChange);

      const handleResize = () => {
        if (!container || disposed) return;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        requestRender();
      };
      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);

      const handleContextLost = (e: Event) => {
        e.preventDefault();
        setWebglError('3D qrafika konteksti müvəqqəti dayandı.');
      };
      const handleContextRestored = () => {
        setWebglError(null);
        requestRender();
      };
      canvas.addEventListener('webglcontextlost', handleContextLost);
      canvas.addEventListener('webglcontextrestored', handleContextRestored);

      apiRef.current = {
        enqueueTurn: (turn) => {
          turnQueue.push(turn);
          if (!activeTurn) startNextTurn();
          lastTime = performance.now();
          requestRender();
        },
        clearQueue: () => {
          turnQueue.length = 0;
          if (activeTurn) {
            for (const cg of activeTurn.sliceCubies) {
              cubeRoot.attach(cg);
            }
            pivotGroup.rotation.set(0, 0, 0);
            activeTurn = null;
          }
          updateBusyState();
          requestRender();
        },
        setFaceletsImmediate: (facelets) => {
          turnQueue.length = 0;
          if (activeTurn) {
            for (const cg of activeTurn.sliceCubies) {
              cubeRoot.attach(cg);
            }
            pivotGroup.rotation.set(0, 0, 0);
            activeTurn = null;
          }
          for (const c of cubies) {
            c.group.position.set(
              c.homeX * CUBIE_SPACING,
              c.homeY * CUBIE_SPACING,
              c.homeZ * CUBIE_SPACING
            );
            c.group.quaternion.identity();
          }
          for (const mesh of stickerMeshes) {
            const idx = mesh.userData.stickerIndex as number;
            const colorId = facelets[idx];
            const mat = mesh.material as THREE.MeshPhysicalMaterial;
            if (colorId) {
              mat.color.setHex(COLOR_META[colorId].threeHex);
              mat.roughness = 0.16;
              mat.clearcoat = 0.9;
            } else {
              mat.color.setHex(GRAY_STICKER_HEX);
              mat.roughness = 0.45;
              mat.clearcoat = 0.15;
            }
          }
          updateBusyState();
          requestRender();
        },
        focusFace: (face) => {
          desiredCamPos.copy(FACE_CAM_POS[face]);
          camStartRadius = Math.max(0.1, camera.position.length());
          camEndRadius = desiredCamPos.length();
          camStartDir.copy(camera.position).normalize();
          camEndDir.copy(desiredCamPos).normalize();
          camStartTarget.copy(controls.target);
          camAnimElapsed = 0;
          cameraAnimating = true;
          lastTime = performance.now();
          requestRender();
        },
        focusSolveView: () => {
          desiredCamPos.copy(SOLVE_CAM_POS);
          camStartRadius = Math.max(0.1, camera.position.length());
          camEndRadius = desiredCamPos.length();
          camStartDir.copy(camera.position).normalize();
          camEndDir.copy(desiredCamPos).normalize();
          camStartTarget.copy(controls.target);
          camAnimElapsed = 0;
          cameraAnimating = true;
          lastTime = performance.now();
          requestRender();
        },
        resetCamera: () => {
          desiredCamPos.copy(SOLVE_CAM_POS);
          camStartRadius = Math.max(0.1, camera.position.length());
          camEndRadius = desiredCamPos.length();
          camStartDir.copy(camera.position).normalize();
          camEndDir.copy(desiredCamPos).normalize();
          camStartTarget.copy(controls.target);
          camAnimElapsed = 0;
          cameraAnimating = true;
          lastTime = performance.now();
          requestRender();
        },
      };

      // Initial render
      requestRender();

      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        resizeObserver.disconnect();
        controls.removeEventListener('start', handleControlsStart);
        controls.removeEventListener('change', handleControlsChange);
        canvas.removeEventListener('webglcontextlost', handleContextLost);
        canvas.removeEventListener('webglcontextrestored', handleContextRestored);
        controls.dispose();
        bodyGeo.dispose();
        stickerGeo.dispose();
        coreSphereGeo.dispose();
        axleGeo.dispose();
        shadowGeo.dispose();
        ringGeo.dispose();
        outerRingGeo.dispose();
        shadowTex.dispose();
        envTexture.dispose();
        for (const m of disposableMaterials) m.dispose();
        renderer.dispose();
        if (canvas.parentElement === container) {
          container.removeChild(canvas);
        }
        apiRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <div className="relative w-full h-full overflow-hidden bg-[#121212]">
        <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
        {webglError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#121212]/95 p-6 text-center">
            <div className="max-w-md rounded-2xl border border-emerald-500/25 bg-[#1B1D1C] p-6">
              <p className="text-base font-semibold text-slate-100">{webglError}</p>
              <p className="mt-2 text-sm text-slate-400">
                Səhifəni yeniləyin və ya brauzerinizdə WebGL dəstəyinin aktiv olduğunu yoxlayın.
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }
);
