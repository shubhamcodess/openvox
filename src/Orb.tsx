import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { getAnalyser } from './speech'

const COUNT = 1400

/** Sphere of cubes; speech energy pushes cubes from the inside out and lights displaced ones orange. */
export default function Orb() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
    camera.position.z = 4.2

    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
      COUNT,
    )
    scene.add(mesh)

    const dirs: THREE.Vector3[] = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < COUNT; i++) {
      const y = 1 - (i / (COUNT - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      dirs.push(new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r))
    }

    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    const base = new THREE.Color(dark ? '#85847e' : '#6b6a63')
    const hot = new THREE.Color(dark ? '#f7703f' : '#c2410c')
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color()
    const freq = new Uint8Array(256)
    let level = 0
    let raf = 0

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    addEventListener('resize', resize)

    const tick = (ms: number) => {
      const t = ms / 1000
      const an = getAnalyser()
      let target = 0
      if (an) {
        an.getByteFrequencyData(freq)
        let sum = 0
        for (let i = 2; i < 64; i++) sum += freq[i]
        target = sum / (62 * 255)
      }
      level += (target - level) * 0.25

      for (let i = 0; i < COUNT; i++) {
        const d = dirs[i]
        const band = (freq[2 + (i % 60)] ?? 0) / 255
        const n = Math.sin(d.x * 5 + t * 2.1) * Math.cos(d.y * 4 - t * 1.7) * Math.sin(d.z * 6 + t * 1.3)
        const push = level * (0.55 * n + 0.9 * band)
        const radius = 1 + 0.015 * Math.sin(t + i) - Math.abs(push) * 0.35 + Math.max(push, 0) * 0.5
        p.copy(d).multiplyScalar(radius)
        const size = 0.035 + Math.abs(push) * 0.07
        s.setScalar(size)
        q.setFromAxisAngle(d, push * 2)
        mesh.setMatrixAt(i, m.compose(p, q, s))
        c.copy(base).lerp(hot, Math.min(1, Math.abs(push) * 2.2))
        mesh.setColorAt(i, c)
      }
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor!.needsUpdate = true
      mesh.rotation.y = t * 0.12
      mesh.rotation.x = 0.25
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  return <div className="orb" ref={host} aria-hidden />
}
