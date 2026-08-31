import * as THREE from 'three';

/**
 * Materials are supplied by the handheld so the detail pass stays in the same
 * art direction. The helper only creates original geometry and canvas labels;
 * it does not depend on a model, texture, font file, or branded asset.
 */
export interface ShellDetailOptions {
  device: THREE.Group;
  shellMaterial: THREE.Material;
  darkMaterial: THREE.Material;
  actionMaterial: THREE.Material;
  inkColor?: THREE.ColorRepresentation;
  shellColor?: THREE.ColorRepresentation;
  actionColor?: THREE.ColorRepresentation;
}

function roundedRectShape(width: number, height: number, radius: number): THREE.Shape {
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

function roundedSlab(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: THREE.Material,
  bevel = 0.018,
): THREE.Mesh {
  const geometry = new THREE.ExtrudeGeometry(roundedRectShape(width, height, radius), {
    depth,
    bevelEnabled: bevel > 0,
    bevelSegments: 2,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function makePrintedLabel(
  text: string,
  color: THREE.ColorRepresentation,
  worldWidth: number,
  worldHeight: number,
  fontSize = 50,
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(1024, Math.max(160, text.length * 72));
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create shell label canvas');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = new THREE.Color(color).getStyle();
  let resolvedFontSize = Math.max(92, fontSize);
  context.font = `800 ${resolvedFontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const measuredWidth = context.measureText(text).width;
  if (measuredWidth > canvas.width * 0.9) {
    resolvedFontSize *= (canvas.width * 0.9) / measuredWidth;
    context.font = `800 ${resolvedFontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  }
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight), material);
  label.renderOrder = 3;
  return label;
}

/** Adds a lightweight, original construction-detail pass to the front shell. */
export function addShellDetails(options: ShellDetailOptions): THREE.Group {
  const {
    device,
    shellMaterial,
    darkMaterial,
    actionMaterial,
    inkColor = 0x152238,
    shellColor = 0xf0c857,
    actionColor = 0xf15b64,
  } = options;

  const details = new THREE.Group();
  details.name = 'davy-back-shell-details';
  device.add(details);

  const recessMaterial = new THREE.MeshStandardMaterial({
    color: inkColor,
    transparent: true,
    opacity: 0.13,
    roughness: 0.9,
    metalness: 0,
    depthWrite: false,
  });
  const highlightMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(shellColor).lerp(new THREE.Color(0xffffff), 0.58),
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    toneMapped: false,
  });
  const wellMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shellColor).multiplyScalar(0.91),
    roughness: 0.76,
    metalness: 0,
  });
  const actionWellShadowMaterial = new THREE.MeshBasicMaterial({
    color: inkColor,
    transparent: true,
    opacity: 0.09,
    depthWrite: false,
    toneMapped: false,
  });
  const actionWellInnerMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(shellColor).lerp(new THREE.Color(0xe8e5df), 0.36),
    roughness: 0.62,
    metalness: 0,
  });

  // Custom top "signal rail": a shallow track, thumb slider, and three grip ridges.
  const rail = roundedSlab(1.04, 0.17, 0.035, 0.07, recessMaterial, 0.01);
  rail.position.set(-1.15, 4.50, 0.585);
  details.add(rail);

  const slider = roundedSlab(0.39, 0.20, 0.09, 0.075, darkMaterial, 0.02);
  slider.position.set(-1.38, 4.50, 0.625);
  slider.castShadow = true;
  details.add(slider);

  for (let index = 0; index < 3; index += 1) {
    const ridge = roundedSlab(0.06, 0.18, 0.045, 0.025, darkMaterial, 0.008);
    ridge.position.set(-0.88 + index * 0.14, 4.50, 0.61);
    details.add(ridge);
  }

  const railLabel = makePrintedLabel('SIGNAL', inkColor, 0.65, 0.14, 38);
  railLabel.position.set(-0.18, 4.50, 0.61);
  details.add(railLabel);

  // Four small face screws make the procedural body read as an assembled object.
  const screwPositions: ReadonlyArray<readonly [number, number]> = [
    [-2.30, 4.05],
    [2.30, 4.05],
    [-2.30, -4.06],
    [2.30, -4.06],
  ];
  for (const [x, y] of screwPositions) {
    const screw = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 0.035, 12),
      darkMaterial,
    );
    screw.rotation.x = Math.PI / 2;
    screw.position.set(x, y, 0.686);
    details.add(screw);

    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.012, 0.014), highlightMaterial);
    groove.position.set(x, y, 0.713);
    groove.rotation.z = x * y > 0 ? 0.55 : -0.55;
    details.add(groove);
  }

  // The screen gets its own Davy Back instrumentation rather than copied trim.
  const bezelStripe = roundedSlab(0.66, 0.035, 0.018, 0.015, actionMaterial, 0.005);
  bezelStripe.position.set(-1.72, 3.66, 0.805);
  details.add(bezelStripe);

  const bezelLabel = makePrintedLabel('DBFG // SIGNAL DECK', actionColor, 1.45, 0.14, 30);
  bezelLabel.position.set(-0.54, 3.66, 0.812);
  details.add(bezelLabel);

  const ledSocket = new THREE.Mesh(new THREE.RingGeometry(0.065, 0.095, 16), recessMaterial);
  ledSocket.position.set(2.06, 3.65, 0.808);
  details.add(ledSocket);

  const led = new THREE.Mesh(
    new THREE.CircleGeometry(0.05, 16),
    new THREE.MeshBasicMaterial({ color: 0x91e86d, toneMapped: false }),
  );
  led.position.set(2.06, 3.65, 0.816);
  details.add(led);

  // Shallow molded wells seat the controls in the shell rather than leaving
  // them floating on a completely flat face.
  const dpadWell = new THREE.Mesh(
    new THREE.CylinderGeometry(1.08, 1.08, 0.025, 48),
    wellMaterial,
  );
  dpadWell.rotation.x = Math.PI / 2;
  dpadWell.position.set(-1.42, -2.04, 0.666);
  details.add(dpadWell);

  const actionWellShadow = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRectShape(2.55, 1.20, 0.57), 32),
    actionWellShadowMaterial,
  );
  actionWellShadow.rotation.z = 0.636;
  actionWellShadow.position.set(1.565, -1.99, 0.67);
  details.add(actionWellShadow);

  const actionWellInner = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRectShape(2.47, 1.12, 0.53), 32),
    actionWellInnerMaterial,
  );
  actionWellInner.rotation.z = 0.636;
  actionWellInner.position.set(1.55, -1.965, 0.674);
  details.add(actionWellInner);

  // Each speaker cut has a beveled lip and darker inner groove. This gives
  // the grille real construction depth without a large floating backplate.
  const speakerMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(inkColor).multiplyScalar(0.54),
    roughness: 0.94,
    metalness: 0,
  });
  for (let index = 0; index < 5; index += 1) {
    const x = 1.30 + index * 0.27;
    const y = -3.50 + index * 0.06;
    const lip = roundedSlab(0.17, 0.64, 0.022, 0.075, highlightMaterial, 0.012);
    lip.rotation.z = -0.42;
    lip.position.set(x, y, 0.672);
    details.add(lip);

    const groove = roundedSlab(0.105, 0.54, 0.026, 0.05, speakerMaterial, 0.012);
    groove.rotation.z = -0.42;
    groove.position.set(x + 0.018, y - 0.004, 0.681);
    details.add(groove);
  }

  // Printed legends are deliberately tiny: discoverable detail, not competing UI.
  const legends: ReadonlyArray<readonly [string, number, number, number, number]> = [
    ['B', 1.05, -2.88, 0.18, 0.14],
    ['A', 2.08, -2.12, 0.18, 0.14],
    ['SELECT', -0.52, -3.08, 0.54, 0.16],
    ['START', 0.55, -3.08, 0.48, 0.16],
  ];
  for (const [text, x, y, width, height] of legends) {
    const label = makePrintedLabel(text, inkColor, width, height, text.length === 1 ? 62 : 38);
    label.position.set(x, y, 0.684);
    details.add(label);
  }

  // Keep supplied materials represented in the helper's contract even when a
  // caller later swaps the shell palette at runtime.
  void shellMaterial;

  return details;
}
