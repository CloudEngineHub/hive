import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentEvent } from "@/api/types";

/** Lightweight snapshot of the replay state machine used by the
 * debug panel. Avoids passing the full ReplayState object (which
 * contains mutable Maps/Sets and tool row content that could grow
 * large). */
export interface DebugReplaySnapshot {
  turnCounters: Record<string, number>;
  toolTrackers: number;
  seenSeqsSize: number;
  snapshotSeq: number;
}

export interface DebugState {
  /** Last 30 SSE events (newest first). */
  events: AgentEvent[];
  pushEvent: (event: AgentEvent) => void;
  /** Current replay state snapshot (updated after each event). */
  replay: DebugReplaySnapshot | null;
  setReplay: (r: DebugReplaySnapshot | null) => void;
}

const DebugStateContext = createContext<DebugState>({
  events: [],
  pushEvent: () => {},
  replay: null,
  setReplay: () => {},
});

export function DebugStateProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const eventsRef = useRef<AgentEvent[]>([]);
  const [replay, setReplay] = useState<DebugReplaySnapshot | null>(null);

  const pushEvent = useCallback((event: AgentEvent) => {
    eventsRef.current = [event, ...eventsRef.current].slice(0, 30);
    setEvents(eventsRef.current);
  }, []);

  return (
    <DebugStateContext.Provider value={{ events, pushEvent, replay, setReplay }}>
      {children}
    </DebugStateContext.Provider>
  );
}

export function useDebugState() {
  return useContext(DebugStateContext);
}
