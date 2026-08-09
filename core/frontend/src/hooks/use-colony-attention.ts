import { useSyncExternalStore } from "react";
import { userStorage } from "@/lib/userStorage";

/**
 * Per-colony attention bookkeeping for the sidebar "needs you" badge.
 * Mirrors use-queen-attention.ts but keyed by colonyId; see that file
 * for the full rationale on the badgeAt/seenAt rising-edge model.
 *
 * When a colony's queen session flips awaiting_input from false → true,
 * the colony's sidebar entry should badge — until the user actually
 * visits the colony route while it's still awaiting.
 */
const STORAGE_KEY = "colonyAttention";

interface PersistedAttention {
  badgeAt: Record<string, number>;
  seenAt: Record<string, number>;
}

const badgeAt = new Map<string, number>();
const seenAt = new Map<string, number>();
const prevWaiting = new Map<string, boolean>();
const listeners = new Set<() => void>();

let hydrated = false;
function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  const stored = userStorage.get<PersistedAttention>(STORAGE_KEY, {
    badgeAt: {},
    seenAt: {},
  });
  for (const [k, v] of Object.entries(stored.badgeAt ?? {})) {
    if (typeof v === "number") badgeAt.set(k, v);
  }
  for (const [k, v] of Object.entries(stored.seenAt ?? {})) {
    if (typeof v === "number") seenAt.set(k, v);
  }
}

function persist(): void {
  userStorage.set<PersistedAttention>(STORAGE_KEY, {
    badgeAt: Object.fromEntries(badgeAt),
    seenAt: Object.fromEntries(seenAt),
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const emit = () => listeners.forEach((l) => l());

export function noteColonyWaitingEdge(colonyId: string, rawWaiting: boolean): void {
  hydrate();
  const wasWaiting = prevWaiting.get(colonyId);
  if (wasWaiting === undefined) {
    prevWaiting.set(colonyId, rawWaiting);
    return;
  }
  if (rawWaiting === wasWaiting) return;
  prevWaiting.set(colonyId, rawWaiting);
  if (rawWaiting) {
    badgeAt.set(colonyId, Date.now());
    persist();
    emit();
  }
}

export function markColonySeen(colonyId: string): void {
  hydrate();
  seenAt.set(colonyId, Date.now());
  persist();
  emit();
}

export function useShouldBadgeColony(colonyId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      hydrate();
      return (badgeAt.get(colonyId) ?? 0) > (seenAt.get(colonyId) ?? 0);
    },
    () => false,
  );
}
