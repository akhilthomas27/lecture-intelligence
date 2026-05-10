"use client";

import { useEffect, useState } from "react";
import { getStoredUserName } from "@/lib/role";
import SwitchRoleButton from "@/components/SwitchRoleButton";

/**
 * Shared top bar for the input pages (student/faculty/provost).
 *
 * Visual: full-width strip outside the main glass card.
 *   Left:  "Hi, {name}" if a userName is in localStorage,
 *          otherwise the wordmark "Lecture Intelligence".
 *   Right: optional children (e.g. role pill) + "Switch role".
 *
 * Dashboards use a different `top-nav` styled bar — this is for input pages.
 */
export default function RoleHeader({
  children,
}: {
  children?: React.ReactNode;
}) {
  // localStorage isn't available during SSR — defer the read so the server-
  // rendered HTML matches what the browser eventually shows.
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(getStoredUserName());
  }, []);

  return (
    <header className="flex items-center justify-between gap-3 max-w-5xl mx-auto px-4 sm:px-6 py-5">
      <div className="text-xs sm:text-sm truncate">
        {name ? (
          <span className="text-white/60">
            Hi, <span className="text-white">{name}</span>
          </span>
        ) : (
          <span className="text-white/40 tracking-wide">
            Lecture Intelligence
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {children}
        <SwitchRoleButton />
      </div>
    </header>
  );
}
