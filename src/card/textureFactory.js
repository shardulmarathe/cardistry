import * as THREE from 'three'
import { SUIT_SYMBOL, RED_SUITS, COLORS } from '../lib/constants'

const CELL_W = 384
const CELL_H = 536

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawFace(ctx, card) {
  const isRed = RED_SUITS.has(card.suit)
  const ink = isRed ? COLORS.red : COLORS.black
  const symbol = SUIT_SYMBOL[card.suit]
  const pad = 26

  // Ivory body fills the full canvas — geometry is already rounded, so no
  // transparent fringe (the original CSS used background-color under the photo).
  ctx.fillStyle = '#f5f1e8'
  ctx.fillRect(0, 0, CELL_W, CELL_H)

  const grad = ctx.createLinearGradient(0, 0, CELL_W * 0.4, CELL_H)
  grad.addColorStop(0, '#fdfcfa')
  grad.addColorStop(0.5, '#f5f1e8')
  grad.addColorStop(1, '#ece6d8')
  ctx.fillStyle = grad
  roundRect(ctx, 4, 4, CELL_W - 8, CELL_H - 8, 34)
  ctx.fill()
  // No dark border stroke here: at fan/spread density each card's exposed
  // sliver is thin, so a baked hairline reads as a heavy black outline once
  // GPU-mipmapped/anisotropically minified. The rounded mesh silhouette and
  // scene lighting already define the card edge — a drawn stroke is redundant
  // and looked like a bug ("black outline/corners" on every card).

  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 82px Georgia, "Times New Roman", serif'
  ctx.fillText(card.rank, pad + 34, pad + 54)
  ctx.font = '700 64px Georgia, serif'
  ctx.fillText(symbol, pad + 34, pad + 124)
  ctx.font = '600 240px Georgia, serif'
  ctx.globalAlpha = 0.9
  ctx.fillText(symbol, CELL_W / 2, CELL_H / 2 + 8)
  ctx.globalAlpha = 1

  ctx.save()
  ctx.translate(CELL_W - pad - 34, CELL_H - pad - 54)
  ctx.rotate(Math.PI)
  ctx.font = '700 82px Georgia, serif'
  ctx.fillText(card.rank, 0, -70)
  ctx.font = '700 64px Georgia, serif'
  ctx.fillText(symbol, 0, 0)
  ctx.restore()
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
