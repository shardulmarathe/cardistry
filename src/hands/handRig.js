import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const HAND_COLOR = 0xe8c4a0
const SEG_LEN = [0.038, 0.032, 0.026]
const SEG_RAD = [0.014, 0.012, 0.01]
const FINGER_OFFSETS = {
  thumb: [-0.05, 0.01, 0.04],
  index: [-0.028, 0.02, -0.06],
  middle: [0, 0.02, -0.065],
  ring: [0.028, 0.02, -0.06],
  pinky: [0.052, 0.015, -0.05],
}
const FINGER_SPREAD = { thumb: -0.35, index: -0.12, middle: 0, ring: 0.12, pinky: 0.28 }

function makeSegmentMaterial() {
  return new THREE.MeshStandardMaterial({
    color: HAND_COLOR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    roughness: 0.55,
    metalness: 0,
    side: THREE.DoubleSide,
  })
}

function addFresnelRim(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.2);
       gl_FragColor.rgb += vec3(0.85, 0.65, 0.35) * fresnel * 0.45;`,
    )
  }
  material.customProgramCacheKey = () => 'hand-fresnel-rim'
}

function buildFinger(parent, name, spread) {
  const group = new THREE.Group()
  group.name = name
  const off = FINGER_OFFSETS[name]
  group.position.set(off[0], off[1], off[2])
  group.rotation.y = FINGER_SPREAD[name] * spread

  const segs = []
  let y = 0
  for (let i = 0; i < 3; i++) {
    const len = SEG_LEN[i]
    const geo = new THREE.CapsuleGeometry(SEG_RAD[i], len, 4, 8)
    const mesh = new THREE.Mesh(geo, makeSegmentMaterial())
    mesh.position.y = y + len / 2
    mesh.castShadow = false
    const joint = new THREE.Group()
    joint.add(mesh)
    if (i === 0) group.add(joint)
    else segs[i - 1].add(joint)
    segs.push(joint)
    y += len
  }
  return { group, joints: segs }
}

// Build a procedural hand rig: wrist -> palm -> 5 fingers x 3 segments.
export function buildHandRig(side = 'right') {
  const root = new THREE.Group()
  root.name = `hand-${side}`

  const wrist = new THREE.Group()
  wrist.name = 'wrist'
  root.add(wrist)

  const palmGeo = new RoundedBoxGeometry(0.11, 0.04, 0.13, 3, 0.012)
  const palmMat = makeSegmentMaterial()
  addFresnelRim(palmMat)
  const palm = new THREE.Mesh(palmGeo, palmMat)
  palm.position.set(0, 0.02, -0.02)
  wrist.add(palm)

  const fingers = {}
  const fingerNames = ['thumb', 'index', 'middle', 'ring', 'pinky']
  for (const name of fingerNames) {
    fingers[name] = buildFinger(wrist, name, 1)
    wrist.add(fingers[name].group)
  }

  if (side === 'left') root.scale.x = -1

  return { root, wrist, fingers, materials: collectMaterials(root) }
}

function collectMaterials(obj) {
  const mats = []
  obj.traverse((c) => {
    if (c.isMesh && c.material) mats.push(c.material)
  })
  return mats
}

export function applyHandPose(rig, pose, side = 'right') {
  const { wrist, fingers, root } = rig
  root.position.copy(pose.wrist.pos)
  wrist.quaternion.copy(pose.wrist.quat)

  for (const name of Object.keys(fingers)) {
    const { group, joints } = fingers[name]
    const angles = pose.fingers[name]
    group.rotation.y = FINGER_SPREAD[name] * pose.spread
    for (let i = 0; i < joints.length; i++) {
      joints[i].rotation.x = angles[i] * (side === 'left' ? -1 : 1)
    }
  }
}
