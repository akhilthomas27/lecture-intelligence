"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Full-viewport Three.js canvas mounted behind every page.
 *
 * Renders a slowly drifting field of ~120 white particles that connect to
 * each other with thin indigo lines when within a threshold distance.
 * Particles near the cursor (projected onto the scene plane) get pulled
 * gently toward it. The scene rotates very slowly on the Y axis.
 *
 * Performance / correctness notes:
 * - Uses `requestAnimationFrame` and pauses when `document.visibilityState`
 *   is "hidden" so a backgrounded tab doesn't burn CPU.
 * - Disposes the renderer, geometries, and materials on unmount.
 * - Connecting lines reuse a single `BufferGeometry` whose position buffer
 *   is rewritten each frame — avoids allocating thousands of geometries
 *   per second.
 * - `pointer-events: none` on the canvas so the visualization never
 *   intercepts clicks/taps on UI sitting above it.
 */

const PARTICLE_COUNT = 120;
const BOUNDS = 50; // ±BOUNDS along each axis
const CONNECT_DISTANCE = 12; // particles closer than this get a line
const CONNECT_DISTANCE_SQ = CONNECT_DISTANCE * CONNECT_DISTANCE;
const MOUSE_PULL_RADIUS = 18;
const MOUSE_PULL_STRENGTH = 0.0015;
const ROTATION_SPEED = 0.0004; // radians per frame ≈ slow drift
const PARTICLE_SPEED = 0.04;

export default function ThreeBackground() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ---- Scene + camera + renderer --------------------------------------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.z = 60;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 1);
    container.appendChild(renderer.domElement);

    // The canvas itself shouldn't intercept clicks.
    renderer.domElement.style.pointerEvents = "none";

    // A group lets us rotate everything together without touching individual
    // particle positions.
    const group = new THREE.Group();
    scene.add(group);

    // ---- Particles -------------------------------------------------------
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * BOUNDS * 2;
      positions[i * 3 + 1] = (Math.random() - 0.5) * BOUNDS * 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * BOUNDS * 2;
      velocities[i * 3 + 0] = (Math.random() - 0.5) * PARTICLE_SPEED;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * PARTICLE_SPEED;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * PARTICLE_SPEED;
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );

    const particleMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.45,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(particleGeo, particleMat);
    group.add(points);

    // ---- Connecting lines ------------------------------------------------
    // Worst case: every pair connected → PARTICLE_COUNT * (PARTICLE_COUNT-1)/2
    // segments. Each segment is 2 vertices × 3 floats. We pre-allocate the
    // maximum and just adjust the draw range each frame.
    const maxSegments = (PARTICLE_COUNT * (PARTICLE_COUNT - 1)) / 2;
    const linePositions = new Float32Array(maxSegments * 2 * 3);
    const lineColors = new Float32Array(maxSegments * 2 * 3);

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(linePositions, 3),
    );
    lineGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(lineColors, 3),
    );

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    // Indigo (#6366f1) — same value cached as a Color for fast per-vertex set.
    const indigo = new THREE.Color(0x6366f1);

    const lines = new THREE.LineSegments(lineGeo, lineMat);
    group.add(lines);

    // ---- Mouse tracking (projected to a plane through the scene origin) -
    const mouse = new THREE.Vector2(0, 0);
    const mouseTarget = new THREE.Vector3(0, 0, 0);
    const raycaster = new THREE.Raycaster();
    const mousePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    function onMouseMove(e: MouseEvent) {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      raycaster.ray.intersectPlane(mousePlane, mouseTarget);
    }
    window.addEventListener("mousemove", onMouseMove);

    // ---- Resize handling ------------------------------------------------
    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener("resize", onResize);

    // ---- Visibility pause ------------------------------------------------
    let paused = document.visibilityState === "hidden";
    function onVisibility() {
      paused = document.visibilityState === "hidden";
      if (!paused) lastTs = performance.now();
    }
    document.addEventListener("visibilitychange", onVisibility);

    // ---- Animation loop --------------------------------------------------
    let rafId = 0;
    let lastTs = performance.now();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (paused) return;

      const now = performance.now();
      // Time delta in 60-fps "frames" so motion stays consistent on faster
      // displays without hitching when a frame is dropped.
      const dt = Math.min(((now - lastTs) / 1000) * 60, 4);
      lastTs = now;

      const posAttr = particleGeo.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const posArr = posAttr.array as Float32Array;

      // 1. Advance every particle, bounce off the bounds, and apply a
      //    gentle pull toward the projected mouse position.
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ix = i * 3;

        // Mouse pull (within radius, scales with proximity)
        const dx = mouseTarget.x - posArr[ix + 0];
        const dy = mouseTarget.y - posArr[ix + 1];
        const dz = mouseTarget.z - posArr[ix + 2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < MOUSE_PULL_RADIUS * MOUSE_PULL_RADIUS) {
          const factor = MOUSE_PULL_STRENGTH * dt;
          velocities[ix + 0] += dx * factor;
          velocities[ix + 1] += dy * factor;
          velocities[ix + 2] += dz * factor;
        }

        // Mild damping so accumulated mouse pulls don't spiral
        velocities[ix + 0] *= 0.995;
        velocities[ix + 1] *= 0.995;
        velocities[ix + 2] *= 0.995;

        // Integrate position
        posArr[ix + 0] += velocities[ix + 0] * dt;
        posArr[ix + 1] += velocities[ix + 1] * dt;
        posArr[ix + 2] += velocities[ix + 2] * dt;

        // Bounce off invisible walls
        for (let axis = 0; axis < 3; axis++) {
          if (posArr[ix + axis] > BOUNDS) {
            posArr[ix + axis] = BOUNDS;
            velocities[ix + axis] *= -1;
          } else if (posArr[ix + axis] < -BOUNDS) {
            posArr[ix + axis] = -BOUNDS;
            velocities[ix + axis] *= -1;
          }
        }
      }
      posAttr.needsUpdate = true;

      // 2. Recompute connecting lines.
      let segIndex = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const ax = posArr[i * 3 + 0];
        const ay = posArr[i * 3 + 1];
        const az = posArr[i * 3 + 2];
        for (let j = i + 1; j < PARTICLE_COUNT; j++) {
          const bx = posArr[j * 3 + 0];
          const by = posArr[j * 3 + 1];
          const bz = posArr[j * 3 + 2];
          const dx2 = ax - bx;
          const dy2 = ay - by;
          const dz2 = az - bz;
          const d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
          if (d2 < CONNECT_DISTANCE_SQ) {
            // Linear falloff: closer pairs get more saturated indigo, far
            // pairs fade toward black. The material's overall opacity
            // (0.3) multiplies on top of this for the final on-screen
            // intensity.
            const t = 1 - Math.sqrt(d2) / CONNECT_DISTANCE;
            const r = indigo.r * t;
            const g = indigo.g * t;
            const b = indigo.b * t;

            const off = segIndex * 6;
            linePositions[off + 0] = ax;
            linePositions[off + 1] = ay;
            linePositions[off + 2] = az;
            linePositions[off + 3] = bx;
            linePositions[off + 4] = by;
            linePositions[off + 5] = bz;

            lineColors[off + 0] = r;
            lineColors[off + 1] = g;
            lineColors[off + 2] = b;
            lineColors[off + 3] = r;
            lineColors[off + 4] = g;
            lineColors[off + 5] = b;

            segIndex++;
          }
        }
      }
      const linePosAttr = lineGeo.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const lineColAttr = lineGeo.getAttribute(
        "color",
      ) as THREE.BufferAttribute;
      linePosAttr.needsUpdate = true;
      lineColAttr.needsUpdate = true;
      lineGeo.setDrawRange(0, segIndex * 2);

      // 3. Slow Y-axis rotation for depth.
      group.rotation.y += ROTATION_SPEED * dt;

      renderer.render(scene, camera);
    };

    animate();

    // ---- Cleanup ---------------------------------------------------------
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);

      particleGeo.dispose();
      particleMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        pointerEvents: "none",
        backgroundColor: "#000000",
      }}
    />
  );
}
