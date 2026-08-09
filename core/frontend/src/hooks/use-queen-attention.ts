import { useSyncExternalStore } from "react";
import { userStorage } from "@/lib/userStorage";

/**
 * Per-queen attention bookkeeping for the sidebar "needs you" badge.
 *
 * Two timestamps drive the badge:
 *   • ``badgeAt[queenId]`` — wall-clock of the most recent rising edge
 *     of awaiting_input (false → true). Bumped each time a fresh
 *     awaiting cycle begins.
 *   • ``seenAt[queenId]`` — wall-clock of the most recent moment the
 *     user was on this queen's page while it was awaiting input.
 *
 * Rule: the badge is visible iff ``rawWaiting`` is currently true AND
 * ``badgeAt > seenAt``.  Concretely:
 *
 *   1. Queen X starts awaiting → badgeAt set → badge shows.
 *   2. User opens Queen X while it's awaiting → seenAt set → badge
 *      silenced (seen >= badge).
 *   3. User leaves Queen X mid-cycle → no state change → badge stays
 *      silenced (the user already saw the question).
 *   4. Queen X completes awaiting then starts a new cycle → badgeAt
 *      bumped past the old seenAt → badge shows again.
 *   5. User was on Queen X while it was *working* (not awaiting), then
 *      leaves; X later starts awaiting → badgeAt > seenAt → badge
 *      shows. (This is the case the original ``seen`` flag got wrong.)
 *
 * Persistence: the two timestamp maps are mirrored to localStorage
 * (per-user, via ``userStorage``) so a refresh keeps the user's
 * "already saw it" state. ``prevWaiting`` is *not* persisted — on
 * first call after hydration we treat the unknown previous state as
 * continuity (no rising edge), which avoids spuriously re-bumping
 * ``badgeAt`` for a queen that was already mid-cycle when the user
 * refreshed.
 */
const STORAGE_KEY = "queenAttention";

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

/**
 * Record the current ``rawWaiting`` value for ``queenId`` and stamp
 * ``badgeAt`` on rising edges (false → true). Idempotent on repeat
 * calls with the same value, so it's safe to call from a useEffect
 * that runs on every ``rawWaiting`` render.
 *
 * The first call for a given queen after hydration is treated as
 * continuity (no edge), so reloading the page mid-await doesn't
 * reset the user's "I already saw it" state.
 */
export function noteWaitingEdge(queenId: string, rawWaiting: boolean): void {
  hydrate();
  const wasWaiting = prevWaiting.get(queenId);
  if (wasWaiting === undefined) {
    prevWaiting.set(queenId, rawWaiting);
    return;
  }
  if (rawWaiting === wasWaiting) return;
  prevWaiting.set(queenId, rawWaiting);
  if (rawWaiting) {
    badgeAt.set(queenId, Date.now());
    persist();
    emit();
  }
}

/**
 * Mark ``queenId`` as seen by the user *right now*. Call from a
 * useEffect when the user is on the queen's route and the queen is
 * awaiting input — this stamps ``seenAt`` past ``badgeAt`` and
 * silences the badge for the remainder of the current awaiting cycle.
 */
export function markQueenSeen(queenId: string): void {
  hydrate();
  seenAt.set(queenId, Date.now());
  persist();
  emit();
}

/**
 * Subscribe to the badge decision for a single queen. Returns true
 * iff the most recent badge edge happened after the user's last
 * "seen" stamp. Pair with the live ``rawWaiting`` flag at the call
 * site: ``isWaiting = rawWaiting && shouldBadge``.
 */
export function useShouldBadge(queenId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      hydrate();
      return (badgeAt.get(queenId) ?? 0) > (seenAt.get(queenId) ?? 0);
    },
    () => false,
  );
}
