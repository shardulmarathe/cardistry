import React, { Suspense, useState, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html, ContactShadows, Environment, Text } from '@react-three/drei'
import { Physics, RigidBody } from '@react-three/rapier'
import * as THREE from 'three'

// Card suits and ranks
const SUITS = ['Spades', 'Hearts', 'Diamonds', 'Clubs']
const RANKS = ['Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King']

// Suit symbols and colors
const SUIT_SYMBOLS = {
  'Spades': { symbol: '♠', color: '#000000' },
  'Hearts': { symbol: '♥', color: '#cc0000' },
  'Diamonds': { symbol: '♦', color: '#cc0000' },
  'Clubs': { symbol: '♣', color: '#000000' }
}

// Generate 52 unique card IDs
const generateDeck = () => {
  const deck = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${suit}_${rank}`)
    }
  }
  return deck
}

const DECK_CARDS = generateDeck()

// Function to get card display info
const getCardInfo = (cardId) => {
  const [suit, rank] = cardId.split('_')
  const suitInfo = SUIT_SYMBOLS[suit]
  const rankDisplay = rank === 'Ace' ? 'A' : rank === 'Jack' ? 'J' : rank === 'Queen' ? 'Q' : rank === 'King' ? 'K' : rank
  return { suit, rank, rankDisplay, ...suitInfo }
}

const Card = React.memo(function Card({ 
  cardId, 
  index, 
  isSelected, 
  onSelect, 
  onReset,
  hovered,
  onHover,
  isFanned,
  fanPosition
}) {
  const cardRef = useRef()
  const meshRef = useRef()
  const cardInfo = getCardInfo(cardId)
  const targetPosition = useRef(new THREE.Vector3(0, 2, 2.5))
  const initialPosition = useRef(new THREE.Vector3(0, 0.02 * index, 0))
  
  // Calculate position based on fan state
  const currentPosition = useMemo(() => {
    if (isSelected) {
      return targetPosition.current
    } else if (isFanned) {
      return new THREE.Vector3(fanPosition, 0.02 * index, 0)
    } else {
      return initialPosition.current
    }
  }, [isSelected, isFanned, fanPosition, index])
  
  // Smooth animation
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.lerp(currentPosition, 0.1)
      
      // Hover effect - lift card slightly
      if (hovered === cardId && !isSelected) {
        meshRef.current.position.y += 0.1
      }
    }
  })
  
  const handleClick = () => {
    if (isSelected) {
      // Reset to dynamic and let it fall
      if (cardRef.current) {
        cardRef.current.setBodyType(0) // 0 = dynamic
      }
      onReset()
    } else {
      // Select and move to inspection position
      if (cardRef.current) {
        cardRef.current.setBodyType(2) // 2 = kinematicPosition
      }
      onSelect(cardId)
    }
  }
  
  // Create materials for card faces and edges
  const materials = useMemo(() => [
    // Front face - white with rank/suit
    <meshStandardMaterial key="front" 
      color="white" 
      roughness={0.2}
      metalness={0.05}
    />,
    // Back face - navy blue
    <meshStandardMaterial key="back"
      color="#001f3f" 
      roughness={0.2}
      metalness={0.05}
    />,
    // Top edge - paper texture
    <meshStandardMaterial key="top"
      color="#f5f5f5" 
      roughness={0.2}
      metalness={0.05}
      emissive={hovered ? "#ffff00" : "#000000"}
      emissiveIntensity={hovered ? 0.2 : 0}
    />,
    // Bottom edge - paper texture
    <meshStandardMaterial key="bottom"
      color="#f5f5f5" 
      roughness={0.2}
      metalness={0.05}
      emissive={hovered ? "#ffff00" : "#000000"}
      emissiveIntensity={hovered ? 0.2 : 0}
    />,
    // Right edge - paper texture
    <meshStandardMaterial key="right"
      color="#f5f5f5" 
      roughness={0.2}
      metalness={0.05}
      emissive={hovered ? "#ffff00" : "#000000"}
      emissiveIntensity={hovered ? 0.2 : 0}
    />,
    // Left edge - paper texture
    <meshStandardMaterial key="left"
      color="#f5f5f5" 
      roughness={0.2}
      metalness={0.05}
      emissive={hovered ? "#ffff00" : "#000000"}
      emissiveIntensity={hovered ? 0.2 : 0}
    />
  ], [hovered])
  
  return (
    <RigidBody 
      type="dynamic" 
      colliders="cuboid" 
      ref={cardRef}
      ccd={true}
    >
      <mesh 
        ref={meshRef}
        position={[0, 0.02 * index, 0]} 
        onPointerDown={handleClick}
        onPointerEnter={() => onHover(cardId)}
        onPointerLeave={() => onHover(null)}
      >
        <boxGeometry args={[0.7, 0.02, 1.0]} />
        {materials}
        {/* Card front text */}
        <Text
          position={[0, 0.011, 0]}
          rotation={[0, 0, 0]}
          fontSize={0.15}
          color={cardInfo.color}
          anchorX="center"
          anchorY="middle"
        >
          {cardInfo.rankDisplay}{cardInfo.symbol}
        </Text>
      </mesh>
    </RigidBody>
  )
})

function Deck({ selectedCard, onSelectCard, onResetCard, hovered, onHover, isFanned, fanPosition }) {
  // Memoize all cards to prevent re-creation
  const cards = useMemo(() => 
    DECK_CARDS.map((cardId, index) => (
      <Card
        key={cardId}
        cardId={cardId}
        index={index}
        isSelected={selectedCard === cardId}
        onSelect={onSelectCard}
        onReset={onResetCard}
        hovered={hovered === cardId}
        onHover={onHover}
        isFanned={isFanned}
        fanPosition={fanPosition}
      />
    )), [selectedCard, onSelectCard, onResetCard, hovered, onHover, isFanned, fanPosition]
  )
  
  return <>{cards}</>
}

function Scene({ selectedCard, onSelectCard, onResetCard, hovered, onHover, isFanned, fanPosition }) {
  return (
    <>
      <color attach="background" args={["#050505"]} />
      <Environment preset="night" />
      <ambientLight intensity={0.4} />
      <directionalLight 
        position={[10, 10, 10]} 
        intensity={0.8} 
        castShadow 
      />
      <Deck 
        selectedCard={selectedCard}
        onSelectCard={onSelectCard}
        onResetCard={onResetCard}
        hovered={hovered}
        onHover={onHover}
        isFanned={isFanned}
        fanPosition={fanPosition}
      />
      <ContactShadows 
        position={[0, -0.01, 0]} 
        scale={15} 
        blur={3} 
        far={10} 
        opacity={0.5}
        resolution={256}
        color="#000000"
      />
    </>
  )
}

function App() {
  const [selectedCard, setSelectedCard] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [isFanned, setIsFanned] = useState(false)
  const [fanPosition, setFanPosition] = useState(0)
  
  const handleSelectCard = (cardId) => {
    setSelectedCard(cardId)
  }
  
  const handleResetCard = () => {
    setSelectedCard(null)
  }
  
  const handleHover = (cardId) => {
    setHovered(cardId)
  }
  
  const handleDeckClick = () => {
    if (!selectedCard) {
      setIsFanned(!isFanned)
    }
  }
  
  const handleWheel = (event) => {
    if (isFanned && !selectedCard) {
      event.preventDefault()
      setFanPosition(prev => Math.max(-10, Math.min(10, prev + event.deltaY * 0.01)))
    }
  }
  
  return (
    <div style={{ 
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%', 
      height: '100%', 
      margin: 0, 
      padding: 0, 
      overflow: 'hidden', 
      background: '#050505', 
      display: 'block' 
    }}>
      <Canvas 
        shadows 
        camera={{ position: [0, 5, 7], fov: 45 }}
        gl={{ antialias: true }}
        onWheel={handleWheel}
      >
        <Suspense fallback={null}>
          <Physics debug>
            <OrbitControls 
              makeDefault 
              target={selectedCard ? [0, 2, 2.5] : [0, 0, 0]}
            />
            <Scene 
              selectedCard={selectedCard}
              onSelectCard={handleSelectCard}
              onResetCard={handleResetCard}
              hovered={hovered}
              onHover={handleHover}
              isFanned={isFanned}
              fanPosition={fanPosition}
            />
          </Physics>
        </Suspense>
      </Canvas>
      
      {/* Deck click area */}
      {!isFanned && !selectedCard && (
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '20px',
            background: 'rgba(255,255,255,0.1)',
            backdropFilter: 'blur(10px)',
            borderRadius: '12px',
            color: 'white',
            fontSize: '16px',
            fontWeight: 'bold',
            textAlign: 'center',
            cursor: 'pointer',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
          }}
          onClick={handleDeckClick}
        >
          Click Deck to Fan
        </div>
      )}
      
      {/* Inspection UI */}
      {selectedCard && (
        <div style={{
          position: 'absolute',
          bottom: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '20px',
          background: 'rgba(255,255,255,0.1)',
          backdropFilter: 'blur(10px)',
          borderRadius: '12px',
          color: 'white',
          fontSize: '16px',
          fontWeight: 'bold',
          textAlign: 'center',
          pointerEvents: 'none',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
        }}>
          {selectedCard.replace('_', ' of ')}
          <div style={{ 
            fontSize: '14px', 
            marginTop: '8px', 
            opacity: 0.8,
            fontWeight: 'normal'
          }}>
            Click to return to fan
          </div>
        </div>
      )}
      
      {/* Fan instructions */}
      {isFanned && !selectedCard && (
        <div style={{
          position: 'absolute',
          top: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '15px',
          background: 'rgba(255,255,255,0.1)',
          backdropFilter: 'blur(10px)',
          borderRadius: '12px',
          color: 'white',
          fontSize: '14px',
          textAlign: 'center',
          pointerEvents: 'none',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
        }}>
          Scroll to shift through cards
        </div>
      )}
    </div>
  )
}

export default App
