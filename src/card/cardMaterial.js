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

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBend = { value: 0 }

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

// Legacy alias — CardField now builds separate front/back materials.
export function createCardMaterial(frontMap, _backMap, key) {
  return createCardFaceMaterial(frontMap, key)
}
