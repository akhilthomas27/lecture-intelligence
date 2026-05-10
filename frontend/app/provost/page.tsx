"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import ProvostInputCard from "@/components/ProvostInputCard";
import SwitchRoleButton from "@/components/SwitchRoleButton";
import { getStoredUserName } from "@/lib/role";

export default function FacultyPage() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    setName(getStoredUserName());
  }, []);

  return (
    <main className="min-h-screen flex flex-col" style={{ position: "relative" }}>

      {/* Top left — Logo */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 24,
          zIndex: 10,
        }}
      >
        <Image
          src="/logo.png"
          alt="Lecture Intelligence"
          width={100}
          height={100}
          style={{ objectFit: "contain", borderRadius: 0 }}
          priority
        />
      </div>

      {/* Top center — Name or Wordmark */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 0,
          right: 0,
          zIndex: 10,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 10,
          pointerEvents: "none",
        }}
      >

        {/* Name or wordmark */}
        {name ? (
          <span style={{ fontSize: 14, color: "rgba(255,255,255,0.6)" }}>
            Hi,{" "}
            <span style={{ color: "#ffffff", fontWeight: 700 }}>
              {name}
            </span>
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
            Hi,{" "}
            <span style={{ color: "#ffffff" }}>Guest</span>
          </span>
        )}
      </div>

      {/* Top right — Switch role */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 24,
          zIndex: 10,
        }}
      >
        <SwitchRoleButton />
      </div>

      {/* Centered content */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6">
        <ProvostInputCard/>
      </div>
    </main>
  );
}