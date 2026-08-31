import * as THREE from 'three';

export type DPadDirection = 'up' | 'down' | 'left' | 'right';

export interface DirectionalDPadOptions {
  /** The button material is borrowed; destroy() deliberately does not dispose it. */
  material: THREE.Material;
  /** Distance from the centre to the outside edge of the cross. */
  radius?: number;
  depth?: number;
  pressAngle?: number;
}

export interface DirectionalDPad {
  /** Position this group as a single control on the handheld shell. */
  group: THREE.Group;
  /** Direct raycast targets. Each carries its DPadDirection in userData.control. */
  hitAreas: readonly THREE.Mesh[];
  setPressed: (direction: DPadDirection, pressed: boolean) => void;
  flash: (direction: DPadDirection, duration?: number) => void;
  /** Call once per render frame. Delta is in seconds. */
  update: (delta?: number) => void;
  destroy: () => void;
}

interface DirectionState {
  pivot: THREE.Group;
  current: number;
  target: number;
  timer?: number;
}

const directions: readonly DPadDirection[] = ['up', 'down', 'left', 'right'];

function roundedRectangle(width: number, height: number, radius: number): THREE.Shape {
  const left = -width / 2;
  const bottom = -height / 2;
  const right = width / 2;
  const top = height / 2;
  const shape = new THREE.Shape();

  shape.moveTo(left + radius, bottom);
  shape.lineTo(right - radius, bottom);
  shape.quadraticCurveTo(right, bottom, right, bottom + radius);
  shape.lineTo(right, top - radius);
  shape.quadraticCurveTo(right, top, right - radius, top);
  shape.lineTo(left + radius, top);
  shape.quadraticCurveTo(left, top, left, top - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  shape.closePath();
  return shape;
}

function extrudeShape(shape: THREE.Shape, depth: number, bevel: number): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel * 0.78,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function makeUpArm(width: number, length: number): THREE.Shape {
  const half = width / 2;
  const shoulder = width * 0.08;
  const radius = width * 0.1;
  const shape = new THREE.Shape();

  // The arm begins at its hinge. Slight shoulders keep the four pieces from
  // reading as four unrelated rectangular buttons.
  shape.moveTo(-half + shoulder, 0);
  shape.lineTo(half - shoulder, 0);
  shape.quadraticCurveTo(half, 0, half, radius);
  shape.lineTo(half, length - radius);
  shape.quadraticCurveTo(half, length, half - radius, length);
  shape.lineTo(-half + radius, length);
  shape.quadraticCurveTo(-half, length, -half, length - radius);
  shape.lineTo(-half, radius);
  shape.quadraticCurveTo(-half, 0, -half + shoulder, 0);
  shape.closePath();
  return shape;
}

function rotationFor(direction: DPadDirection): number {
  switch (direction) {
    case 'up': return 0;
    case 'right': return -Math.PI / 2;
    case 'down': return Math.PI;
    case 'left': return Math.PI / 2;
  }
}

function hingePosition(direction: DPadDirection, distance: number): THREE.Vector2 {
  switch (direction) {
    case 'up': return new THREE.Vector2(0, distance);
    case 'right': return new THREE.Vector2(distance, 0);
    case 'down': return new THREE.Vector2(0, -distance);
    case 'left': return new THREE.Vector2(-distance, 0);
  }
}

/**
 * Builds an original four-piece D-pad. The centre stays planted while each arm
 * hinges independently, so a press feels directional instead of lowering the
 * complete cross.
 */
export function createDirectionalDPad(options: DirectionalDPadOptions): DirectionalDPad {
  const radius = options.radius ?? 0.9;
  const depth = options.depth ?? 0.2;
  const pressAngle = options.pressAngle ?? THREE.MathUtils.degToRad(7.5);
  const armWidth = radius * 0.66;
  const centreSize = armWidth * 0.94;
  const seam = radius * 0.032;
  const hingeDistance = centreSize / 2 + seam;
  const armLength = radius - hingeDistance;

  const group = new THREE.Group();
  group.name = 'directional-dpad';

  const ownedGeometries: THREE.BufferGeometry[] = [];
  const detailMaterial = new THREE.MeshStandardMaterial({
    color: 0x34425b,
    roughness: 0.5,
    metalness: 0.015,
  });
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });

  const centreGeometry = extrudeShape(
    roundedRectangle(centreSize, centreSize, centreSize * 0.13),
    depth,
    radius * 0.045,
  );
  ownedGeometries.push(centreGeometry);
  const centre = new THREE.Mesh(centreGeometry, options.material);
  centre.name = 'dpad-centre';
  centre.castShadow = true;
  centre.receiveShadow = true;
  group.add(centre);

  // A low circular bearing makes the fixed centre feel mechanically related
  // to the four hinged arms, without imitating a particular console moulding.
  const bearingGeometry = new THREE.CylinderGeometry(radius * 0.19, radius * 0.2, depth * 0.14, 28, 1);
  bearingGeometry.rotateX(Math.PI / 2);
  ownedGeometries.push(bearingGeometry);
  const bearing = new THREE.Mesh(bearingGeometry, detailMaterial);
  bearing.name = 'dpad-bearing';
  bearing.position.z = depth / 2 + depth * 0.07;
  bearing.castShadow = true;
  group.add(bearing);

  const baseArmGeometry = extrudeShape(makeUpArm(armWidth, armLength), depth, radius * 0.045);
  ownedGeometries.push(baseArmGeometry);
  const states = new Map<DPadDirection, DirectionState>();
  const hitAreas: THREE.Mesh[] = [];

  for (const direction of directions) {
    const pivot = new THREE.Group();
    pivot.name = `dpad-${direction}-hinge`;
    const hinge = hingePosition(direction, hingeDistance);
    pivot.position.set(hinge.x, hinge.y, 0);

    const arm = new THREE.Mesh(baseArmGeometry, options.material);
    arm.name = `dpad-${direction}`;
    arm.rotation.z = rotationFor(direction);
    arm.castShadow = true;
    arm.receiveShadow = true;
    pivot.add(arm);

    // A tiny raised direction pip gives the otherwise minimal cross enough
    // close-up detail to hold up under high-DPI rendering.
    const pipShape = new THREE.Shape();
    const pipWidth = armWidth * 0.18;
    const pipLength = armWidth * 0.13;
    pipShape.moveTo(0, pipLength);
    pipShape.lineTo(pipWidth, -pipLength);
    pipShape.lineTo(-pipWidth, -pipLength);
    pipShape.closePath();
    const pipGeometry = extrudeShape(pipShape, depth * 0.055, 0.004);
    pipGeometry.translate(0, armLength * 0.61, depth / 2 + depth * 0.035);
    pipGeometry.rotateZ(rotationFor(direction));
    ownedGeometries.push(pipGeometry);
    const pip = new THREE.Mesh(pipGeometry, detailMaterial);
    pip.name = `dpad-${direction}-pip`;
    pivot.add(pip);

    group.add(pivot);
    states.set(direction, { pivot, current: 0, target: 0 });

    const hitGeometry = new THREE.BoxGeometry(armWidth * 1.38, armLength + centreSize * 0.44, depth * 3.2);
    ownedGeometries.push(hitGeometry);
    const hitArea = new THREE.Mesh(hitGeometry, hitMaterial);
    hitArea.name = `dpad-${direction}-hit-area`;
    const hitDistance = hingeDistance + armLength * 0.52;
    const hitPosition = hingePosition(direction, hitDistance);
    hitArea.position.set(hitPosition.x, hitPosition.y, depth * 0.28);
    if (direction === 'left' || direction === 'right') hitArea.rotation.z = Math.PI / 2;
    hitArea.userData.control = direction;
    group.add(hitArea);
    hitAreas.push(hitArea);
  }

  const clearTimer = (state: DirectionState): void => {
    if (state.timer === undefined) return;
    window.clearTimeout(state.timer);
    state.timer = undefined;
  };

  const setPressed = (direction: DPadDirection, pressed: boolean): void => {
    const state = states.get(direction);
    if (!state) return;
    clearTimer(state);
    state.target = pressed ? 1 : 0;
  };

  const flash = (direction: DPadDirection, duration = 115): void => {
    const state = states.get(direction);
    if (!state) return;
    clearTimer(state);
    state.target = 1;
    state.timer = window.setTimeout(() => {
      state.target = 0;
      state.timer = undefined;
    }, duration);
  };

  const update = (delta = 1 / 60): void => {
    const blend = 1 - Math.exp(-Math.min(Math.max(delta, 0), 0.1) * 28);
    for (const [direction, state] of states) {
      state.current = THREE.MathUtils.lerp(state.current, state.target, blend);
      const angle = pressAngle * state.current;
      state.pivot.rotation.x = direction === 'up' ? -angle : direction === 'down' ? angle : 0;
      state.pivot.rotation.y = direction === 'right' ? angle : direction === 'left' ? -angle : 0;
      state.pivot.position.z = -depth * 0.06 * state.current;
    }
  };

  const destroy = (): void => {
    for (const state of states.values()) clearTimer(state);
    for (const geometry of ownedGeometries) geometry.dispose();
    detailMaterial.dispose();
    hitMaterial.dispose();
  };

  return { group, hitAreas, setPressed, flash, update, destroy };
}
