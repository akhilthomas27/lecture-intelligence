"use client";

import { useRouter } from "next/navigation";
import { clearStoredUserType } from "@/lib/role";

/**
 * Top-right "Switch role" link that wipes the stored user type and
 * sends the user back to the onboarding page where they can re-pick.
 * The stored userName is preserved — we only clear the role.
 */
export default function SwitchRoleButton() {
  const router = useRouter();

  function handleClick() {
    clearStoredUserType();
    router.push("/");
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-xs sm:text-sm text-slate-500 hover:text-slate-200 transition-colors px-2.5 py-1 rounded-md border border-slate-800 hover:border-slate-600"
    >
      Switch role
    </button>
  );
}
