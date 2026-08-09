import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { messagesApi } from "@/api/messages";
import { sessionsApi } from "@/api/sessions";
import { useColony } from "@/context/ColonyContext";
import { isQueenDecommissioned, useMe } from "@/lib/me";
import { slugToColonyId } from "@/lib/colony-registry";
import { userStorage } from "@/lib/userStorage";
import { PENDING_CLASSIFY_KEY } from "@/lib/routing-keys";

/**
 * Transient routing screen the user lands on right after submitting from the
 * home page. Reads the pending prompt from sessionStorage, runs a single LLM
 * call that picks both the best queen *and* a colony name, spins up a colony
 * session seeded with the prompt as its goal, and redirects (replace) to that
 * colony's page.
 *
 * The point of this page is to get the user out of the home screen *before*
 * the classify + create round-trip runs — they should never sit on the home
 * page watching a spinner.
 */
export { PENDING_CLASSIFY_KEY } from "@/lib/routing-keys";

export default function QueenRouting() {
  const navigate = useNavigate();
  const { colonies, queenProfiles, refresh } = useColony();
  const { me } = useMe();
  const [error, setError] = useState<string | null>(null);
  // Re-runs of this effect (StrictMode, fast re-mounts) must not re-fire the
  // classify/create calls — once we've grabbed the pending message we own it.
  const startedRef = useRef(false);
  // Snapshot the colony list once so the uniquifier doesn't depend on async
  // context refreshes (which would re-run the effect via the dep array).
  const coloniesRef = useRef(colonies);
  coloniesRef.current = colonies;
  // Same snapshot treatment for the active roster the classifier may pick
  // from. If profiles haven't loaded yet this is empty and the runtime falls
  // back to the full catalog.
  const activeQueenIdsRef = useRef<string[]>([]);
  activeQueenIdsRef.current = queenProfiles
    .filter((q) => !isQueenDecommissioned(me, q.id))
    .map((q) => q.id);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const pending = userStorage.session.get<string | null>(PENDING_CLASSIFY_KEY, null);
    if (pending !== null) userStorage.session.remove(PENDING_CLASSIFY_KEY);

    if (!pending || !pending.trim()) {
      navigate("/", { replace: true });
      return;
    }

    const trimmed = pending.trim();
    let cancelled = false;
    (async () => {
      try {
        const { queen_id, colony_name } = await messagesApi.classifyColony(
          trimmed,
          activeQueenIdsRef.current,
        );
        if (cancelled) return;

        // Avoid silently reusing an existing colony when the LLM (or the
        // fallback) proposes a name that's already taken — suffix until the
        // route id is free.
        const taken = new Set(coloniesRef.current.map((c) => c.id));
        let slug = colony_name;
        let colonyId = slugToColonyId(slug);
        for (let n = 2; taken.has(colonyId); n++) {
          slug = `${colony_name}_${n}`;
          colonyId = slugToColonyId(slug);
        }

        // Create the colony session with the prompt as its goal (sent to the
        // backend as initial_prompt), then land on the colony page. initialGoal
        // in route state drives the immediate typing indicator (matches the
        // Sidebar / queen-dm colony-create callers).
        const created = await sessionsApi.create({
          colonyId: slug,
          colonyGoal: trimmed,
          queenName: queen_id,
          initialPhase: "colony",
        });
        if (cancelled) return;
        refresh();
        const actualColonyId = slugToColonyId(created.colony_id ?? slug);
        navigate(`/colony/${actualColonyId}`, {
          replace: true,
          state: { initialGoal: trimmed },
        });
      } catch {
        if (cancelled) return;
        setError("Couldn't start your colony. Try again from the home screen.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, refresh]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="queen-debate-line text-sm">
          <span>The queens are debating who should take this on</span>
          <span aria-hidden="true">
            {[0, 1, 2].map((dot) => (
              <span key={dot}>.</span>
            ))}
          </span>
        </span>
      </div>
      {error && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => navigate("/", { replace: true })}
            className="text-xs text-muted-foreground hover:text-foreground border border-border/50 hover:border-primary/30 rounded-full px-3.5 py-1.5 transition-all"
          >
            Back to home
          </button>
        </div>
      )}
    </div>
  );
}
