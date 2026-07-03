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

  // Oxblood edge — the very border matches the deco back (red + gold). Fills
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

  // Ghosted center suit — a soft tonal backdrop, drawn before the index.
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

  // Index block — rank over suit, both corners (top-left + rotated bottom-right).
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
// Back — art-deco oxblood field with a gold monogram "S" medallion.
// One shared texture for all 52 cards. The design is ~180°-symmetric (the
// glyph "S" is itself rotationally symmetric) so it reads correctly whichever
// way a card is turned.
// ---------------------------------------------------------------------------

function drawBack(ctx, w, h) {
  const cx = w / 2
  const cy = h / 2

  // Oxblood field.
  const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, h * 0.62)
  bg.addColorStop(0, '#6e1020')
  bg.addColorStop(0.55, '#5a0d18')
  bg.addColorStop(1, '#26050a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // Fine diagonal lattice texture (deco weave).
  ctx.save()
  ctx.strokeStyle = 'rgba(216, 162, 74, 0.06)'
  ctx.lineWidth = 1
  const step = 22
  for (let d = -h; d < w + h; d += step) {
    ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + h, h); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(d, h); ctx.lineTo(d + h, 0); ctx.stroke()
  }
  ctx.restore()

  // Double border frame with stepped corner notches.
  ctx.strokeStyle = COLORS.gold
  ctx.lineWidth = 4
  roundRect(ctx, 26, 26, w - 52, h - 52, 26)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(240, 198, 122, 0.7)'
  ctx.lineWidth = 2
  roundRect(ctx, 40, 40, w - 80, h - 80, 20)
  ctx.stroke()
  drawCornerFans(ctx, w, h)

  // Guilloche sunburst behind the medallion.
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = 'rgba(216, 162, 74, 0.16)'
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
  ctx.strokeStyle = 'rgba(216, 162, 74, 0.2)'
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

  // Monogram S.
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.round(h * 0.34)}px ${DECO_FONT}`
  // Soft centered drop shadow (blurred, no lateral offset) so the S never reads
  // as a doubled/reversed glyph.
  ctx.save()
  ctx.shadowColor = 'rgba(20, 3, 6, 0.85)'
  ctx.shadowBlur = 10
  ctx.fillStyle = 'rgba(20, 3, 6, 0.9)'
  ctx.fillText('S', cx, cy + 1)
  ctx.restore()
  // Gold gradient face.
  const sGrad = ctx.createLinearGradient(0, cy - h * 0.18, 0, cy + h * 0.18)
  sGrad.addColorStop(0, COLORS.goldBright)
  sGrad.addColorStop(0.5, COLORS.gold)
  sGrad.addColorStop(1, '#a9741f')
  ctx.fillStyle = sGrad
  ctx.fillText('S', cx, cy)
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(240, 198, 122, 0.5)'
  ctx.strokeText('S', cx, cy)
  ctx.restore()
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
