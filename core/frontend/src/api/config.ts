import { api } from "./client";

export interface SubscriptionInfo {
  id: string;
  name: string;
  description: string;
  provider: string;
  flag: string;
  default_model: string;
  api_base?: string;
}

export interface LLMConfig {
  provider: string;
  model: string;
  has_api_key: boolean;
  max_tokens: number | null;
  max_context_tokens: number | null;
  connected_providers: string[];
  active_subscription: string | null;
  detected_subscriptions: string[];
  subscriptions: SubscriptionInfo[];
}

export interface LLMConfigUpdateResponse {
  provider: string;
  model: string;
  has_api_key: boolean;
  max_tokens: number;
  max_context_tokens: number;
  sessions_swapped: number;
  active_subscription: string | null;
}

export interface ModelOption {
  id: string;
  label: string;
  recommended: boolean;
  max_tokens: number;
  max_context_tokens: number;
}

export interface ModelsCatalogue {
  models: Record<string, ModelOption[]>;
}

export interface RateLimitEntry {
  platform: string;
  action_type: string;
  min_delay_s: number;
  hourly?: number;
  hourly_max?: number;
  hourly_default?: number;
  daily?: number;
  daily_max?: number;
  daily_default?: number;
  weekly?: number;
  weekly_max?: number;
  weekly_default?: number;
}

export interface FeaturesConfig {
  /** Colony-adaptive worker tool budgets (Developer options toggle). */
  adaptive_tool_budget: boolean;
  /**
   * Email senders — the sender pool, rotation and send tools (Developer
   * options toggle). Off by default. Also gates whether the runtime registers
   * the sender tools with the MCP server, so this is what hides the feature
   * from the agent, not just from the UI. See useEmailSendersEnabled.
   */
  email_senders: boolean;
}

export const configApi = {
  getLLMConfig: () => api.get<LLMConfig>("/config/llm"),

  getFeatures: () => api.get<{ features: FeaturesConfig }>("/config/features"),

  /**
   * Persists to configuration.json (new sessions) and hot-applies to
   * running colonies; colonies with a per-colony metadata pin keep it.
   */
  setFeatures: (features: Partial<FeaturesConfig>) =>
    api.put<{ features: Partial<FeaturesConfig>; colonies_applied: number }>(
      "/config/features",
      { features },
    ),

  setLLMConfig: (provider: string, model: string) =>
    api.put<LLMConfigUpdateResponse>("/config/llm", { provider, model }),

  activateSubscription: (subscriptionId: string) =>
    api.put<LLMConfigUpdateResponse>("/config/llm", { subscription: subscriptionId }),

  getModels: () => api.get<ModelsCatalogue>("/config/models"),

  getProfile: () =>
    api.get<{
      displayName: string;
      about: string;
      theme: string;
      /** True when an avatar.{jpg|png|webp} exists in the hive config dir. */
      has_avatar?: boolean;
      prompt_library_sort?: { my?: string; community?: string } | null;
    }>("/config/profile"),

  setProfile: (
    displayName?: string,
    about?: string,
    theme?: string,
    density?: string,
    promptLibrarySort?: { my?: string; community?: string },
  ) =>
    api.put<{
      displayName: string;
      about: string;
      theme: string;
      prompt_library_sort?: { my?: string; community?: string } | null;
    }>("/config/profile", {
      // Each field is only included when explicitly supplied — the runtime
      // treats present-but-empty as authoritative ("set to empty"), so
      // theme/density toggles can't be allowed to send "" for displayName.
      ...(displayName !== undefined ? { displayName } : {}),
      ...(about !== undefined ? { about } : {}),
      ...(theme ? { theme } : {}),
      ...(density ? { density } : {}),
      ...(promptLibrarySort ? { prompt_library_sort: promptLibrarySort } : {}),
    }),

  getRateLimits: () =>
    api.get<{ limits: RateLimitEntry[] }>("/config/rate-limits"),

  setRateLimits: (limits: Record<string, number>) =>
    api.put<{ limits: RateLimitEntry[]; warnings?: string[] }>("/config/rate-limits", { limits }),

  uploadAvatar: (file: Blob) => {
    const fd = new FormData();
    fd.append("avatar", file);
    return api.upload<{ avatar_url: string }>("/config/profile/avatar", fd);
  },
};
