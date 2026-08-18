import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Pencil, Plus, X } from "lucide-react";
import { configApi, type LlmRole, type LlmSection } from "@/api/config";
import { useModel } from "@/context/ModelContext";
import { ApiError } from "@/api/client";

/**
 * Verbatim editor over configuration.json's three provider slots
 * (llm / worker_llm / vision_fallback). There is deliberately NO parallel
 * representation: read = the section as stored, save = the section as
 * typed (unknown keys included). The file and this UI cannot diverge
 * because there is nothing in between.
 */

const ROLES: LlmRole[] = ["llm", "worker_llm", "vision_fallback"];
const ROLE_TITLE: Record<LlmRole, string> = {
  llm: "LLM (main)",
  worker_llm: "Worker",
  vision_fallback: "Vision fallback",
};
const ROLE_HINT: Record<LlmRole, string> = {
  llm: "Powers every queen session. Always set.",
  worker_llm: "Colony workers. Cleared → workers use the main LLM.",
  vision_fallback: "Captions images when the main model has no vision.",
};

const TEMPLATE: LlmSection = {
  provider: "openai",
  model: "model-id",
  api_base: "https://api.example.com/v1",
  api_key: "sk-...",
  max_tokens: 8196,
  max_context_tokens: 100000,
};

function keyLabel(s: LlmSection): string {
  const key = typeof s.api_key === "string" ? s.api_key : "";
  if (key) return "key ****" + key.slice(-4);
  if (s.api_key_env_var) return `key from $${s.api_key_env_var}`;
  return "no key";
}

export default function ProviderManager() {
  const { refresh } = useModel();
  const [sections, setSections] = useState<Record<LlmRole, LlmSection | null>>({
    llm: null,
    worker_llm: null,
    vision_fallback: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyRole, setBusyRole] = useState<LlmRole | null>(null);
  // Editor over ONE slot's JSON. null = closed.
  const [editor, setEditor] = useState<{ role: LlmRole; text: string } | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSections(await configApi.getLlmSections());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // configuration.json is hand-editable — mirror out-of-band edits whenever
  // the window regains focus (edit in your editor, switch back, current).
  // Skipped while the JSON editor is open so a refetch can't clobber text.
  useEffect(() => {
    const onFocus = () => {
      if (!editor) void load();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, editor]);

  const openEditor = (role: LlmRole) => {
    const current = sections[role];
    // A fresh slot starts from the main LLM section (same endpoint is the
    // common case) or the generic template.
    const base = current ?? sections.llm ?? TEMPLATE;
    setEditorError(null);
    setEditor({ role, text: JSON.stringify(base, null, 2) });
  };

  const handleSave = async () => {
    if (!editor || saving) return;
    setEditorError(null);
    let parsed: LlmSection;
    try {
      parsed = JSON.parse(editor.text);
    } catch (e) {
      setEditorError(`Invalid JSON: ${e instanceof Error ? e.message : e}`);
      return;
    }
    setSaving(true);
    try {
      // Backend validates structure and health-checks api_key against
      // api_base before committing; a bad key is rejected right here.
      const r = await configApi.putLlmSection(editor.role, parsed);
      setSections((prev) => ({ ...prev, [editor.role]: r.section }));
      setEditor(null);
      if (editor.role === "llm") await refresh();
    } catch (e) {
      setEditorError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async (role: LlmRole) => {
    if (role === "llm") return; // runtime always needs a main model
    setBusyRole(role);
    setError(null);
    try {
      await configApi.putLlmSection(role, null);
      setSections((prev) => ({ ...prev, [role]: null }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Clear failed");
    } finally {
      setBusyRole(null);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-foreground">Provider Slots</span>
        <span className="text-[10.5px] text-muted-foreground">
          configuration.json, verbatim — what you see is exactly what the file says
        </span>
      </div>

      {loading ? (
        <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {ROLES.map((role) => {
            const s = sections[role];
            const busy = busyRole === role;
            return (
              <div
                key={role}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
                  s ? "border-border/60" : "border-dashed border-border/60"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-foreground">
                    {ROLE_TITLE[role]}
                  </span>
                  {s ? (
                    <div className="text-[10.5px] text-muted-foreground truncate">
                      {s.model}
                      {s.api_base ? ` · ${s.api_base}` : ""} · {keyLabel(s)}
                    </div>
                  ) : (
                    <div className="text-[10.5px] text-muted-foreground/70">
                      Not configured — {ROLE_HINT[role]}
                    </div>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                  {s ? (
                    <>
                      <button
                        onClick={() => openEditor(role)}
                        title={`Edit the ${role} section as JSON`}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      {role !== "llm" && (
                        <button
                          onClick={() => void handleClear(role)}
                          disabled={busy}
                          title={`Clear ${role} — ${ROLE_HINT[role]}`}
                          className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => openEditor(role)}
                      className="text-[11px] font-medium px-2 py-1 rounded-md border border-primary/30 text-primary hover:bg-primary/10 transition-colors inline-flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Configure
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="mt-2 text-[11px] text-red-500 inline-flex items-start gap-1">
          <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {error}
        </p>
      )}

      {/* Slot JSON editor */}
      {editor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onMouseDown={() => setEditor(null)}
        >
          <div
            className="w-[34rem] max-w-[94vw] rounded-xl border border-border/60 bg-card p-4 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-foreground mb-0.5">
              {ROLE_TITLE[editor.role]}
            </div>
            <p className="text-[10.5px] text-muted-foreground mb-2">
              Saved verbatim to configuration.json » {editor.role}. The api_key is
              health-checked against api_base before committing.
            </p>
            <textarea
              value={editor.text}
              onChange={(e) => setEditor({ ...editor, text: e.target.value })}
              rows={12}
              spellCheck={false}
              className="w-full rounded-md border border-border/60 bg-background px-2.5 py-2 text-[11.5px] font-mono text-foreground outline-none focus:border-primary/50 resize-y"
            />
            {editorError && (
              <p className="mt-1.5 text-[11px] text-red-500 inline-flex items-start gap-1">
                <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {editorError}
              </p>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={() => setEditor(null)}
                className="text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-border/60 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="text-[11px] font-medium px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50 inline-flex items-center gap-1"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
