import { tableRiffleLayout, landscapeStackLayout } from '../engine/layouts'
import {
  tableGrip,
  cageGrip,
  packetGrip,
  rigMetrics,
  thumbRatchetKeyframes,
  resolvePenetration,
} from '../authoring/contacts'
import { gsrRiffleOrder } from '../../lib/shuffleMath'
import { CARD_GAP, CARD_H } from '../../lib/constants'
import { DECK_REST_DROP, DECK_APPROACH_DROP } from '../../hands/handPoses'

// Riffle shuffle, authored as the REAL table riffle: the cards never leave
// the felt. The right hand cuts the top half and sets it beside the other,
// both palms settle on top of their halves, the THUMBS bend the inner-near
// corners up to load the spring, then ratchet open card-by-card so the corners
// weave together low over the table. Square, bridge, cascade to finish.
//
// Hand-driven throughout: packets ride fingertip contact frames while carried,
// every weave card releases from the thumb at its own moment, and the grip
// poses are SOLVED at build time against the real half positions
// (poseWithContacts) so fingertips actually rest on the cards.
export const riffleLesson = {
  id: 'riffle',
  title: 'Riffle Shuffle',
  technique: 'riffle',
  difficulty: 'intermediate',
  randomizes: 'Excellent',
  seed: 7,
  cameraPreset: 'dealerPOV',
  summary:
    'The gold-standard shuffle, done flat on the table: cut, thumbs bend the corners up, and the cards interlace low as the thumbs release — then bridge and cascade square.',
  facts: [
    'About 7 riffle shuffles are enough to randomize a 52-card deck (the Bayer–Diaconis result).',
    'The bend stores elastic spring energy — release it evenly and the cards cascade; crease it and you ruin the card.',
  ],
  build: (deck) => {
    // Half-deck centre x. The halves are LANDSCAPE, so each reaches
    // (CARD_H/2)·cos(YAW) = 0.437 from its own centre along x, and G is what
    // decides whether their inner short ends MEET or sit in mid-air.
    //
    // It was 0.5, which parked the two inner ends 0.12 apart — a fifth of a card
    // width of bare felt between the halves, so the "interlace" happened across a
    // visible gap and read as two separate fans flicking at each other rather
    // than one shuffle. A real table riffle brings the corners into contact
    // BEFORE the thumbs release; the interleave is what happens where they touch.
    // Derived from the card, not typed, so it tracks CARD_H and YAW.
    const YAW = 0.12 // inward angle off 90°: inner short ends point at each other
    const HALF_REACH_X = (CARD_H / 2) * Math.cos(YAW)
    // A hair of overlap, not a gap: the corners of a real riffle interleave, so
    // the halves want to be very slightly inside each other at the junction.
    const G = HALF_REACH_X - 0.012
    const TILT = 0.3 // thumbs lift the INNER end this far while loading

    // --- Card-derived hand heights (the thing this file is really about) ----
    // A phalange capsule is FAT: the thumb's proximal is 0.078 in radius and a
    // card is 0.006 thick, so a finger whose AXIS passes within 0.081 of a
    // card's plane inside its footprint is interpenetrating it, and every hand
    // height in this lesson used to be a hand-picked number with no relation to
    // the cards under it (approach 0.55, cut 0.42, weave 0.32, cascade 0.34).
    // Measured that way, the flagship was 0.08 deep, the metric's ceiling -
    // at every beat. Now: squared-stack top card, half-stack top card, and the
    // measured drop from a wrist to each preset's lowest finger surface.
    const TABLE_TOP = 0.02 + (deck.length - 1) * CARD_GAP
    const HALF = Math.floor(deck.length / 2)
    const HALF_TOP = 0.03 + (HALF - 1) * CARD_GAP
    // How far the two open presets' fingertips reach INWARD from the wrist,
    // measured off the rig. This is the number the whole file used to guess at:
    // a `deckRest` hand reaches 1.62 at HAND_SCALE 13, so an anchor is a PAD
    // position plus that reach, and the old hand-picked 0.9 buried the entire
    // hand a card and a half inside the pile it was meant to be resting on.
    // Derived, so a scale change carries it.
    const REST_REACH = -rigMetrics('deckRest').tip.middle.x
    const APPROACH_REACH = -rigMetrics('deckApproach').tip.middle.x
    // Where a resting hand's pads sit on the squared deck: just past its centre,
    // so the two mirrored hands meet over the pile without their fingers
    // crossing. Card-relative, not hand-relative.
    const REST_PAD_X = 0.18
    // A grip's `pressure` adds up to 0.14 of curl to the gripping fingers at
    // RUNTIME on top of whatever the contact solve settled on, and the idle
    // overlay adds a little more, enough to push a tangent pad ~0.03 back into
    // the cards. The bridge cage below therefore solves against a SHIELD: cards
    // floated this far off the real stack, so clearing them leaves exactly that
    // much air for the squeeze. (`clearance` looks like the knob for this and
    // is the wrong one, `resolvePenetration` stops at the first curl whose
    // depth is <= clearance, so a non-zero value BUYS penetration. Always 0.)
    // The two TABLE grips get their margin from LIFT instead: shielding those
    // straightens tableGrip's fingers, and a straight finger reaches FURTHER
    // across the weave corridor than a curled one (measured: 0.030 → 0.056).
    // Peak `pressure` any of these grips ever sees, the pads are authored
    // that far off their surfaces and the squeeze presses them home.
    const SQUEEZE = 1.2
    const CARRY_SQUEEZE = 1.25
    const SHIELD = 0.03
    // The bend beat squeezes far more gently than it used to. `pressure` and
    // the tremor both add curl AFTER the contact solve, and the halves are
    // welded to the fingertips, so the two of them at their old strengths
    // (1.0 / 0.035) drove the pads 0.03 into the cards they were bending. The
    // step's own `bend:` still supplies the bow.
    const TREMOR = 0.015
    const PRESS = 0.35
    const WEAVE_PRESS = 0.3

    // Dealer table grips (solved at build time against the half geometry) and
    // the bridge cage for the finish, shared builders in authoring/contacts.
    const { pose: restGrip, anchor: REST_ANCHOR } = tableGrip({ gap: G, yaw: YAW, squeeze: SQUEEZE })
    const { pose: loadGrip, anchor: LOAD_ANCHOR } = tableGrip({ gap: G, yaw: YAW, tilt: TILT, squeeze: SQUEEZE })
    // The bridge cage cups the squared LANDSCAPE deck's short ends, so it must
    // be told where that deck's top card actually is (the default 0.3 floated
    // the thumb 0.08 above it). Then back the whole cage off a shielded copy of
    // the stack, cageGrip itself runs no penetration pass.
    const { pose: cage, anchor: CAGE_ANCHOR0 } = cageGrip({ topY: TABLE_TOP, squeeze: 0.9 })
    // The BRIDGE bows the squared deck by BRIDGE_BEND, and a bowed card rests
    // on its ends: `clampAboveFelt` lifts every card until its ends touch the
    // felt, which for this bow collapses the whole stack onto one plane
    // BRIDGE_BOW above the table. Solve the cage against BOTH shapes, the
    // flat stack it closes on and the bowed plate it then squeezes, and lift
    // the cage anchor onto the bowed plate, or the pads cup thin air on the
    // way in and the deck rises through them on the squeeze.
    const BRIDGE_BEND = 2.4
    const BRIDGE_BOW = (1 - Math.cos((CARD_H / 2) * BRIDGE_BEND)) / BRIDGE_BEND
    const CAGE_LIFT = 0.2
    const CAGE_ANCHOR = [CAGE_ANCHOR0[0], CAGE_ANCHOR0[1] + BRIDGE_BOW * CAGE_LIFT, CAGE_ANCHOR0[2]]
    const squared = landscapeStackLayout(deck)
    const shifted = (dx, dy) =>
      squared.map((c) => ({ pos: [c.pos.x + dx, c.pos.y + dy, c.pos.z], quat: c.quat }))
    const bowedPlate = squared.map((c) => ({
      pos: [c.pos.x, 0.012 + BRIDGE_BOW, c.pos.z],
      quat: c.quat,
    }))
    resolvePenetration(
      cage,
      'right',
      [...squared, ...shifted(SHIELD, 0), ...shifted(0, SHIELD), ...bowedPlate.slice(0, 1)],
      { clearance: 0 },
    )
    // "Opening" a SOLVED grip by typing small angles does not open it, it
    // UNFURLS it: the cage's curls came out of the IK, so a hand-authored
    // thumb [0.15, 0.12, 0.08] throws the tip up and out. Scale the solved
    // angles instead, so "open" always means a fraction of THIS grip.
    const relax = (finger, k) => cage.fingers[finger].map((v) => v * k)
    // Mid-cascade the cage OPENS: out and up, never in and down. Whatever is
    // still bridged rides the hands, so a cage that sinks drags its own
    // knuckles through the cards it is pouring.
    const OPENING = [CAGE_ANCHOR[0] + 0.06, CAGE_ANCHOR[1] + 0.05, CAGE_ANCHOR[2]]
    // ...and finishes clear of the squared deck it just poured (x±0.44).
    const OPEN = [REST_REACH + REST_PAD_X + 0.2, TABLE_TOP + DECK_REST_DROP + 0.08, 0.0]

    // The halves are WELDED to their hands from the cut onward (a gripped
    // packet rides the contact frame, so the authored layout is only where the
    // cards land once released). Pushing both table anchors out therefore
    // pushes both halves out with them, which is the fix for the last weave
    // hit: a tilted landscape half reaches 0.44 from its own centre, so at the
    // authored gap the two inner ends overlapped 0.26 past the centreline and
    // each hand's index pad sat inside the OTHER half's corner. Out by OUT and
    // the pads stop crossing.
    // The pads no longer cross the weave corridor, the re-authored tableGrip
    // holds its own half from ITS near edge instead of reaching across the
    // centre line, so the halves no longer need pushing apart to keep the
    // hands off each other.
    const OUT = 0
    // BOWED CARDS REST ON THEIR ENDS, NOT THEIR CENTRES. The bend shader swings
    // a card's ends toward local +Z, which on a face-down card is straight
    // DOWN, so `clampAboveFelt` lifts a bowed half until those ends touch the
    // felt: for this lesson's 1.1 bow the halves' centres ride ~0.10 above the
    // flat layout. The clamp pins them there, so the hand does NOT carry them
    // up with it, it sinks into them. LIFT puts the pads back on the cards.
    // ...which is exactly the bow the shader produces, so DERIVE it instead of
    // guessing: a card bent by `bend` rises (1 - cos(bend*CARD_H/2))/bend at
    // its centre, and the grip carries half of that (bendGain 0.5).
    // ...so LIFT is that bow, and it belongs to the BOWED beats only. A gripped
    // card rides the hand 1:1, so once the hand has lifted past the clamp's
    // threshold the two travel together and the pads stay put; below it the
    // clamp raises the cards on its own and the hand sinks into them. The flat
    // beats (cut, slide) get no lift at all, there is nothing to clamp.
    const LIFT = (1 - Math.cos((CARD_H / 2) * 1.1)) / 1.1
    const REST_A = [REST_ANCHOR[0] + OUT, REST_ANCHOR[1], REST_ANCHOR[2]]
    const LOAD_A = [LOAD_ANCHOR[0] + OUT, LOAD_ANCHOR[1] + LIFT, LOAD_ANCHOR[2]]
    // Where the ratchet ends: the same table grip, but on the SQUARED pile the
    // weave lands in, so the hands ride out and up exactly as far as the cards
    // they are pouring, instead of to a pair of hand-picked coordinates that
    // swept the fattest capsule in the rig through the landing corridor.
    // ...which is the same table grip riding OUT along the half and UP over the
    // squared pile the weave is building: that pile is a full deck tall and a
    // full card long, so the hand that was holding a 26-card half has to clear
    // both. Card-derived, so it follows the layout instead of a pair of tuned
    // coordinates that swept the fattest capsule in the rig through the landing
    // corridor.
    // Out along the half and just clear of the pile the weave is building. It
    // rides SHALLOW on purpose: whatever is still gripped rides the hand, so a
    // ratchet that climbs also drags the un-released cards up off the felt.
    const LAND_A = [LOAD_A[0] + CARD_H * 0.4, LOAD_A[1] - CARD_H * 0.2, LOAD_A[2]]

    // The two carry grips: solved onto the PORTRAIT stack the lesson starts
    // from, so the thumb and pads are on the packet they are about to move
    // instead of a whole card-length off it.
    const { pose: topGrip, anchor: TOP_A } = packetGrip({
      baseY: 0.02 + HALF * CARD_GAP,
      deckH: (HALF - 1) * CARD_GAP,
      // The carry beats squeeze far more gently than the bend does, so their
      // pads need less air, and the grip-fidelity check wants the thumb ON its
      // packet, not hovering a squeeze above it.
      squeeze: CARRY_SQUEEZE,
    })
    const { pose: bottomGrip, anchor: BOTTOM_A } = packetGrip({
      deckH: (HALF - 1) * CARD_GAP,
      squeeze: CARRY_SQUEEZE,
    })

    const halves = (dk, opts) => tableRiffleLayout(dk, { gap: G, yaw: YAW, ...opts })
    const mid = (dk) => Math.floor(dk.length / 2)
    const rightHalf = (dk, opts) => halves(dk, opts).filter((_, i) => i >= mid(dk))
    const leftHalf = (dk, opts) => halves(dk, opts).filter((_, i) => i < mid(dk))
    const NOTE_POS = [-1.35, 0.75, 0.2] // beside the action, never covering it

    return [
      {
        kind: 'hold',
        id: 'approach',
        label: 'Reach in — fingers open, deck untouched',
        duration: 1400,
        hands: {
          right: [
            // Pin frame 0. Without it both hands lerp in from the `relaxed`
            // preset's OWN wrist position, a pre-scale number that now parks a
            // 2.83x hand on top of the deck, and the sweep out of it rakes the
            // pile (measured 0.172 deep at 0.6s).
            { at: 0, pose: 'deckApproach', anchor: [APPROACH_REACH + 0.9, TABLE_TOP + DECK_APPROACH_DROP + 0.5, 0.2] },
            { at: 0.25, pose: 'deckApproach', anchor: [APPROACH_REACH + 0.5, TABLE_TOP + DECK_APPROACH_DROP + 0.26, 0.0] },
            { at: 1, pose: topGrip, anchor: TOP_A, ease: 'anticipate' },
          ],
          // Waiting its turn a full reach off the deck's own long edge, so the
          // other hand's carry grip has the pile to itself.
          left: [
            { at: 0, pose: 'deckApproach', anchor: [APPROACH_REACH + 0.9, TABLE_TOP + DECK_APPROACH_DROP + 0.5, 0.2] },
            { at: 0.5, pose: 'deckApproach', anchor: [APPROACH_REACH + 0.62, TABLE_TOP + DECK_APPROACH_DROP + 0.1, 0.1], ease: 'anticipate' },
          ],
        },
        annotations: [{ text: 'Hands first, then cards — everything starts from the grip', at: NOTE_POS, appearAt: 0.35 }],
      },
      {
        kind: 'move',
        id: 'cut',
        label: 'Cut the top half and set it down beside',
        duration: 1600,
        ease: 'easeInOutCubic',
        to: (dk) => rightHalf(dk, {}),
        grip: {
          right: { cards: 'secondHalf', frame: 'packet', pressure: [{ at: 0, v: 0.2 }, { at: 1, v: 0.3 }] },
        },
        hands: {
          right: [
            { at: 0.4, pose: topGrip, anchor: [TOP_A[0] + 0.34, TOP_A[1] + 0.24, TOP_A[2]] },
            // NOT easeOutBackSoft: an overshoot ease dips PAST the target, and
            // the target here is a contact, the pads end up under the cards.
            { at: 1, pose: restGrip, anchor: REST_A, ease: 'easeOutCubic' },
          ],
          // The left hand must CLOSE ON ITS HALF here, not stand off: `slide`
          // declares the grip at its own first frame, and a grip captures each
          // card's offset in the hand's frame at that instant, so wherever
          // this hand is when `slide` starts is where the bottom half stays
          // welded for the rest of the lesson. Parked out at 0.75 (the faro's
          // stand-off, which faro can afford because its left hand is not the
          // one that carries), the half rode 0.8 away from its own thumb. It is
          // safe to close in: the cut packet travels to +x and this hand
          // mirrors to −x, so they never share airspace. Height is the bottom
          // half's own top card, which has not moved.
          // The packet rides the contact frame from HERE, `slide` declares the
          // grip at its own first frame and the offset is captured then, so
          // this anchor decides where the bottom half stays welded for the rest
          // of the lesson. It is a cliff, not a slope: 0.65 measures 0.0000
          // everywhere, 0.50 measures 0.02-0.05, and 0.45 or below is back at
          // the 0.0812 ceiling, because the same number also sets the half's
          // position under the bend and weave grips. (Closing further in would
          // shrink the carry's hook, but not at that price.)
          // Height is the bottom half's own top card plus the clearance the
          // welded relationship needs; the cut packet travels to +x and this
          // hand mirrors to −x, so they never share airspace.
          // Comes down on the bottom half only once the cut packet has cleared
          // the centre: a hand this size wraps the stack's far end at z -0.55,
          // which is exactly the corridor the top half sweeps through as it
          // turns landscape. Hover through the sweep, seat on the last frame.
          left: [
            { at: 0.82, pose: bottomGrip, anchor: [BOTTOM_A[0], BOTTOM_A[1] + 0.5, BOTTOM_A[2]] },
            { at: 1, pose: bottomGrip, anchor: BOTTOM_A, ease: 'easeOutCubic' },
          ],
        },
        annotations: [{ text: 'Cut roughly in half — the top 26 ride the right hand, flat', at: NOTE_POS, appearAt: 0.3, until: 0.95 }],
      },
      {
        kind: 'move',
        id: 'slide',
        label: 'Slide the bottom half into place',
        duration: 1200,
        ease: 'easeInOutCubic',
        to: (dk) => leftHalf(dk, {}),
        // The LEFT half is NOT gripped through this beat, and that is a
        // geometry fact, not a preference. A gripped packet rides its hand's
        // contact frame, and the engine mirrors the left hand's frame POSITION
        // while keeping its quaternion unmirrored (grips.js' load-bearing
        // rule), so a left-hand grip held across the 90° turn from the carry
        // grip to the table grip rotates its packet the WRONG WAY round and
        // lands it 0.3 off its own layout, which is where the halves floated
        // through the whole bend and weave (measured 0.145 of thumb inside the
        // cards, unchanged by pressure or lift). The right hand turns its half
        // correctly because its frame is unmirrored; the left half follows the
        // step's layout instead, and its hand, anchored off that same layout -
        // tracks it. Both halves are gripped again from `bend` on, where no
        // orientation change remains.
        grip: {
          right: { cards: 'secondHalf', frame: 'packet', pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 0.3 }] },
        },
        hands: {
          // Lift OFF the stack before turning: this hand's thumb is tangent on
          // the pile's far edge at the start of the beat, and the half now
          // follows the step's layout rather than the hand, so any sideways
          // move out of that pose rakes the corner it was holding.
          left: [
            { at: 0.35, pose: bottomGrip, anchor: [BOTTOM_A[0], BOTTOM_A[1] + 0.42, BOTTOM_A[2]] },
            { at: 1, pose: restGrip, anchor: REST_A, ease: 'easeOutCubic' },
          ],
        },
        annotations: [{ text: 'Inner corners angled toward each other', at: NOTE_POS, appearAt: 0.35, until: 0.95 }],
      },
      {
        kind: 'move',
        id: 'bend',
        label: 'Thumbs bend the corners up — load the spring',
        duration: 2200,
        ease: 'easeOutCubic',
        to: (dk) => halves(dk, { tilt: TILT }),
        bend: 1.1,
        grip: {
          left: { cards: 'firstHalf', frame: 'packet', bendGain: 0.5, pressure: [{ at: 0, v: 0.25 }, { at: 1, v: PRESS }] },
          right: { cards: 'secondHalf', frame: 'packet', bendGain: 0.5, pressure: [{ at: 0, v: 0.25 }, { at: 1, v: PRESS }] },
        },
        hands: {
          left: [
            { at: 0.4, pose: restGrip, anchor: REST_A },
            {
              at: 1,
              pose: loadGrip,
              anchor: LOAD_A,
              motion: { type: 'jitter', amp: 0.004, cycles: 3 },
              fingerMotion: [{ fingers: ['thumb', 'index', 'middle'], type: 'tremor', amp: TREMOR, cycles: 3 }],
            },
          ],
          right: [
            { at: 0.4, pose: restGrip, anchor: REST_A },
            {
              at: 1,
              pose: loadGrip,
              anchor: LOAD_A,
              motion: { type: 'jitter', amp: 0.004, cycles: 3 },
              fingerMotion: [{ fingers: ['thumb', 'index', 'middle'], type: 'tremor', amp: TREMOR, cycles: 3 }],
            },
          ],
        },
        annotations: [{ text: 'Bend firmly — never crease. That spring drives the weave.', at: NOTE_POS, appearAt: 0.25, until: 0.95 }],
      },
      {
        kind: 'riffle',
        id: 'weave',
        label: 'Ratchet the thumbs — the corners interlace on the felt',
        // A real riffle drops irregular clumps, not one card at a time. Without
        // this the weave is a perfect faro, deterministic, and the exact move
        // this lesson's own "did you know" contrasts itself against.
        order: gsrRiffleOrder,
        duration: 5500,
        ease: 'easeInOutCubic',
        midBend: 0.7,
        arcLift: 0.05, // the cards stay LOW, they flick down onto the table
        // The weave lands as a LANDSCAPE stack between the hands (short ends
        // toward the palms), the way a real table riffle squares up.
        toLayout: (order) => landscapeStackLayout(order),
        grip: {
          left: { cards: 'firstHalf', frame: 'thumbPeel', release: 'stagger', pressure: [{ at: 0, v: WEAVE_PRESS }, { at: 1, v: 0.15 }] },
          right: { cards: 'secondHalf', frame: 'thumbPeel', release: 'stagger', pressure: [{ at: 0, v: WEAVE_PRESS }, { at: 1, v: 0.15 }] },
        },
        hands: {
          left: [
            ...thumbRatchetKeyframes({
              gripPose: loadGrip,
              // "Open" is a FRACTION of the solved grip, not a typed angle: a
              // thumbPeel frame is 0.75 thumb, so straightening the thumb to a
              // hand-picked [0.5, 0.1, 0.02] lifted the whole still-held half
              // 0.76 into the air, and the cards it then released fell back
              // down through the hand that had just let go of them.
              openThumb: loadGrip.fingers.thumb.map((v) => v * 0.9),
              openFingers: 0.9,
              anchorFrom: LOAD_A,
              // Ride OUT and UP as the weave lands. The cards settle into
              // landscapeStackLayout, long axis on x, so the stack spans
              // x±0.44 and tops out at TABLE_TOP, and at the old [0.56, 0.32]
              // the thumb's base capsule (the fattest in the rig, r≈0.078)
              // swept straight through that landing corridor for the last ~2s.
              anchorTo: LAND_A,
              steps: 6,
              jitter: 0.03,
              fingerMotion: [{ fingers: ['thumb'], type: 'tremor', amp: 0.018, cycles: 2 }],
            }),
            // Stay LOW until the last card is off the thumb: this hand still
            // holds whatever has not released, so climbing away early carries
            // the remaining half up with it (measured: cards at y 0.89, with
            // the index buried in them).
            { at: 0.96, pose: loadGrip, anchor: LAND_A },
            { at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TABLE_TOP + DECK_REST_DROP + 0.22, 0.0] },
          ],
          right: [
            ...thumbRatchetKeyframes({
              gripPose: loadGrip,
              // "Open" is a FRACTION of the solved grip, not a typed angle: a
              // thumbPeel frame is 0.75 thumb, so straightening the thumb to a
              // hand-picked [0.5, 0.1, 0.02] lifted the whole still-held half
              // 0.76 into the air, and the cards it then released fell back
              // down through the hand that had just let go of them.
              openThumb: loadGrip.fingers.thumb.map((v) => v * 0.9),
              openFingers: 0.9,
              anchorFrom: LOAD_A,
              // Ride OUT and UP as the weave lands. The cards settle into
              // landscapeStackLayout, long axis on x, so the stack spans
              // x±0.44 and tops out at TABLE_TOP, and at the old [0.56, 0.32]
              // the thumb's base capsule (the fattest in the rig, r≈0.078)
              // swept straight through that landing corridor for the last ~2s.
              anchorTo: LAND_A,
              steps: 6,
              jitter: 0.03,
              fingerMotion: [{ fingers: ['thumb'], type: 'tremor', amp: 0.018, cycles: 2 }],
            }),
            // Stay LOW until the last card is off the thumb: this hand still
            // holds whatever has not released, so climbing away early carries
            // the remaining half up with it (measured: cards at y 0.89, with
            // the index buried in them).
            { at: 0.96, pose: loadGrip, anchor: LAND_A },
            { at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TABLE_TOP + DECK_REST_DROP + 0.22, 0.0] },
          ],
        },
        annotations: [
          { text: 'Release slowly — the corners weave one card at a time', at: NOTE_POS, appearAt: 0.12, until: 0.5 },
          { text: 'About 7 riffles fully randomize a 52-card deck', at: NOTE_POS, appearAt: 0.58, until: 0.97 },
        ],
      },
      {
        kind: 'move',
        id: 'square',
        label: 'Push the halves home and square up',
        duration: 1400,
        ease: 'settle',
        to: (dk) => landscapeStackLayout(dk),
        bend: 0,
        hands: {
          // The weave lands LANDSCAPE (x±0.44), so the hands square it from
          // 0.9 out, far enough that the thumb base clears the long side -
          // with the pads one measured drop above the new top card.
          // `easeOutCubic`, not `settle`: settle overshoots ~4% past the
          // target, which on a contact means straight through the top card.
          left: [{ at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TABLE_TOP + DECK_REST_DROP, 0.0], ease: 'easeOutCubic' }],
          right: [{ at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TABLE_TOP + DECK_REST_DROP, 0.0], ease: 'easeOutCubic' }],
        },
      },
      {
        kind: 'hold',
        id: 'cage',
        label: 'Cup the ends of the squared deck',
        duration: 1100,
        hands: {
          // easeOutCubic, not easeOutBackSoft: the overshoot drove the closing
          // cage 4% PAST the deck's end faces on the way in.
          // Come in OVER the deck, not through it: `deckRest` holds the pile
          // from a reach away, and a straight line from there to the cage's own
          // anchor drags four pads across the top card on the way.
          left: [
            { at: 0.45, pose: cage, anchor: [CAGE_ANCHOR[0] + 0.3, CAGE_ANCHOR[1] + 0.34, CAGE_ANCHOR[2]] },
            { at: 1, pose: cage, anchor: CAGE_ANCHOR, ease: 'easeOutCubic' },
          ],
          right: [
            { at: 0.45, pose: cage, anchor: [CAGE_ANCHOR[0] + 0.3, CAGE_ANCHOR[1] + 0.34, CAGE_ANCHOR[2]] },
            { at: 1, pose: cage, anchor: CAGE_ANCHOR, ease: 'easeOutCubic' },
          ],
        },
      },
      {
        kind: 'move',
        id: 'bridge',
        label: 'Squeeze — bow the deck between the hands',
        duration: 1700,
        ease: 'easeInOutCubic',
        to: (dk) => landscapeStackLayout(dk, { bend: 2.4 }),
        bend: 2.4,
        // Hands are ALREADY caging (same orientation throughout the hold), so
        // the deck bows in place between the fingers instead of tipping over.
        grip: {
          right: { cards: 'all', frame: 'packet', bendGain: 0.4, pressure: [{ at: 0, v: 0.3 }, { at: 1, v: 0.9 }] },
        },
        hands: {
          left: [{ at: 1, pose: cage, anchor: CAGE_ANCHOR, fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.04 }] }],
          right: [{ at: 1, pose: cage, anchor: CAGE_ANCHOR, fingerMotion: [{ fingers: ['thumb', 'index'], type: 'tighten', amp: 0.04 }] }],
        },
        annotations: [{ text: 'The bridge: thumbs on top, fingers cupping the ends', at: NOTE_POS, appearAt: 0.3, until: 0.95 }],
      },
      {
        kind: 'move',
        id: 'cascade',
        label: 'Let the bridge pour — card by card',
        duration: 2200,
        ease: 'easeInOutCubic',
        to: (dk) => landscapeStackLayout(dk),
        bend: 0,
        stagger: { by: 'card', spread: 0.7, span: 0.3 },
        midBend: 0.7,
        arcLift: 0.05,
        grip: {
          right: { cards: 'all', frame: 'packet', release: 'stagger', pressure: [{ at: 0, v: 0.9 }, { at: 1, v: 0.1 }] },
        },
        hands: {
          left: [
            { at: 0, pose: cage, anchor: CAGE_ANCHOR },
            {
              at: 0.6,
              fingers: { thumb: relax('thumb', 0.75) },
              anchor: OPENING,
              fingerMotion: [{ fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: 0.05, cycles: 3 }],
            },
            { at: 1, fingers: { thumb: relax('thumb', 0.3), index: relax('index', 0.45), middle: relax('middle', 0.45) }, anchor: OPEN, ease: 'easeOutCubic' },
          ],
          right: [
            { at: 0, pose: cage, anchor: CAGE_ANCHOR },
            {
              at: 0.6,
              fingers: { thumb: relax('thumb', 0.75) },
              anchor: OPENING,
              fingerMotion: [{ fingers: ['index', 'middle', 'ring', 'pinky'], type: 'curlRipple', amp: 0.05, cycles: 3 }],
            },
            { at: 1, fingers: { thumb: relax('thumb', 0.3), index: relax('index', 0.45), middle: relax('middle', 0.45) }, anchor: OPEN, ease: 'easeOutCubic' },
          ],
        },
        annotations: [{ text: 'The stored spring flowing out under the fingers is the payoff', at: NOTE_POS, appearAt: 0.15, until: 0.9 }],
      },
      {
        kind: 'hold',
        id: 'rest',
        label: 'Squared and shuffled',
        duration: 1300,
        hands: {
          // `relaxed` carries the preset's OWN wrist position (x 0.95, y 0.5),
          // which is a hand-picked number from before any of this geometry
          // existed, it parked the pinky inside the squared deck. Rest on the
          // deck instead, one measured drop above its top card.
          left: [{ at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TABLE_TOP + DECK_REST_DROP, 0.0], ease: 'easeInOutCubic' }],
          right: [{ at: 1, pose: 'deckRest', anchor: [REST_REACH + REST_PAD_X, TABLE_TOP + DECK_REST_DROP, 0.0], ease: 'easeInOutCubic' }],
        },
      },
    ]
  },
}
