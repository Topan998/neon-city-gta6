// Geometry helpers. Every character and vehicle is a handful of boxes, cylinders and spheres merged
// into one buffer with its colours baked in, so a car is one draw call and a whole crowd is one.
//
// `THREE` is the global the classic <script src="./vendor/three.min.js"> above puts on the page;
// the modules below it read it directly, which keeps the import graph to the game's own files.

/**
 * Merge parts into one non-indexed geometry.
 * part: { geo, matrix?: THREE.Matrix4, color: number, scale?: [x,y,z] }
 * The colours land in a `color` attribute; the material must set vertexColors.
 */
export function mergeParts(parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  const tmp = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  for (const part of parts) {
    let geo = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    if (part.scale) geo.scale(part.scale[0], part.scale[1], part.scale[2]);
    if (part.matrix) geo.applyMatrix4(part.matrix);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const color = new THREE.Color(part.color);
    for (let i = 0; i < pos.count; i += 1) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    geo.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

/** A box part at a position, optionally turned about Y. */
export function box(w, h, d, x, y, z, color, yaw = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const matrix = new THREE.Matrix4();
  if (yaw) matrix.makeRotationY(yaw);
  matrix.setPosition(x, y, z);
  return { geo, matrix, color };
}

/** A cylinder part (wheels, poles, tree trunks). */
export function cylinder(radiusTop, radiusBottom, height, segments, x, y, z, color, rotZ = 0, rotX = 0) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  if (rotZ) quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotZ));
  if (rotX) quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotX));
  matrix.makeRotationFromQuaternion(quat);
  matrix.setPosition(x, y, z);
  return { geo, matrix, color };
}

/** A sphere part (heads, lights). */
export function ball(radius, x, y, z, color, segments = 8) {
  const geo = new THREE.SphereGeometry(radius, segments, Math.max(4, segments - 2));
  const matrix = new THREE.Matrix4().setPosition(x, y, z);
  return { geo, matrix, color };
}

/** The material every merged model shares: unlit-ish lambert with baked vertex colours. */
export function makeModelMaterial(options = {}) {
  return new THREE.MeshLambertMaterial({ vertexColors: true, ...options });
}
