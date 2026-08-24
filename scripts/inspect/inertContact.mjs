// INERT CONTACT: a MOVING hand is ON a card and the card does not move.
//
// This is the RECIPROCAL of the causality metric in verifyTracks, and the app needed
// both. That one asks "did a card that MOVED have something to move it"; this asks the
// opposite and equally damning question. A lesson can satisfy the first completely and
// still show a palm sweeping straight through a static spread - which is exactly what
// a user reported seeing in the wash, with every existing metric green. Measured when
// this was written: wash 45% of hand-on-card samples had the card inert (worst step
// `smoosh-2`), charlier 22%, overhand 18%, riffle 8%.
//
// Only hands that are THEMSELVES moving are counted: a hand resting on a card that is
// also still is a hand resting on a card, which is correct and common.
//
// Run: node --import ./scripts/verify/register.mjs scripts/inspect/inertContact.mjs
import { compileLesson } from '../../src/lessons/engine/compileLesson.js'
import { sampleTrack } from '../../src/lessons/engine/sampleTrack.js'
import { createDeck } from '../../src/deckModel.js'
import { LESSONS } from '../../src/lessons/catalog/index.js'
import { fingerJointsWorld, wristLocalToWorld } from '../../src/hands/handKinematics.js'
import { FINGERS, FINGER_NAMES, HAND_SCALE, PALM_MM, THENAR_MM, mmToRig } from '../../src/hands/handRigSpec.js'
import { cardSurfaceExtents } from '../../src/lessons/authoring/contacts.js'
import * as THREE from 'three'

const DRIVE = 0.05      // a hand surface this close counts as ON the card
const HAND_MOVING = 0.05 // wu/s: below this the hand itself is not doing anything
const CARD_MOVING = 0.03 // wu/s: below this the card is standing still
const N = 200
const _j=[0,1,2,3].map(()=>new THREE.Vector3()), _p=new THREE.Vector3()
const _cl=new THREE.Vector3(), _cq=new THREE.Quaternion()
const slab=(M)=>{const [sx,sy,sz]=M.size.map(mmToRig),[px,py,pz]=M.pos.map(mmToRig);const o=[]
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)o.push(new THREE.Vector3(px+a*sx/2,py+b*sy/2,pz+sz/2));return o}
const SLABS=[...slab(PALM_MM),...slab(THENAR_MM)]
const gap=(pt,c)=>{_cl.copy(pt).sub(c.pos).applyQuaternion(_cq.set(-c.quat.x,-c.quat.y,-c.quat.z,c.quat.w))
  const e=cardSurfaceExtents(_cl,c.bend??0);const o=Math.hypot(Math.max(e.x,0),Math.max(e.u,0),Math.max(e.n,0))
  return o>0?o:Math.max(e.x,e.u,e.n)}

console.log('lesson      hand-on-card samples   of those: card INERT (hand sliding through it)   worst step')
for (const lesson of LESSONS) {
  const track = compileLesson(lesson, createDeck())
  const dt = track.duration / N / 1000
  let onCard = 0, inert = 0
  const perStep = new Map()
  let prevC = new Map(), prevH = new Map()
  {
    const s = sampleTrack(track, 0)
    for (const [id,c] of s.cards) prevC.set(id,[c.pos.x,c.pos.y,c.pos.z])
    for (const side of ['left','right']) { const h=s.hands[side]; if(h) prevH.set(side,[h.wrist.pos.x,h.wrist.pos.y,h.wrist.pos.z]) }
  }
  for (let i=1;i<=N;i++){
    const ms = track.duration*i/N
    const s = sampleTrack(track, ms)
    const step = track.steps.find(q=>ms>=q.tStart&&ms<=q.tEnd)
    // hand surface points, only for hands that are THEMSELVES moving
    const pts=[]
    for (const side of ['left','right']){
      const pose=s.hands[side]; if(!pose) continue
      const q = prevH.get(side)
      const hv = q ? Math.hypot(pose.wrist.pos.x-q[0],pose.wrist.pos.y-q[1],pose.wrist.pos.z-q[2])/dt : 0
      prevH.set(side,[pose.wrist.pos.x,pose.wrist.pos.y,pose.wrist.pos.z])
      if (hv < HAND_MOVING) continue
      for (const nm of FINGER_NAMES){ fingerJointsWorld(pose,side,nm,_j)
        for(let sg=0;sg<3;sg++){const r=FINGERS[nm].rad[sg]*HAND_SCALE
          for(let k=0;k<=2;k++){_p.copy(_j[sg]).lerp(_j[sg+1],k/2);pts.push([_p.x,_p.y,_p.z,r])}}}
      for (const qq of SLABS){ wristLocalToWorld(pose,side,qq,_p); pts.push([_p.x,_p.y,_p.z,0]) }
    }
    for (const [id,c] of s.cards){
      const q = prevC.get(id)
      const cv = q ? Math.hypot(c.pos.x-q[0],c.pos.y-q[1],c.pos.z-q[2])/dt : 0
      if (q) { q[0]=c.pos.x; q[1]=c.pos.y; q[2]=c.pos.z } else prevC.set(id,[c.pos.x,c.pos.y,c.pos.z])
      if (!pts.length) continue
      let near=Infinity
      for (const pt of pts){ _p.set(pt[0],pt[1],pt[2]); const d=gap(_p,c)-pt[3]
        if (Number.isFinite(d)&&d<near) near=d; if (near<=DRIVE) break }
      if (near>DRIVE) continue
      onCard++
      if (cv < CARD_MOVING) { inert++; const k=step?.id??'?'; perStep.set(k,(perStep.get(k)??0)+1) }
    }
  }
  const w=[...perStep.entries()].sort((a,b)=>b[1]-a[1])[0]
  console.log(lesson.id.padEnd(11), String(onCard).padStart(10), (onCard?((100*inert/onCard).toFixed(0)+'%'):'-').padStart(30), '   '+(w?`${w[0]} (${w[1]})`:'-'))
}
