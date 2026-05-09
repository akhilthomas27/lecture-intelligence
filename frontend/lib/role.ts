// Tiny localStorage facade for the onboarding role flow.
// Used by every page that needs to know who the user is, route them
// correctly, or reset them back to onboarding.

export type UserType = "student" | "faculty" | "provost";

export const USER_TYPE_KEY = "userType";
export const USER_NAME_KEY = "userName";

export const ROLE_HOME_PATH: Record<UserType, string> = {
  student: "/student",
  faculty: "/faculty",
  provost: "/provost",
};

export function getStoredUserType(): UserType | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_TYPE_KEY);
  return raw === "student" || raw === "faculty" || raw === "provost"
    ? raw
    : null;
}

export function getStoredUserName(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_NAME_KEY);
  return raw && raw.trim() ? raw.trim() : null;
}

export function setStoredUserType(t: UserType): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_TYPE_KEY, t);
}

export function setStoredUserName(name: string): void {
  if (typeof window === "undefined") return;
  const trimmed = name.trim();
  if (trimmed) window.localStorage.setItem(USER_NAME_KEY, trimmed);
  else window.localStorage.removeItem(USER_NAME_KEY);
}

export function clearStoredUserType(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(USER_TYPE_KEY);
}
