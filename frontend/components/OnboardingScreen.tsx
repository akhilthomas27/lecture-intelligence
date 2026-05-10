"use client";

import { motion, useAnimationFrame } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ROLE_HOME_PATH,
  USER_NAME_KEY,
  USER_TYPE_KEY,
  type UserType,
  setStoredUserName,
  setStoredUserType,
} from "@/lib/role";

interface RoleCard {
  type: UserType;
  title: string;
  blurb: string;
  emoji: string;
}

const ROLE_CARDS: RoleCard[] = [
  {
    type: "student",
    title: "Student",
    blurb: "Turn lectures into study materials",
    emoji: "🎓",
  },
  {
    type: "faculty",
    title: "Faculty",
    blurb: "Get feedback on your teaching",
    emoji: "🧑‍🏫",
  },
  {
    type: "provost",
    title: "Provost",
    blurb: "Map curriculum against objectives",
    emoji: "🏛️",
  },
];

function Logo() {
  return (
    <div className="flex items-center justify-center mb-8">
      <img
        src="/logo.png"
        alt="Making every lecture count"
        style={{ height: 60, width: "Auto" }}
      />
    </div>
  );
}

// Animated moving indigo glow that travels around the card border
function AnimatedBorder() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(0);

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const radius = 24;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Advance progress 0 → 1 looping
    progressRef.current = (progressRef.current + 0.003) % 1;
    const p = progressRef.current;

    // Total perimeter of rounded rect (approximate)
    const perimeter = 2 * (w + h) - 8 * radius + 2 * Math.PI * radius;
    const dotPosition = p * perimeter;

    // Draw static dim border first
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, h - 2, radius);
    ctx.strokeStyle = "rgba(99, 102, 241, 0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw glowing dot at current position
    const point = getPointOnRoundedRect(dotPosition, w, h, radius, perimeter);

    // Outer glow
    const gradient = ctx.createRadialGradient(
      point.x, point.y, 0,
      point.x, point.y, 60
    );
    gradient.addColorStop(0, "rgba(99, 102, 241, 0.8)");
    gradient.addColorStop(0.3, "rgba(99, 102, 241, 0.3)");
    gradient.addColorStop(1, "rgba(99, 102, 241, 0)");

    ctx.beginPath();
    ctx.arc(point.x, point.y, 60, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Bright core dot
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#a5b4fc";
    ctx.fill();

    // Trailing tail
    for (let i = 1; i <= 8; i++) {
      const tailP = ((p - i * 0.008) + 1) % 1;
      const tailPos = tailP * perimeter;
      const tailPoint = getPointOnRoundedRect(tailPos, w, h, radius, perimeter);
      const opacity = (1 - i / 8) * 0.5;
      ctx.beginPath();
      ctx.arc(tailPoint.x, tailPoint.y, 2 - i * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99, 102, 241, ${opacity})`;
      ctx.fill();
    }
  });

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        borderRadius: 24,
      }}
      width={640}
      height={800}
    />
  );
}

// Calculate x,y point on a rounded rectangle perimeter given distance along it
function getPointOnRoundedRect(
  distance: number,
  w: number,
  h: number,
  r: number,
  perimeter: number,
): { x: number; y: number } {
  // Clamp distance
  distance = ((distance % perimeter) + perimeter) % perimeter;

  // Segments: top, top-right corner, right, bottom-right corner,
  //           bottom, bottom-left corner, left, top-left corner
  const straightTop = w - 2 * r;
  const cornerTR = (Math.PI / 2) * r;
  const straightRight = h - 2 * r;
  const cornerBR = (Math.PI / 2) * r;
  const straightBottom = w - 2 * r;
  const cornerBL = (Math.PI / 2) * r;
  const straightLeft = h - 2 * r;
  const cornerTL = (Math.PI / 2) * r;

  let d = distance;

  // Top edge (left to right)
  if (d < straightTop) {
    return { x: r + d, y: 0 };
  }
  d -= straightTop;

  // Top-right corner
  if (d < cornerTR) {
    const angle = -Math.PI / 2 + (d / r);
    return { x: w - r + Math.cos(angle) * r, y: r + Math.sin(angle) * r };
  }
  d -= cornerTR;

  // Right edge (top to bottom)
  if (d < straightRight) {
    return { x: w, y: r + d };
  }
  d -= straightRight;

  // Bottom-right corner
  if (d < cornerBR) {
    const angle = 0 + (d / r);
    return { x: w - r + Math.cos(angle) * r, y: h - r + Math.sin(angle) * r };
  }
  d -= cornerBR;

  // Bottom edge (right to left)
  if (d < straightBottom) {
    return { x: w - r - d, y: h };
  }
  d -= straightBottom;

  // Bottom-left corner
  if (d < cornerBL) {
    const angle = Math.PI / 2 + (d / r);
    return { x: r + Math.cos(angle) * r, y: h - r + Math.sin(angle) * r };
  }
  d -= cornerBL;

  // Left edge (bottom to top)
  if (d < straightLeft) {
    return { x: 0, y: h - r - d };
  }
  d -= straightLeft;

  // Top-left corner
  const angle = Math.PI + (d / r);
  return { x: r + Math.cos(angle) * r, y: r + Math.sin(angle) * r };
}

export default function OnboardingScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<UserType | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const existingType = window.localStorage.getItem(USER_TYPE_KEY);
    if (
      existingType === "student" ||
      existingType === "faculty" ||
      existingType === "provost"
    ) {
      router.replace(ROLE_HOME_PATH[existingType]);
      return;
    }
    const existingName = window.localStorage.getItem(USER_NAME_KEY) ?? "";
    setName(existingName);
    setHydrated(true);
  }, [router]);

  function handleContinue() {
    if (!selected) return;
    setStoredUserName(name);
    setStoredUserType(selected);
    router.push(ROLE_HOME_PATH[selected]);
  }

  if (!hydrated) {
    return <main className="min-h-screen" />;
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="glass-card w-full max-w-2xl p-8 sm:p-12 border border-white/20 shadow-2xl shadow-black/40"
        style={{ position: "relative", overflow: "visible" }}
      >
        {/* Animated indigo border glow */}
        <AnimatedBorder />

        {/* Logo */}
        <Logo />

        <header className="mb-8">
          <p className="text-center text-sm sm:text-base text-indigo-400 uppercase tracking-[0.22em] mb-3">
            Making every lecture count
          </p>
        </header>

        {/* Optional name */}
        <section className="mb-7">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-4">
            How are you using this today?
          </h1>
          <label htmlFor="user-name" className="sr-only">
            What should we call you?
          </label>
          <input
            id="user-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What should we call you? (optional)"
            autoComplete="given-name"
            className="glass-input w-full px-4 py-3 text-sm sm:text-base"
          />
        </section>


        {/* Mandatory role selection */}
        <section className="mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {ROLE_CARDS.map((card) => {
              const active = selected === card.type;
              return (
                <button
                  key={card.type}
                  type="button"
                  onClick={() => setSelected(card.type)}
                  aria-pressed={active}
                  style={{
                    background: active
                      ? "rgba(99, 102, 241, 0.10)"
                      : "rgba(255, 255, 255, 0.03)",
                    borderColor: active
                      ? "#6366f1"
                      : "rgba(255, 255, 255, 0.06)",
                    boxShadow: active
                      ? "0 0 24px rgba(99, 102, 241, 0.18)"
                      : "none",
                  }}
                  className="role-card group text-left p-5 rounded-2xl border transition-all duration-150 hover:!border-indigo-500/70 hover:!shadow-[0_0_20px_rgba(99,102,241,0.15)] hover:scale-[1.015]"
                >
                  <div className="text-2xl mb-2.5">{card.emoji}</div>
                  <h3 className="font-semibold text-white mb-1 text-sm sm:text-base">
                    {card.title}
                  </h3>
                  <p className="text-xs text-white/50 leading-relaxed">
                    {card.blurb}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          onClick={handleContinue}
          disabled={!selected}
          className="indigo-button w-full px-5 py-3.5 text-sm sm:text-base"
        >
          Continue
        </button>
      </motion.div>
    </main>
  );
}