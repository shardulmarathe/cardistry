import * as THREE from 'three'
import { SUIT_SYMBOL, RED_SUITS, COLORS } from '../lib/constants'

const CELL_W = 384
const CELL_H = 536

// Higher-res canvas for the shared back so the deco filigree stays crisp when
// a full stack is viewed near-edge-on.
const BACK_W = 512
const BACK_H = 716

// A display serif that reads "art-deco monogram" on macOS (this project's target
// platform); falls back gracefully everywhere else.
const DECO_FONT = '"Didot", "Bodoni 72", "Playfair Display", Georgia, serif'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

function drawFace(ctx, card) {
  const isRed = RED_SUITS.has(card.suit)
  const ink = isRed ? COLORS.red : COLORS.black
  const symbol = SUIT_SYMBOL[card.suit]
  const pad = 44
  const band = 20 // oxblood + gold edge band width

  // Oxblood edge, the very border matches the deco back (red + gold). Fills
  // the whole canvas so the card's rim reads red-and-gold, with an ivory field
  // inset for the pips.
  const edge = ctx.createLinearGradient(0, 0, CELL_W, CELL_H)
  edge.addColorStop(0, '#6e1020')
  edge.addColorStop(1, '#3a0812')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, CELL_W, CELL_H)

  // Ivory face field, inset to leave the red/gold band around it.
  const grad = ctx.createLinearGradient(0, 0, CELL_W * 0.4, CELL_H)
  grad.addColorStop(0, '#fdfcfa')
  grad.addColorStop(0.5, '#f5f1e8')
  grad.addColorStop(1, '#ece6d8')
  ctx.fillStyle = grad
  roundRect(ctx, band, band, CELL_W - band * 2, CELL_H - band * 2, 22)
  ctx.fill()

  // Gold framing lines: one near the outer edge, one hugging the ivory field.
  ctx.strokeStyle = COLORS.gold
  ctx.lineWidth = 3
  roundRect(ctx, 10, 10, CELL_W - 20, CELL_H - 20, 28)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(240, 198, 122, 0.85)'
  ctx.lineWidth = 1.5
  roundRect(ctx, band + 3, band + 3, CELL_W - (band + 3) * 2, CELL_H - (band + 3) * 2, 18)
  ctx.stroke()

  // Gold corner fans in the band, echoing the back.
  drawCornerFans(ctx, CELL_W, CELL_H, 20, 22, 'rgba(240, 198, 122, 0.9)')

  // Ghosted center suit, a soft tonal backdrop, drawn before the index.
  ctx.save()
  ctx.globalAlpha = isRed ? 0.14 : 0.1
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 300px ${DECO_FONT}`
  ctx.fillText(symbol, CELL_W / 2, CELL_H / 2 + 6)
  ctx.restore()

  // Crisp center glyph on top.
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.globalAlpha = 0.95
  ctx.font = `600 190px ${DECO_FONT}`
  ctx.fillText(symbol, CELL_W / 2, CELL_H / 2 + 6)
  ctx.globalAlpha = 1

  // Index block, rank over suit, both corners (top-left + rotated bottom-right).
  drawIndex(ctx, card.rank, symbol, ink, pad)
  ctx.save()
  ctx.translate(CELL_W - pad, CELL_H - pad)
  ctx.rotate(Math.PI)
  drawIndex(ctx, card.rank, symbol, ink, 0)
  ctx.restore()
}

function drawIndex(ctx, rank, symbol, ink, pad) {
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const cx = pad + 30
  ctx.font = `700 84px ${DECO_FONT}`
  ctx.fillText(rank, cx, pad + 52)
  ctx.font = `700 62px ${DECO_FONT}`
  ctx.fillText(symbol, cx, pad + 122)
}

export function buildFaceTextures(cards, maxAnisotropy = 8) {
  const map = new Map()
  for (const card of cards) {
    const canvas = document.createElement('canvas')
    canvas.width = CELL_W
    canvas.height = CELL_H
    const ctx = canvas.getContext('2d')
    drawFace(ctx, card)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = maxAnisotropy
    tex.needsUpdate = true
    map.set(card.id, tex)
  }
  return map
}

// ---------------------------------------------------------------------------
// Back, bone-bordered art-deco card back with a gold monogram "S" medallion.
// One shared texture for all 52 cards.
//
// THE DESIGN IS 180°-SYMMETRIC, AND THAT IS A REQUIREMENT RATHER THAN AN
// OBSERVATION. Nothing in this app agrees on which way up a face-down card is:
// the visualizer composes its face-down orientation as faceQuat(true) turned about
// the card's own long axis (so its flip animation reads as laying a card over),
// while every lesson layout uses faceQuat(false) directly - and those two differ by
// exactly 180° about the card's normal. The charlier's flip beat turns the whole
// deck over and depends on the same thing. So any up/down asymmetry in this drawing
// shows up as the back "looking reversed" in one mode and not the other, which is
// precisely what was reported. Keep every gradient symmetric about the centre and
// every shadow unoffset; the glyph "S" is already rotationally symmetric.
//
// The bone border is doing the heavy lifting: the felt is oxblood, so a
// full-bleed red back made a face-down 52-card fan read as one undifferentiated
// mass. A light rim (like every real deck has) gives each card a crisp
// silhouette, and edge-on it turns a face-down stack's side wall cream.
// The field is shifted plum-ward off the felt's orange-red so back and table
// separate by hue as well as by value.
// ---------------------------------------------------------------------------

const BACK_BORDER = 30 // bone rim width in back-canvas px (~6% of card width)

function drawBack(ctx, w, h) {
  const cx = w / 2
  const cy = h / 2
  const b = BACK_BORDER
  const fieldR = 24

  // Bone rim, full bleed. Kept a shade under COLORS.bone (#f7f1e6) so the key
  // light lifts it into bone instead of clipping it to flat white. The mesh's
  // rounded corners (cardGeometry RADIUS) clip this canvas, so the rim narrows
  // at the corners exactly like a real rounded card.
  // The sheen runs along the diagonal and is SYMMETRIC ABOUT THE CENTRE - bright
  // through the middle, deeper at both ends. It used to run light at the top-left
  // corner to dark at the bottom-right, which is the ordinary way to light a rim
  // and put ~52/255 of difference into all four corners under a half-turn (the
  // measurement above; once the monogram was fixed this was the entire remainder).
  const rim = ctx.createLinearGradient(0, 0, w, h)
  rim.addColorStop(0, '#ae9b7a')
  rim.addColorStop(0.35, '#cdbd9b')
  rim.addColorStop(0.5, '#ded2b6')
  rim.addColorStop(0.65, '#cdbd9b')
  rim.addColorStop(1, '#ae9b7a')
  ctx.fillStyle = rim
  ctx.fillRect(0, 0, w, h)

  // Plum-shifted field, inset to leave the bone rim.
  // Concentric on the card's own centre, not lifted off it: an inner circle at
  // cy * 0.92 reads as a light source above, which is another up direction.
  const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, h * 0.6)
  bg.addColorStop(0, '#93203e')
  bg.addColorStop(0.5, '#701434')
  bg.addColorStop(1, '#3c0a1d')
  ctx.fillStyle = bg
  roundRect(ctx, b, b, w - b * 2, h - b * 2, fieldR)
  ctx.fill()

  // Everything below is confined to the field so nothing bleeds into the rim.
  ctx.save()
  roundRect(ctx, b, b, w - b * 2, h - b * 2, fieldR)
  ctx.clip()

  // Fine diagonal lattice texture (deco weave).
  ctx.save()
  ctx.strokeStyle = 'rgba(226, 178, 96, 0.14)'
  ctx.lineWidth = 1
  // ONE family of diagonals, then the SAME family half-turned - which produces the
  // opposing diagonal with its phase locked to the first. Drawing the two families
  // independently (moveTo(d,0) and moveTo(d,h)) leaves their phases unrelated for
  // any given w/h/step, so the crossing pattern interfered with its own half-turn:
  // a faint 6/255 band along the top and bottom edges, which was the last thing
  // left once the monogram, the rim and the field were symmetric.
  const step = 18
  for (const rot of [0, Math.PI]) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rot)
    ctx.translate(-cx, -cy)
    for (let d = -h; d < w + h; d += step) {
      ctx.beginPath()
      ctx.moveTo(d, 0)
      ctx.lineTo(d + h, h)
      ctx.stroke()
    }
    ctx.restore()
  }
  ctx.restore()

  // Double border frame with stepped corner notches.
  ctx.strokeStyle = COLORS.gold
  ctx.lineWidth = 4
  roundRect(ctx, b + 12, b + 12, w - (b + 12) * 2, h - (b + 12) * 2, 18)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(240, 198, 122, 0.85)'
  ctx.lineWidth = 2
  roundRect(ctx, b + 24, b + 24, w - (b + 24) * 2, h - (b + 24) * 2, 14)
  ctx.stroke()
  drawCornerFans(ctx, w, h, 66, 34, 'rgba(240, 198, 122, 0.8)')

  // Guilloche sunburst behind the medallion.
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = 'rgba(226, 178, 96, 0.26)'
  ctx.lineWidth = 1
  const rays = 60
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * 60, Math.sin(a) * 60)
    ctx.lineTo(Math.cos(a) * (h * 0.42), Math.sin(a) * (h * 0.42))
    ctx.stroke()
  }
  // Concentric guilloche rings.
  ctx.strokeStyle = 'rgba(226, 178, 96, 0.3)'
  for (let r = 70; r < h * 0.42; r += 26) {
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()

  // Diamond cartouche.
  ctx.save()
  ctx.translate(cx, cy)
  const dw = w * 0.34
  const dh = h * 0.3
  ctx.beginPath()
  ctx.moveTo(0, -dh)
  ctx.lineTo(dw, 0)
  ctx.lineTo(0, dh)
  ctx.lineTo(-dw, 0)
  ctx.closePath()
  const medFill = ctx.createLinearGradient(0, -dh, 0, dh)
  medFill.addColorStop(0, 'rgba(38, 5, 10, 0.85)')
  medFill.addColorStop(0.5, 'rgba(90, 13, 24, 0.7)')
  medFill.addColorStop(1, 'rgba(38, 5, 10, 0.85)')
  ctx.fillStyle = medFill
  ctx.fill()
  ctx.strokeStyle = COLORS.gold
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.strokeStyle = 'rgba(240, 198, 122, 0.55)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, -dh + 12)
  ctx.lineTo(dw - 14, 0)
  ctx.lineTo(0, dh - 12)
  ctx.lineTo(-dw + 14, 0)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()

  // MONOGRAM S, DRAWN AS TWO HALF-TURN-RELATED ARCS rather than set as type.
  //
  // The font's "S" was the whole asymmetry: measured against its own half-turn the
  // finished canvas differed by a mean of 14.3/255 and every one of the six hottest
  // 16x16 blocks sat dead centre, on the glyph, at ~155/255. An "S" LOOKS
  // rotationally symmetric and in any real face is not - the spine's thick/thin
  // axis and the two terminals give it an up.
  //
  // Setting it twice, once turned, does fix the symmetry and reads as "SS", which is
  // not a monogram. But an S is ALREADY two arcs related by a half-turn, so drawing
  // one arc and then the same arc rotated 180 degrees gives a real single S that is
  // symmetric BY CONSTRUCTION. Whatever this curve is tuned to, the letter cannot
  // acquire an up direction, so the deck cannot read upside down in one tab and
  // right in the other (see the note over this function for why the two differ).
  const S_SIZE = h * 0.17
  const strokeHalf = () => {
    ctx.beginPath()
    // From the upper-right terminal, over the top and left, down into the centre.
    ctx.moveTo(0.92 * S_SIZE, -0.72 * S_SIZE)
    ctx.bezierCurveTo(
      0.98 * S_SIZE, -1.5 * S_SIZE,
      -1.05 * S_SIZE, -1.42 * S_SIZE,
      0, 0,
    )
    ctx.stroke()
  }
  ctx.save()
  ctx.translate(cx, cy)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Soft centred shadow, blurred, with no offset in any direction.
  ctx.save()
  ctx.shadowColor = 'rgba(20, 3, 6, 0.85)'
  ctx.shadowBlur = 10
  ctx.strokeStyle = 'rgba(20, 3, 6, 0.9)'
  ctx.lineWidth = 0.42 * S_SIZE
  for (const rot of [0, Math.PI]) {
    ctx.save()
    ctx.rotate(rot)
    strokeHalf()
    ctx.restore()
  }
  ctx.restore()
  // Gold face. The gradient is symmetric about the centre, so the half-turned arc
  // is an exact image of the first rather than the same lighting seen upside down.
  const sGrad = ctx.createLinearGradient(0, -S_SIZE * 1.4, 0, S_SIZE * 1.4)
  sGrad.addColorStop(0, '#b8801f')
  sGrad.addColorStop(0.3, COLORS.goldBright)
  sGrad.addColorStop(0.5, '#ffe0a4')
  sGrad.addColorStop(0.7, COLORS.goldBright)
  sGrad.addColorStop(1, '#b8801f')
  ctx.strokeStyle = sGrad
  ctx.lineWidth = 0.34 * S_SIZE
  for (const rot of [0, Math.PI]) {
    ctx.save()
    ctx.rotate(rot)
    strokeHalf()
    ctx.restore()
  }
  ctx.restore()

  ctx.restore() // end field clip

  // Keyline where bone meets field, so the rim stays crisp under the key light
  // instead of blooming into the plum.
  ctx.strokeStyle = 'rgba(28, 5, 12, 0.9)'
  ctx.lineWidth = 3
  roundRect(ctx, b, b, w - b * 2, h - b * 2, fieldR)
  ctx.stroke()
}

function drawCornerFans(ctx, w, h, inset = 52, size = 34, stroke = 'rgba(240, 198, 122, 0.65)') {
  const corners = [
    [inset, inset, 0],
    [w - inset, inset, Math.PI / 2],
    [w - inset, h - inset, Math.PI],
    [inset, h - inset, -Math.PI / 2],
  ]
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.5
  for (const [x, y, rot] of corners) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(0, 0, size, 0, Math.PI / 2)
    ctx.stroke()
    ctx.restore()
  }
}

export function buildBackTexture(maxAnisotropy = 8) {
  const canvas = document.createElement('canvas')
  canvas.width = BACK_W
  canvas.height = BACK_H
  const ctx = canvas.getContext('2d')
  drawBack(ctx, BACK_W, BACK_H)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = maxAnisotropy
  tex.needsUpdate = true
  return tex
}
