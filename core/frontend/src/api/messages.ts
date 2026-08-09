import { api } from "./client";

export const messagesApi = {
  /** Classify a home-screen prompt into a queen AND a colony name in one LLM
   *  call. Used by the new-chat flow to spin up a colony session directly.
   *  `activeQueenIds` restricts routing to the user's active roster; the
   *  runtime falls back to the full catalog when it's empty. */
  classifyColony: (message: string, activeQueenIds?: string[]) =>
    api.post<{ queen_id: string; colony_name: string; reason: string }>(
      "/messages/classify-colony",
      { message, active_queen_ids: activeQueenIds },
    ),
};
