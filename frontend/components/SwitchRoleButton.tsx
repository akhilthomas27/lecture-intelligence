"use client";

import { useRouter } from "next/navigation";
import { clearStoredUserType } from "@/lib/role";

/**
 * Top-right "Switch role" link that wipes the stored user type and
 * sends the user back to the onboarding page where they can re-pick.
 * The stored userName is preserved — we only clear the role.
 *
 * Visual: minimal — gray text, no background, hover turns white. A small
 * arrow glyph nudges right on hover so the affordance is obvious without
 * adding chrome.
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
      className="group inline-flex items-center gap-1.5 text-xs sm:text-sm text-white/50 hover:text-white transition-colors px-2 py-1"
    >
      <span>Switch role</span>
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        className="transition-transform duration-150 group-hover:translate-x-0.5"
        aria-hidden
      >
        <path d="M3 6h6M6.5 3.5L9 6 6.5 8.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
