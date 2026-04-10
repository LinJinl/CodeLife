'use client'

import { useEffect, useRef } from 'react'

export function WorldBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const ORIGINS = [
      { rx: 0.28, ry: 0.80 },
      { rx: 0.50, ry: 0.85 },
      { rx: 0.74, ry: 0.78 },
    ]

    type Particle = {
      x: number; y: number
      ox: number; oy: number
      vx: number; vy: number
      r: number; life: number; maxLife: number
      phase: number
      o: { rx: number; ry: number }
    }

    function mkParticle(o: { rx: number; ry: number }): Particle {
      return {
        x: 0, y: 0, ox: o.rx, oy: o.ry,
        vx: (Math.random() - 0.5) * 0.12,
        vy: -(0.22 + Math.random() * 0.28),
        r: 1.2 + Math.random() * 1.8,
        life: Math.random() * 220,
        maxLife: 160 + Math.random() * 120,
        phase: Math.random() * Math.PI * 2,
        o,
      }
    }

    const particles: Particle[] = ORIGINS.flatMap(o =>
      Array.from({ length: 5 }, () => mkParticle(o))
    )

    let raf: number
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      particles.forEach(p => {
        p.life++
        if (p.life >= p.maxLife) {
          Object.assign(p, mkParticle(p.o))
          p.x = p.o.rx * canvas.width  + (Math.random() - 0.5) * 16
          p.y = p.o.ry * canvas.height
          return
        }
        if (p.life === 1) {
          p.x = p.o.rx * canvas.width  + (Math.random() - 0.5) * 16
          p.y = p.o.ry * canvas.height
        }
        const prog  = p.life / p.maxLife
        const alpha = Math.sin(prog * Math.PI) * 0.09
        p.x += p.vx + Math.sin(p.life * 0.025 + p.phase) * 0.07
        p.y += p.vy
        p.r += 0.009
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        const isLight = document.documentElement.dataset.theme === 'light'
        ctx.fillStyle = isLight
          ? `rgba(45,35,22,${alpha * 0.55})`
          : `rgba(195,162,100,${alpha})`
        ctx.fill()
      })
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="world">
      <div className="world-sky" />

      <svg className="world-mountains" viewBox="0 0 1440 520"
           preserveAspectRatio="xMidYMax slice"
           xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path className="mountain-far"
              d="M0 340 C120 180 220 260 340 200 C460 140 540 220 660 170
                 C780 120 860 190 980 160 C1100 130 1220 200 1340 170 L1440 180
                 L1440 520 L0 520 Z"
              fill="#18140F" opacity="0.45"/>
        <path className="mountain-mid"
              d="M0 390 C80 280 180 340 280 290 C400 240 480 310 600 260
                 C720 210 800 280 920 240 C1040 200 1140 270 1260 240
                 C1340 220 1400 260 1440 250 L1440 520 L0 520 Z"
              fill="#13100C" opacity="0.65"/>
        <path className="mountain-near"
              d="M0 440 C60 370 140 410 220 380 C340 340 420 400 540 370
                 C660 340 740 390 860 360 C980 330 1060 380 1180 355
                 C1280 335 1380 370 1440 360 L1440 520 L0 520 Z"
              fill="#0F0C09" opacity="0.82"/>
        <path className="mountain-base"
              d="M0 490 C200 470 400 480 600 468 C800 456 1000 475 1200 465
                 C1320 460 1400 470 1440 468 L1440 520 L0 520 Z"
              fill="#0A0806"/>
      </svg>

      <div className="mist mist-a" />
      <div className="mist mist-b" />
      <div className="mist mist-c" />
      <div className="world-vignette" />
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  )
}
