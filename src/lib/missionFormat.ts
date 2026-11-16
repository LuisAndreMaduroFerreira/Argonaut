import type { Cadence } from "../types";

export const CADENCE_LABELS: Record<Cadence, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

const STREAK_UNITS: Record<Cadence, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

export function streakLabel(streak: number, cadence: Cadence): string | null {
  return streak >= 2 ? `${streak}-${STREAK_UNITS[cadence]} streak` : null;
}

export function timeLeft(endsAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ${hours % 24}h`;
  return `${days} days`;
}
