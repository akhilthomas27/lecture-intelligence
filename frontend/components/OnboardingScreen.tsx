"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
    blurb: "Get private feedback on your teaching",
    emoji: "🏛️",
  },
  {
    type: "provost",
    title: "Provost",
    blurb: "Map curriculum against objectives",
    emoji: "📊",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<UserType | null>(null);
  // Until this flips true on the client we render nothing — avoids
  // a server/client mismatch from the localStorage read below.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // If the user already has a role stored, skip onboarding entirely.
    // Browsing back to "/" via the Switch-role button explicitly clears
    // userType first, so this only fires on a genuine "already onboarded"
    // visit.
    const existingType = window.localStorage.getItem(USER_TYPE_KEY);
    if (
      existingType === "student" ||
      existingType === "faculty" ||
      existingType === "provost"
    ) {
      router.replace(ROLE_HOME_PATH[existingType]);
      return;
    }

    // Pre-fill the name field if the user has been here before.
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
    // Brief blank state while we decide whether to redirect or render.
    return <main className="min-h-screen" />;
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="glass-card w-full max-w-2xl p-8 sm:p-12"
      >
        <header className="mb-8">
          <p className="text-[11px] sm:text-xs text-indigo-400 uppercase tracking-[0.22em] mb-3">
            Lecture Intelligence
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            How are you using this today?
          </h1>
        </header>

        {/* Optional name */}
        <section className="mb-7">
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
                  // Spec calls for CSS-only transitions on these cards (not
                  // Framer) for performance — they re-render on every
                  // selection change.
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
