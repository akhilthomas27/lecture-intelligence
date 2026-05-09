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
    blurb: "Turn lectures into a complete study environment with notes, flashcards, and Q&A.",
    emoji: "🎓",
  },
  {
    type: "faculty",
    title: "Faculty",
    blurb: "Get private, actionable feedback on your lecture before it goes live.",
    emoji: "🧑‍🏫",
  },
  {
    type: "provost",
    title: "Provost",
    blurb: "Verify your course is delivering on its stated learning objectives.",
    emoji: "📚",
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
    <main className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-3xl"
      >
        <header className="text-center mb-10">
          <p className="uppercase tracking-[0.2em] text-xs text-indigo-400 mb-3">
            Lecture Intelligence
          </p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-3 bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent">
            Welcome
          </h1>
          <p className="text-slate-400 text-base sm:text-lg">
            Let&apos;s set up your workspace.
          </p>
        </header>

        {/* Optional name */}
        <section className="mb-8">
          <label
            htmlFor="user-name"
            className="block text-sm text-slate-300 mb-2"
          >
            What should we call you?{" "}
            <span className="text-slate-600 text-xs">(optional)</span>
          </label>
          <input
            id="user-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="given-name"
            className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none transition-all placeholder:text-slate-600"
          />
        </section>

        {/* Mandatory role selection */}
        <section className="mb-8">
          <p className="text-sm text-slate-300 mb-3">
            What best describes you?
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {ROLE_CARDS.map((card, i) => (
              <motion.button
                key={card.type}
                type="button"
                onClick={() => setSelected(card.type)}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.08 }}
                whileHover={{ y: -2 }}
                className={`text-left p-5 rounded-xl border transition-colors ${
                  selected === card.type
                    ? "border-indigo-500 bg-indigo-500/10"
                    : "border-slate-800 bg-slate-900 hover:border-slate-700"
                }`}
                aria-pressed={selected === card.type}
              >
                <div className="text-2xl mb-2">{card.emoji}</div>
                <h3 className="font-semibold text-slate-100 mb-1">
                  {card.title}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {card.blurb}
                </p>
              </motion.button>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={handleContinue}
          disabled={!selected}
          className="w-full px-5 py-4 rounded-xl bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-semibold transition-colors"
        >
          Continue
        </button>
      </motion.div>
    </main>
  );
}
