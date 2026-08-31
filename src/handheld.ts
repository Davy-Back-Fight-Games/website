import * as THREE from 'three';
import { createDirectionalDPad, type DPadDirection } from './dpad';
import { SCREEN_BACKING_HEIGHT, SCREEN_BACKING_WIDTH } from './screen';
import { addShellDetails } from './shellDetails';

export type HandheldControl =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'a'
  | 'b'
  | 'start'
  | 'select';

export interface HandheldSceneOptions {
  canvas: HTMLCanvasElement;
  onControl?: (control: HandheldControl) => void;
  onContextLost?: () => void;
}

export interface HandheldScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  screenCanvas: HTMLCanvasElement;
  screenContext: CanvasRenderingContext2D;
  updateScreen: () => void;
  flashControl: (control: HandheldControl) => void;
  resize: () => void;
  destroy: () => void;
}

interface ControlPart {
  visual: THREE.Object3D;
  hitArea: THREE.Object3D;
  restZ: number;
  releaseTimer?: number;
}

const shellColor = 0xf0c857;
const inkColor = 0x152238;
const actionColor = 0xf15b64;

function roundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();

  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function roundedSlab(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: THREE.Material,
  bevel = 0.08,
): THREE.Mesh {
  const geometry = new THREE.ExtrudeGeometry(roundedRectShape(width, height, radius), {
    depth,
    bevelEnabled: bevel > 0,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function makeLabel(text: string, color: string, width = 512, height = 96): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create label canvas context');

  context.clearRect(0, 0, width, height);
  context.fillStyle = color;
  context.font = `800 ${Math.floor(height * 0.45)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.letterSpacing = '6px';
  context.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.6), material);
}

function makePlasticGrainTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create plastic grain canvas');
  const image = context.createImageData(canvas.width, canvas.height);
  let seed = 0x5d1f0a3;

  for (let index = 0; index < image.data.length; index += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const value = 116 + (seed % 48);
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }

  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(18, 28);
  return texture;
}

function drawInitialScreen(context: CanvasRenderingContext2D): void {
  const { width, height } = context.canvas;
  const scale = height / 144;
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#d8f3c2';
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#19344a';
  context.fillRect(18, 18, width - 36, 8);
  context.fillRect(18, height - 26, width - 36, 8);

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `bold ${24 * scale}px monospace`;
  context.fillText('DAVY BACK', width / 2, height / 2 - 24 * scale);
  context.fillStyle = '#ef5a64';
  context.font = `bold ${18 * scale}px monospace`;
  context.fillText('FIGHT GAMES', width / 2, height / 2 + 12 * scale);
  context.fillStyle = '#19344a';
  context.font = `bold ${10 * scale}px monospace`;
  context.fillText('PRESS A', width / 2, height / 2 + 58 * scale);
}

function isDPadDirection(control: HandheldControl): control is DPadDirection {
  return control === 'up' || control === 'down' || control === 'left' || control === 'right';
}

export function createHandheld(options: HandheldSceneOptions): HandheldScene {
  const { canvas, onControl, onContextLost } = options;
  const previousTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'none';
  const ecosiaAndroid = /Ecosia android@/i.test(navigator.userAgent);
  const compactViewport = window.matchMedia('(max-width: 700px)').matches || ecosiaAndroid;

  const handleContextLost = (event: Event): void => {
    event.preventDefault();
    onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', handleContextLost);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4efdf);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0.2, 16.4);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !ecosiaAndroid,
    alpha: false,
    powerPreference: ecosiaAndroid ? 'default' : 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !ecosiaAndroid;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const hemisphere = new THREE.HemisphereLight(0xfffae8, 0x64557c, 2.2);
  scene.add(hemisphere);

  const keyLight = new THREE.DirectionalLight(0xffffff, 4.2);
  keyLight.position.set(-5, 8, 10);
  keyLight.castShadow = !ecosiaAndroid;
  const shadowMapSize = compactViewport ? 512 : 1024;
  keyLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  keyLight.shadow.camera.left = -7;
  keyLight.shadow.camera.right = 7;
  keyLight.shadow.camera.top = 8;
  keyLight.shadow.camera.bottom = -8;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xff7d8d, 1.2);
  rimLight.position.set(7, -2, 5);
  scene.add(rimLight);

  const backdropMaterial = new THREE.ShadowMaterial({ color: 0x6d624e, opacity: 0.15 });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), backdropMaterial);
  backdrop.position.z = -2.1;
  backdrop.receiveShadow = !ecosiaAndroid;
  scene.add(backdrop);

  const pivot = new THREE.Group();
  pivot.rotation.x = -0.035;
  scene.add(pivot);

  const device = new THREE.Group();
  device.rotation.z = -0.018;
  pivot.add(device);

  const plasticGrain = makePlasticGrainTexture();
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: shellColor,
    roughness: 0.54,
    metalness: 0.02,
    bumpMap: plasticGrain,
    bumpScale: 0.012,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: inkColor,
    roughness: 0.48,
    metalness: 0.03,
  });
  const actionMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc43f79,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.38,
    clearcoatRoughness: 0.34,
  });
  const actionSideMaterial = new THREE.MeshStandardMaterial({
    color: 0x762345,
    roughness: 0.74,
    metalness: 0,
  });
  const body = roundedSlab(5.55, 9.15, 1.05, 0.52, shellMaterial, 0.13);
  body.castShadow = true;
  body.receiveShadow = true;
  device.add(body);

  // A raised top lip gives the silhouette its own identity rather than copying an existing shell.
  const topLip = roundedSlab(4.72, 0.34, 1.12, 0.16, shellMaterial, 0.05);
  topLip.position.set(0, 4.52, -0.02);
  topLip.castShadow = true;
  device.add(topLip);

  const bezel = roundedSlab(4.62, 3.76, 0.19, 0.28, darkMaterial, 0.04);
  bezel.position.set(0, 1.95, 0.64);
  bezel.castShadow = true;
  device.add(bezel);

  const screenCanvas = document.createElement('canvas');
  // Keep this allocation identical to the logical UI canvas. Changing a
  // CanvasTexture's dimensions after its first GPU upload can leave the old
  // pixels visible around a smaller update.
  screenCanvas.width = SCREEN_BACKING_WIDTH;
  screenCanvas.height = SCREEN_BACKING_HEIGHT;
  const screenContext = screenCanvas.getContext('2d');
  if (!screenContext) throw new Error('Could not create screen canvas context');
  drawInitialScreen(screenContext);

  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  screenTexture.magFilter = THREE.LinearFilter;
  screenTexture.minFilter = THREE.LinearFilter;
  screenTexture.generateMipmaps = false;
  screenTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const screenMaterial = new THREE.MeshBasicMaterial({
    map: screenTexture,
    toneMapped: false,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.62, 3.25), screenMaterial);
  screen.position.set(0, 1.94, 0.79);
  device.add(screen);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(3.58, 3.2),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.075,
      roughness: 0.05,
      transmission: 0.1,
      depthWrite: false,
    }),
  );
  glass.position.set(0, 1.94, 0.805);
  device.add(glass);

  const brand = makeLabel('DAVY BACK', '#152238');
  brand.position.set(0, -0.18, 0.68);
  device.add(brand);

  const controlParts = new Map<HandheldControl, ControlPart>();
  const raycastTargets: THREE.Object3D[] = [];
  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

  const registerControl = (
    control: HandheldControl,
    visual: THREE.Object3D,
    hitArea: THREE.Object3D,
  ): void => {
    hitArea.userData.control = control;
    controlParts.set(control, { visual, hitArea, restZ: visual.position.z });
    raycastTargets.push(hitArea);
    if (visual.parent !== device) device.add(visual);
    device.add(hitArea);
  };

  const dpad = createDirectionalDPad({ material: darkMaterial });
  dpad.group.position.set(-1.42, -2.04, 0.67);
  device.add(dpad.group);
  raycastTargets.push(...dpad.hitAreas);

  const addActionButton = (control: 'a' | 'b', x: number, y: number): void => {
    const buttonGroup = new THREE.Group();
    buttonGroup.position.set(x, y, 0.73);

    const button = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.47, 0.2, 48, 2),
      [actionSideMaterial, actionMaterial, actionSideMaterial],
    );
    button.rotation.x = Math.PI / 2;
    button.castShadow = false;
    buttonGroup.add(button);

    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.55, 24), hitMaterial);
    hit.rotation.x = Math.PI / 2;
    hit.position.set(x, y, 0.81);
    registerControl(control, buttonGroup, hit);
  };
  addActionButton('b', 1.05, -2.34);
  addActionButton('a', 2.08, -1.58);

  const addPill = (control: 'start' | 'select', x: number): void => {
    const pill = roundedSlab(0.82, 0.24, 0.13, 0.12, darkMaterial, 0.025);
    pill.rotation.z = -0.18;
    pill.position.set(x, -3.37, 0.64);
    pill.castShadow = true;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.48, 0.5), hitMaterial);
    hit.rotation.z = -0.18;
    hit.position.set(x, -3.37, 0.77);
    registerControl(control, pill, hit);
  };
  addPill('select', -0.52);
  addPill('start', 0.55);

  addShellDetails({
    device,
    shellMaterial,
    darkMaterial,
    actionMaterial,
    inkColor,
    shellColor,
    actionColor,
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tiltTarget = new THREE.Vector2();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let hoveredControl: HandheldControl | undefined;
  let activeControl: HandheldControl | undefined;
  let animationFrame = 0;
  let destroyed = false;

  const controlAtEvent = (event: PointerEvent): HandheldControl | undefined => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(raycastTargets, false)[0];
    return hit?.object.userData.control as HandheldControl | undefined;
  };

  const setPressed = (control: HandheldControl, pressed: boolean): void => {
    if (isDPadDirection(control)) {
      dpad.setPressed(control, pressed);
      return;
    }
    const part = controlParts.get(control);
    if (!part) return;
    part.visual.position.z = part.restZ + (pressed ? -0.11 : 0);
  };

  const flashControl = (control: HandheldControl): void => {
    if (isDPadDirection(control)) {
      dpad.flash(control);
      return;
    }
    const part = controlParts.get(control);
    if (!part) return;
    if (part.releaseTimer) window.clearTimeout(part.releaseTimer);
    setPressed(control, true);
    part.releaseTimer = window.setTimeout(() => {
      setPressed(control, false);
      part.releaseTimer = undefined;
    }, 110);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width && rect.height && !reducedMotion.matches) {
      const localX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const localY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      tiltTarget.set(THREE.MathUtils.clamp(localY * 0.055, -0.055, 0.055), THREE.MathUtils.clamp(localX * 0.085, -0.085, 0.085));
    }
    hoveredControl = controlAtEvent(event);
    canvas.style.cursor = hoveredControl ? 'pointer' : 'default';
  };

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    const control = controlAtEvent(event);
    if (!control) return;
    activeControl = control;
    setPressed(control, true);
    canvas.setPointerCapture?.(event.pointerId);
    onControl?.(control);
  };

  const releasePointer = (event: PointerEvent): void => {
    if (activeControl) setPressed(activeControl, false);
    activeControl = undefined;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  const onPointerLeave = (): void => {
    tiltTarget.set(0, 0);
    hoveredControl = undefined;
    canvas.style.cursor = 'default';
  };

  const preventCanvasDefault = (event: Event): void => event.preventDefault();

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('contextmenu', preventCanvasDefault);
  canvas.addEventListener('dragstart', preventCanvasDefault);
  canvas.addEventListener('selectstart', preventCanvasDefault);

  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || window.innerWidth));
    const height = Math.max(1, Math.round(bounds.height || window.innerHeight));
    const pixelRatioCap = ecosiaAndroid ? 1 : compactViewport ? 1.5 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Contain the complete device on both axes instead of using a fixed
    // mobile distance. These padded bounds include bevels and button shadows.
    const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const fitHeight = (10.4 / 2) / Math.tan(halfVerticalFov);
    const fitWidth = (6.6 / 2) / (Math.tan(halfVerticalFov) * camera.aspect);
    camera.position.z = Math.max(fitHeight, fitWidth);
    camera.updateProjectionMatrix();
  };

  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? undefined
    : new ResizeObserver(resize);
  resizeObserver?.observe(canvas);
  window.addEventListener('resize', resize, { passive: true });
  window.visualViewport?.addEventListener('resize', resize, { passive: true });
  resize();
  window.requestAnimationFrame(resize);

  let lastFrameTime = performance.now();
  const animate = (frameTime = performance.now()): void => {
    if (destroyed) return;
    dpad.update(Math.min(Math.max((frameTime - lastFrameTime) / 1000, 0), 0.1));
    lastFrameTime = frameTime;
    pivot.rotation.x += (-0.035 + tiltTarget.x - pivot.rotation.x) * 0.075;
    pivot.rotation.y += (tiltTarget.y - pivot.rotation.y) * 0.075;
    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(animate);
  };
  animate();

  const updateScreen = (): void => {
    screenTexture.needsUpdate = true;
  };

  const destroy = (): void => {
    destroyed = true;
    window.cancelAnimationFrame(animationFrame);
    resizeObserver?.disconnect();
    window.removeEventListener('resize', resize);
    window.visualViewport?.removeEventListener('resize', resize);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', releasePointer);
    canvas.removeEventListener('pointercancel', releasePointer);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('contextmenu', preventCanvasDefault);
    canvas.removeEventListener('dragstart', preventCanvasDefault);
    canvas.removeEventListener('selectstart', preventCanvasDefault);
    canvas.removeEventListener('webglcontextlost', handleContextLost);
    canvas.style.touchAction = previousTouchAction;
    canvas.style.cursor = '';

    for (const part of controlParts.values()) {
      if (part.releaseTimer) window.clearTimeout(part.releaseTimer);
    }
    dpad.destroy();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    });
    renderer.dispose();
  };

  return {
    scene,
    camera,
    renderer,
    screenCanvas,
    screenContext,
    updateScreen,
    flashControl,
    resize,
    destroy,
  };
}
