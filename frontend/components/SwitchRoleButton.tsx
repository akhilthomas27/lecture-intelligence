"use client";

import { useRouter } from "next/navigation";
import { clearStoredUserType } from "@/lib/role";

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
      className="group inline-flex items-center gap-1.5 text-xs sm:text-sm transition-colors px-3 py-1.5"
      style={{
        color: "#ffffff",
        fontWeight: 700,
        border: "1.5px solid rgb(255, 255, 255)",
        borderRadius: 8,
        background: "rgba(255, 255, 255, 0.05)",
        transition: "border-color 150ms ease, background 150ms ease",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#6366f1";
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(99, 102, 241, 0.1)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255, 255, 255, 0.4)";
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255, 255, 255, 0.05)";
      }}
    >
      <span>Switch role</span>
      
    </button>
  );
}