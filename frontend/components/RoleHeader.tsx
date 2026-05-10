"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getStoredUserName } from "@/lib/role";
import SwitchRoleButton from "@/components/SwitchRoleButton";

export default function RoleHeader({
  children,
}: {
  children?: React.ReactNode;
}) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(getStoredUserName());
  }, []);

  return (
    <header className="flex items-center gap-3">
      {/* Logo */}
      <Image
        src="/logo.png"
        alt="Lecture Intelligence"
        width={36}
        height={36}
        style={{ objectFit: "contain", borderRadius: 8 }}
        priority
      />

      {/* Greeting or wordmark */}
      <div className="text-xs sm:text-sm">
        {name ? (
          <span className="text-white/60">
            Hi,{" "}
            <span className="text-white font-semibold">{name}</span>
          </span>
        ) : (
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#ffffff",
              letterSpacing: "-0.01em",
            }}
          >
            Lecture{" "}
            <span style={{ color: "#6366f1" }}>Intelligence</span>
          </span>
        )}
      </div>

      {/* Gap between wordmark and switch role */}
      <div style={{ width: 12 }} />

      {/* Children + switch role */}
      {children}
      <SwitchRoleButton />
    </header>
  );
}