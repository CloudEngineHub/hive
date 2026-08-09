import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Eye, EyeOff, Check, Pencil, ChevronDown, Zap, ThumbsUp, Loader2,
  AlertCircle, Camera, LogOut, ExternalLink, CreditCard, BarChart3,
  Link2, KeyRound, Users, Shield, Bell, Gift, User, PlayCircle, Sparkles,
} from "lucide-react";
import { useTutorial } from "./Tutorial/TutorialOverlay";
import { apiUrl } from "@/api/client";
import { useColony } from "@/context/ColonyContext";
import { useTheme } from "@/context/ThemeContext";
import { useMe } from "@/lib/me";
import { useModel, LLM_PROVIDERS } from "@/context/ModelContext";
import { credentialsApi } from "@/api/credentials";
import { configApi, type ModelOption, type RateLimitEntry } from "@/api/config";
import { compressImage } from "@/lib/image-utils";
import { useShowRuntimeLogs } from "@/hooks/use-show-runtime-logs";
import McpServersPanel from "./McpServersPanel";
import { Switch } from "./Switch";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialSection?: "profile" | "byok" | "mcp" | "cloud";
}

function ValidationBadge({ state }: { state: "validating" | { valid: boolean | null; message: string } | undefined }) {
  if (!state) return <StatusText icon={<Check className="w-3 h-3" />} color="green">Connected</StatusText>;
  if (state === "validating") return <StatusText icon={<Loader2 className="w-3 h-3 animate-spin" />} color="muted">Verifying...</StatusText>;
  if (state.valid === false) return <StatusText icon={<AlertCircle className="w-3 h-3" />} color="red" title={state.message}>Invalid key</StatusText>;
  if (state.valid === true) return <StatusText icon={<Check className="w-3 h-3" />} color="green">Verified</StatusText>;
  return <StatusText icon={<Check className="w-3 h-3" />} color="green">Connected</StatusText>;
}

function StatusText({ icon, color, title, children }: { icon: React.ReactNode; color: "green" | "red" | "muted"; title?: string; children: React.ReactNode }) {
  const cls = color === "green" ? "text-green-500" : color === "red" ? "text-red-400" : "text-muted-foreground";
  return <span className={`flex items-center gap-1 text-xs font-medium ${cls}`} title={title}>{icon}{children}</span>;
}

export default function SettingsModal({ open, onClose, initialSection }: SettingsModalProps) {
  const { userProfile, setUserProfile, userAvatarVersion, bumpUserAvatar, userHasAvatar } = useColony();
  const { theme, setTheme, density, setDensity } = useTheme();
  const { me, refresh: refreshMe } = useMe();
  const {
    currentProvider, currentModel, connectedProviders, availableModels,
    setModel, saveProviderKey, subscriptions, detectedSubscriptions,
    activeSubscription, activateSubscription,
  } = useModel();

  const [displayName, setDisplayName] = useState(
    me?.user?.full_name ?? userProfile.displayName,
  );
  const [about, setAbout] = useState(userProfile.about);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"profile" | "byok" | "mcp" | "cloud" | "help" | "developer" | "rate-limits">(initialSection || "profile");
  const [showRuntimeLogs, setShowRuntimeLogs] = useShowRuntimeLogs();
  // null = not yet loaded from the runtime (Switch renders disabled until
  // the GET resolves). Loaded lazily on first visit to the Developer tab.
  const [adaptiveBudget, setAdaptiveBudget] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open || activeSection !== "developer" || adaptiveBudget !== null) return;
    configApi
      .getFeatures()
      .then((r) => setAdaptiveBudget(r.features.adaptive_tool_budget))
      .catch(() => setAdaptiveBudget(true));
  }, [open, activeSection, adaptiveBudget]);
  const [rateLimits, setRateLimits] = useState<RateLimitEntry[] | null>(null);
  const [rateLimitDirty, setRateLimitDirty] = useState<Record<string, number>>({});
  const [rateLimitSaving, setRateLimitSaving] = useState(false);
  const [rateLimitWarnings, setRateLimitWarnings] = useState<string[]>([]);
  useEffect(() => {
    if (!open || activeSection !== "rate-limits" || rateLimits !== null) return;
    configApi
      .getRateLimits()
      .then((r) => setRateLimits(r.limits))
      .catch(() => setRateLimits([]));
  }, [open, activeSection, rateLimits]);
  const { start: startTour } = useTutorial();
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<Record<string, "validating" | { valid: boolean | null; message: string }>>({});
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [densityDropdownOpen, setDensityDropdownOpen] = useState(false);
  const avatarUrl = apiUrl(`/config/profile/avatar?v=${userAvatarVersion}`);
  // Start "failed" when the runtime says no avatar exists — that way we
  // render initials immediately without firing an `<img>` request.
  const [avatarFailed, setAvatarFailed] = useState(!userHasAvatar);
  useEffect(() => {
    setAvatarFailed(!userHasAvatar);
  }, [userAvatarVersion, userHasAvatar]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const themeDropdownRef = useRef<HTMLDivElement>(null);
  const densityDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!themeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node))
        setThemeDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [themeDropdownOpen]);

  useEffect(() => {
    if (!densityDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (densityDropdownRef.current && !densityDropdownRef.current.contains(e.target as Node))
        setDensityDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [densityDropdownOpen]);

  useEffect(() => {
    if (open) {
      setDisplayName(me?.user?.full_name ?? userProfile.displayName);
      setAbout(userProfile.about);
      setNameError(null);
      if (initialSection) setActiveSection(initialSection);
    }
  }, [open, me, userProfile, initialSection]);

  if (!open) return null;

  const profileDirty =
    displayName !== (me?.user?.full_name ?? userProfile.displayName) ||
    about !== userProfile.about;

  const handleSave = async () => {
    const trimmedName = displayName.trim();
    const trimmedAbout = about.trim();
    setNameError(null);

    if (trimmedName && (trimmedName.length < 1 || trimmedName.length > 120)) {
      setNameError("Name must be 1–120 characters.");
      return;
    }

    setSavingName(true);
    try {
      // Persist the profile to the local runtime (no cloud account).
      await configApi.setProfile(trimmedName, trimmedAbout);
    } catch {
      setSavingName(false);
      setNameError("Could not update profile.");
      return;
    }
    setSavingName(false);
    void refreshMe();

    setUserProfile({ displayName: trimmedName, about: trimmedAbout });
    onClose();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    e.target.value = "";
    setUploadingAvatar(true);
    try {
      const compressed = await compressImage(file);
      await configApi.uploadAvatar(compressed);
      bumpUserAvatar();
      setAvatarFailed(false);
    } catch {}
    setUploadingAvatar(false);
  };

  const clearValidation = (providerId: string) => {
    setTimeout(() => setValidation((v) => { const next = { ...v }; delete next[providerId]; return next; }), 4000);
  };

  const handleSaveKey = async (providerId: string) => {
    const trimmedKey = keyInput.trim();
    if (!trimmedKey) return;
    setSaving(true);
    setValidation((v) => ({ ...v, [providerId]: "validating" }));

    const validateResult = await credentialsApi
      .validateKey(providerId, trimmedKey)
      .catch(() => ({ valid: null as boolean | null, message: "Could not verify key" }));

    if (validateResult.valid === false) {
      setSaving(false);
      setValidation((v) => ({ ...v, [providerId]: { valid: false, message: validateResult.message } }));
      clearValidation(providerId);
      return;
    }

    try {
      await saveProviderKey(providerId, trimmedKey);
    } catch {
      setSaving(false);
      setValidation((v) => ({ ...v, [providerId]: { valid: false, message: "Failed to save key" } }));
      clearValidation(providerId);
      return;
    }

    setSaving(false);
    setEditingProvider(null);
    setKeyInput("");
    setShowKey(false);
    setValidation((v) => ({ ...v, [providerId]: { valid: validateResult.valid, message: validateResult.message } }));
    clearValidation(providerId);
  };

  const handleSelectModel = async (provider: string, modelId: string) => {
    try { await setModel(provider, modelId); setModelDropdownOpen(false); } catch {}
  };

  const handleActivateSubscription = async (subId: string) => {
    try { await activateSubscription(subId); } catch {}
  };

  const initials = displayName.trim().split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const activeSubInfo = activeSubscription ? subscriptions.find((s) => s.id === activeSubscription) : null;
  const providerForModels = activeSubInfo?.provider || currentProvider;
  const modelsForLabel = availableModels[providerForModels] || [];
  const currentModelLabel = modelsForLabel.find((m) => m.id === currentModel)?.label || currentModel || "Not configured";

  const currentProviderName = activeSubscription
    ? (subscriptions.find((s) => s.id === activeSubscription)?.name || currentProvider)
    : (LLM_PROVIDERS.find((p) => p.id === currentProvider)?.name || currentProvider);

  const selectableProviders = LLM_PROVIDERS.filter(
    (p) => connectedProviders.has(p.id) && availableModels[p.id]?.length,
  );

  const startEditing = (providerId: string) => {
    setEditingProvider(providerId);
    setKeyInput("");
    setShowKey(false);
  };

  const cancelEditing = () => {
    setEditingProvider(null);
    setKeyInput("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-card border border-border/60 rounded-xl shadow-2xl w-full max-w-[680px] h-[500px] max-h-[80vh] flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-[156px] flex-shrink-0 border-r border-border/40 py-4 px-2 flex flex-col gap-4">
          <h2 className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.12em] px-2.5">Settings</h2>
          <div className="flex flex-col gap-0.5">
            <p className="text-[9.5px] font-semibold text-muted-foreground/50 uppercase tracking-wider px-2.5 mb-0.5">Account</p>
            <button
              onClick={() => setActiveSection("profile")}
              className={`text-left text-xs px-2.5 py-1.5 rounded-md transition-colors ${activeSection === "profile" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
            >
              Profile
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-[9.5px] font-semibold text-muted-foreground/50 uppercase tracking-wider px-2.5 mb-0.5">System</p>
            <button
              onClick={() => setActiveSection("byok")}
              className={`text-left text-xs px-2.5 py-1.5 rounded-md transition-colors ${activeSection === "byok" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
            >
              AI Model
            </button>
            <button
              onClick={() => setActiveSection("rate-limits")}
              className={`text-left text-xs px-2.5 py-1.5 rounded-md transition-colors ${activeSection === "rate-limits" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
            >
              Rate Limits
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-[9.5px] font-semibold text-muted-foreground/50 uppercase tracking-wider px-2.5 mb-0.5">Cloud</p>
            <button
              onClick={() => setActiveSection("cloud")}
              className={`text-left text-xs px-2.5 py-1.5 rounded-md transition-colors ${activeSection === "cloud" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
            >
              Dashboard
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-[9.5px] font-semibold text-muted-foreground/50 uppercase tracking-wider px-2.5 mb-0.5">Help</p>
            <button
              onClick={() => setActiveSection("help")}
              className={`text-left text-xs px-2.5 py-1.5 rounded-md transition-colors ${activeSection === "help" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
            >
              Walkthrough
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-[9.5px] font-semibold text-muted-foreground/50 uppercase tracking-wider px-2.5 mb-0.5">Advanced</p>
            <button
              onClick={() => setActiveSection("developer")}
              className={`text-left text-xs px-2.5 py-1.5 rounded-md transition-colors ${activeSection === "developer" ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
            >
              Developer
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0">
          <button onClick={onClose} className="absolute top-3 right-3 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50">
            <X className="w-3.5 h-3.5" />
          </button>

          <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 flex flex-col gap-5">
            {activeSection === "profile" && (
              <>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Profile</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    How you appear in Hive, plus your plan, workspace, and account.
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider mb-1.5 block">
                    Display name <span className="text-primary normal-case">*</span>
                  </label>
                  <div className="flex items-center gap-2.5">
                    <div className="relative group flex-shrink-0">
                      <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center overflow-hidden">
                        {!avatarFailed ? (
                          <img src={avatarUrl} alt="" className="w-full h-full object-cover" onError={() => setAvatarFailed(true)} />
                        ) : (
                          <span className="text-[11px] font-bold text-primary">{initials || "?"}</span>
                        )}
                      </div>
                      <button
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={uploadingAvatar}
                        className="absolute inset-0 w-9 h-9 rounded-full flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 cursor-pointer"
                        title="Change photo"
                      >
                        {uploadingAvatar ? <Loader2 className="w-3 h-3 text-white animate-spin" /> : <Camera className="w-3 h-3 text-white" />}
                      </button>
                      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                    </div>
                    <input
                      type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Display name"
                      maxLength={120}
                      disabled={savingName}
                      className="flex-1 h-8 bg-muted/30 border border-border/50 rounded-md px-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
                    />
                  </div>
                  {nameError && (
                    <p className="text-[11px] text-red-500 mt-1.5 ml-[2.875rem]">{nameError}</p>
                  )}
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider mb-1.5 block">
                    About <span className="normal-case tracking-normal font-normal text-muted-foreground/60">— your queens remember this</span>
                  </label>
                  <textarea
                    value={about} onChange={(e) => setAbout(e.target.value)}
                    placeholder="Your role, company, what you're working on" rows={3}
                    className="w-full bg-muted/30 border border-border/50 rounded-md px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none leading-relaxed"
                  />
                  {profileDirty && (
                    <div className="flex justify-end mt-2 animate-in fade-in duration-150">
                      <button
                        onClick={() => void handleSave()}
                        disabled={savingName}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-60"
                      >
                        {savingName && <Loader2 className="w-3 h-3 animate-spin" />}
                        Save
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-border/50 bg-muted/10 px-2.5 py-2">
                  <p className="text-[9.5px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1">
                    Appearance
                  </p>
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[13px] text-foreground">Theme</span>
                    <div className="relative" ref={themeDropdownRef}>
                      <button onClick={() => setThemeDropdownOpen(!themeDropdownOpen)}
                        className="flex items-center gap-1.5 h-7 bg-muted/30 border border-border/50 rounded-md px-2.5 text-xs text-foreground hover:bg-muted/40">
                        {theme === "light" ? "Light" : "Dark"}
                        <ChevronDown className={`w-3 h-3 text-muted-foreground ${themeDropdownOpen ? "rotate-180" : ""}`} />
                      </button>
                      {themeDropdownOpen && (
                        <div className="absolute right-0 top-full mt-1 bg-card border border-border/60 rounded-md shadow-lg z-10 min-w-[110px] overflow-hidden">
                          {(["light", "dark"] as const).map((option) => (
                            <button key={option} onClick={() => { setTheme(option); setThemeDropdownOpen(false); }}
                              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${theme === option ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/30"}`}>
                              {theme === option ? <Check className="w-3 h-3 flex-shrink-0" /> : <span className="w-3" />}
                              <span>{option === "light" ? "Light" : "Dark"}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[13px] text-foreground">Density</span>
                    <div className="relative" ref={densityDropdownRef}>
                      <button onClick={() => setDensityDropdownOpen(!densityDropdownOpen)}
                        className="flex items-center gap-1.5 h-7 bg-muted/30 border border-border/50 rounded-md px-2.5 text-xs text-foreground hover:bg-muted/40">
                        {density === "compact" ? "Compact" : "Spacious"}
                        <ChevronDown className={`w-3 h-3 text-muted-foreground ${densityDropdownOpen ? "rotate-180" : ""}`} />
                      </button>
                      {densityDropdownOpen && (
                        <div className="absolute right-0 top-full mt-1 bg-card border border-border/60 rounded-md shadow-lg z-10 min-w-[140px] overflow-hidden">
                          {(["compact", "spacious"] as const).map((option) => (
                            <button key={option} onClick={() => { setDensity(option); setDensityDropdownOpen(false); }}
                              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${density === option ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/30"}`}>
                              {density === option ? <Check className="w-3 h-3 flex-shrink-0" /> : <span className="w-3" />}
                              <span>{option === "compact" ? "Compact" : "Spacious"}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </>
            )}

            {activeSection === "help" && (
              <>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Walkthrough</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Walk through the core Hive ideas in about a minute — queens, colonies,
                    credentials, and the memory/skills/tools knobs that shape every queen.
                  </p>
                </div>
                <button
                  onClick={() => {
                    onClose();
                    // Let the modal's close animation start before kicking off the
                    // spotlight so the dim layers don't fight each other on mount.
                    window.setTimeout(() => startTour(), 120);
                  }}
                  className="inline-flex items-center gap-2 self-start px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  Start walkthrough
                </button>
              </>
            )}

            {activeSection === "developer" && (
              <>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Developer</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Tools for inspecting Hive's internals. Off by default.
                  </p>
                </div>

                <div className="flex items-center justify-between rounded-md border border-border/50 bg-muted/10 px-3 py-2.5">
                  <div className="min-w-0 pr-3">
                    <p className="text-[12px] font-medium text-foreground">Runtime logs</p>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      Show the floating drawer in the bottom-right that streams stdout/stderr from the Electron main process.
                    </p>
                  </div>
                  <Switch checked={showRuntimeLogs} onChange={setShowRuntimeLogs} />
                </div>

                <div className="flex items-center justify-between rounded-md border border-border/50 bg-muted/10 px-3 py-2.5">
                  <div className="min-w-0 pr-3">
                    <p className="text-[12px] font-medium text-foreground">Adaptive worker budgets</p>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      Colonies learn a tool-call budget from their successful workers and wind down strugglers early.
                      Applies to running colonies too; colonies with an explicit per-colony setting keep it.
                    </p>
                  </div>
                  <Switch
                    checked={adaptiveBudget ?? true}
                    disabled={adaptiveBudget === null}
                    onChange={(next) => {
                      setAdaptiveBudget(next);
                      configApi
                        .setFeatures({ adaptive_tool_budget: next })
                        .catch(() => setAdaptiveBudget(!next));
                    }}
                  />
                </div>
              </>
            )}

            {activeSection === "rate-limits" && (
              <>
                <div>
                  <h3 className="text-base font-semibold text-foreground">Rate Limits</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Cap how many actions colonies can perform per platform to stay within safe usage thresholds.
                  </p>
                </div>

                {rateLimits === null ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading limits...
                  </div>
                ) : rateLimits.length === 0 ? (
                  <div className="rounded-md border border-border/50 bg-muted/10 px-3 py-4 text-center">
                    <p className="text-xs text-muted-foreground">
                      Could not load rate limits. Make sure the runtime is running.
                    </p>
                  </div>
                ) : (
                  <>
                    {Object.entries(
                      rateLimits.reduce<Record<string, RateLimitEntry[]>>((acc, entry) => {
                        (acc[entry.platform] ??= []).push(entry);
                        return acc;
                      }, {}),
                    ).map(([platform, entries]) => (
                      <div key={platform}>
                        <p className="text-[9.5px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5">
                          {platform === "linkedin" ? "LinkedIn" : platform === "x" ? "X (Twitter)" : platform}
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {entries.map((entry) => {
                            const prefix = `${entry.platform}.${entry.action_type}`;
                            const windows = (["hourly", "daily", "weekly"] as const).filter(
                              (w) => entry[`${w}_default` as keyof typeof entry] != null,
                            );
                            return (
                              <div key={prefix} className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
                                <p className="text-[12px] font-medium text-foreground capitalize mb-1">
                                  {entry.action_type.replace(/_/g, " ")}
                                </p>
                                <div className="flex items-center gap-3 flex-wrap">
                                  {(() => {
                                    let anyOver = false;
                                    const inputs = windows.map((w) => {
                                      const key = `${prefix}.${w}`;
                                      const val = rateLimitDirty[key] ?? (entry[w] as number);
                                      const ceiling = entry[`${w}_max` as keyof typeof entry] as number | undefined;
                                      const overCeiling = ceiling != null && val > ceiling;
                                      if (overCeiling) anyOver = true;
                                      return (
                                        <label key={w} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                          <span className="capitalize">{w}</span>
                                          <input
                                            type="number"
                                            min={1}
                                            value={val}
                                            onChange={(e) => {
                                              const v = parseInt(e.target.value, 10);
                                              if (!isNaN(v)) setRateLimitDirty((d) => ({ ...d, [key]: v }));
                                            }}
                                            className={`w-14 h-6 bg-muted/30 border rounded px-1.5 text-xs text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary/40 ${overCeiling ? "border-amber-500/70" : "border-border/50"}`}
                                          />
                                          <span className={`text-[10px] ${overCeiling ? "text-amber-500" : "text-muted-foreground/60"}`}>
                                            / {ceiling ?? "—"}
                                          </span>
                                        </label>
                                      );
                                    });
                                    return (
                                      <>
                                        {inputs}
                                        {anyOver && (
                                          <p className="w-full text-[10px] text-amber-500/90 mt-1">
                                            Exceeding the recommended limit increases the risk of account restrictions or bans.
                                          </p>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {Object.keys(rateLimitDirty).length > 0 && (
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          onClick={() => setRateLimitDirty({})}
                          className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/30 transition-colors"
                        >
                          Reset
                        </button>
                        <button
                          disabled={rateLimitSaving}
                          onClick={async () => {
                            setRateLimitSaving(true);
                            setRateLimitWarnings([]);
                            try {
                              const res = await configApi.setRateLimits(rateLimitDirty);
                              setRateLimits(res.limits);
                              setRateLimitDirty({});
                              if (res.warnings?.length) setRateLimitWarnings(res.warnings);
                            } catch {}
                            setRateLimitSaving(false);
                          }}
                          className="h-7 px-3 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                        >
                          {rateLimitSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                          Save
                        </button>
                      </div>
                    )}
                    {rateLimitWarnings.length > 0 && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 flex gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-[11px] text-amber-200/90 leading-relaxed">
                          <p className="font-medium text-amber-400 mb-0.5">Values above recommended maximums</p>
                          {rateLimitWarnings.map((w, i) => (
                            <p key={i}>{w}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {activeSection === "byok" && (
              <>
                <div>
                  <h3 className="text-base font-semibold text-foreground">AI Model</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Choose the model that powers your hive. Each is optimized for a different part of the workflow.
                  </p>
                </div>

                <div className="flex-shrink-0 flex flex-col gap-3">
                  <p className="text-[9.5px] font-semibold text-muted-foreground/60 uppercase tracking-wider -mb-1">
                    Hive lineup
                  </p>
                  <HiveModelCard
                    name="Hive 2.1"
                    badge="Default"
                    description="The core reasoning model behind every Queen Bee. Optimized for strategic planning, conversation, tool orchestration, and long-context decision-making. Best for single-agent tasks that require depth and nuance."
                    selected={!modelDropdownOpen}
                    onSelect={() => setModelDropdownOpen(false)}
                  />
                  <HiveModelCard
                    name="Hive-Swarm"
                    badge="Multi-Agent"
                    description="Purpose-built for colony operations where multiple Worker Bees run in parallel. Tuned for fast, focused sub-tasks — code generation, data extraction, web scraping — with lower latency and efficient token usage across swarms."
                    selected={modelDropdownOpen}
                    onSelect={() => setModelDropdownOpen(true)}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HiveModelCard({
  name,
  badge,
  description,
  selected,
  onSelect,
}: {
  name: string;
  badge: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-3 transition-all duration-150 ${
        selected
          ? "border-primary/40 bg-primary/[0.05] ring-1 ring-primary/20"
          : "border-border/60 bg-card hover:border-border hover:bg-muted/20"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selected ? "bg-primary shadow-[0_0_6px] shadow-primary/40" : "bg-muted-foreground/30"}`} />
        <span className="text-[13px] font-semibold text-foreground">{name}</span>
        <span className={`text-[9.5px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${
          selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        }`}>
          {badge}
        </span>
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted-foreground pl-[14px]">
        {description}
      </p>
    </button>
  );
}

