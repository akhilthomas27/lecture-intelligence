"use client";

import { useEffect, useState } from "react";
import { getStoredUserName } from "@/lib/role";
import SwitchRoleButton from "@/components/SwitchRoleButton";

/**
 * Shared top bar for every role-scoped page.
 *
 * Left:  "Hi, {name}" if a userName is in localStorage, otherwise empty.
 * Right: "Switch role" button.
 *
 * Children render between the two (e.g. a small badge).
 */
export default function RoleHeader({
  children,
}: {
  children?: React.ReactNode;
}) {
  // localStorage isn't available during SSR — defer the read to the client
  // so the server-rendered HTML matches what the browser eventually shows.
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(getStoredUserName());
  }, []);

  return (
    <header className="flex items-center justify-between gap-3 mb-6 sm:mb-8 max-w-7xl mx-auto">
      <div className="text-xs sm:text-sm text-slate-400 truncate">
        {name ? <>Hi, <span className="text-slate-100">{name}</span></> : null}
      </div>
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {children}
        <SwitchRoleButton />
      </div>
    </header>
  );
}
