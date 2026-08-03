import * as THREE from 'three'

// Single-sided card face with bend shader — mirrors the original 2D setup where
// front and back are separate layers (backface-visibility:hidden), not one
// double-sided plane with gl_FrontFacing (that caused corner artifacts in fans).
export function createCardFaceMaterial(map, key) {
  const material = new THREE.MeshStandardMaterial({
    map,
    side: THREE.FrontSide,
    roughness: 0.48,
    metalness: 0,
    envMapIntensity: 0.35,
  })

  // Analysis tint (rgb + strength). Lives on userData so it survives the gap
  // before onBeforeCompile runs and can be written from anywhere; the shader
  // uniform then SHARES this object, so a write is visible either side of
  // compilation without a pending-value dance.
  material.userData.tint = new THREE.Vector4(0, 0, 0, 0)

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBend = { value: 0 }
    shader.uniforms.uTint = { value: material.userData.tint }

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec4 uTint;`,
      )
      // After the map is sampled: keep the card's own luminance (pips, index,
      // back pattern stay legible) and push its HUE to the ramp colour.
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         if (uTint.a > 0.0) {
           float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
           vec3 tinted = uTint.rgb * (0.35 + 0.9 * lum);
           diffuseColor.rgb = mix(diffuseColor.rgb, tinted, uTint.a);
         }`,
      )

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uBend;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         if (abs(uBend) > 0.0001) {
           float angN = position.y * uBend;
           objectNormal = vec3(0.0, -sin(angN), cos(angN));
         }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         if (abs(uBend) > 0.0001) {
           float ang = position.y * uBend;
           transformed.y = sin(ang) / uBend;
           transformed.z += (1.0 - cos(ang)) / uBend;
         }`,
      )

    material.userData.shader = shader
  }

  material.customProgramCacheKey = () => `card-face-${key}`
  return material
}

export function setMaterialBend(material, bend) {
  const shader = material.userData.shader
  if (shader) shader.uniforms.uBend.value = bend
}

// `color` is a THREE.Color already in the renderer's working space, or null to
// clear. Strength stays below 1 so the card still reads as a card.
const TINT_STRENGTH = 0.82
export function setMaterialTint(material, color) {
  const v = material.userData.tint
  if (!v) return
  if (!color) {
    v.w = 0
    return
  }
  v.set(color.r, color.g, color.b, TINT_STRENGTH)
}

// Legacy alias — CardField now builds separate front/back materials.
export function createCardMaterial(frontMap, _backMap, key) {
  return createCardFaceMaterial(frontMap, key)
}
