/**
 * Hive Browser Bridge - service worker
 *
 * Commands from Hive (via WebSocket through offscreen.js):
 *
 *   context.create  { agentId }           → { groupId, tabId }
 *   context.destroy { groupId }           → { ok, closedTabs }
 *   tab.create      { groupId, url }      → { tabId }
 *   tab.close       { tabId }             → { ok }
 *   tab.list        { groupId? }          → { tabs: [{id,url,title,groupId}] }
 *   tab.activate    { tabId }             → { ok }
 *   cdp.attach      { tabId }             → { ok }
 *   cdp.detach      { tabId }             → { ok }
 *   cdp             { tabId, method, params } → { ...cdp result }
 *
 * All responses: { id, result } or { id, error }.
 */

// ---------------------------------------------------------------------------
// Offscreen document (persistent WebSocket host)
// ---------------------------------------------------------------------------

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Persistent WebSocket connection to Hive GCU server",
    });
  }
}

function wsSend(obj) {
  chrome.runtime.sendMessage({ _beeline: true, type: "ws_send", data: JSON.stringify(obj) });
}

// ---------------------------------------------------------------------------
// Connection state (shared with popup via storage.session)
// ---------------------------------------------------------------------------

async function setConnected(value, extra = {}) {
  await chrome.storage.session.set({ wsConnected: value, ...extra });
}

// Stable per-install identifier so the bridge can recognise the same
// extension across reconnects. chrome.storage.local survives extension
// reloads, updates, and Chrome restarts.
const EXTENSION_PROTOCOL_VERSION = 1;
const EXTENSION_VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "0.0.0";

async function getOrCreateExtensionId() {
  const stored = await chrome.storage.local.get(["beelineExtensionId"]);
  if (stored.beelineExtensionId) return stored.beelineExtensionId;
  const id = (self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID() : `ext-${Date.now()}-${Math.random()}`;
  await chrome.storage.local.set({ beelineExtensionId: id });
  return id;
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

const TAB_GROUP_COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey"];

function pickColor(groupId) {
  return TAB_GROUP_COLORS[groupId % TAB_GROUP_COLORS.length];
}

async function handleCommand(msg) {
  const { id, type, ...params } = msg;
  try {
    const result = await dispatch(type, params);
    wsSend({ id, result });
  } catch (err) {
    wsSend({ id, error: err.message });
  }
}

async function dispatch(type, params) {
  switch (type) {
    // ── Context (tab group) management ────────────────────────────────────
    case "context.create": {
      // Create a blank tab then group it so we have a groupId to return.
      const tab = await chrome.tabs.create({ url: "about:blank", active: false });
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(groupId, {
        title: params.agentId ?? "Hive Agent",
        color: pickColor(groupId),
        collapsed: false,
      });
      return { groupId, tabId: tab.id };
    }

    case "context.destroy": {
      const tabs = await chrome.tabs.query({ groupId: params.groupId });
      if (tabs.length > 0) {
        // Detach debugger from all tabs before closing them.
        await Promise.allSettled(
          tabs.map((t) => chrome.debugger.detach({ tabId: t.id }).catch(() => {}))
        );
        await chrome.tabs.remove(tabs.map((t) => t.id));
      }
      return { ok: true, closedTabs: tabs.length };
    }

    // ── Tab management ────────────────────────────────────────────────────
    case "tab.create": {
      const tab = await chrome.tabs.create({
        url: params.url ?? "about:blank",
        active: false,
      });
      if (params.groupId != null) {
        await chrome.tabs.group({ tabIds: [tab.id], groupId: params.groupId });
      }
      return { tabId: tab.id };
    }

    case "tab.close": {
      await chrome.debugger.detach({ tabId: params.tabId }).catch(() => {});
      await chrome.tabs.remove(params.tabId);
      return { ok: true };
    }

    case "tab.list": {
      const query = params.groupId != null ? { groupId: params.groupId } : {};
      const tabs = await chrome.tabs.query(query);
      return {
        tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, groupId: t.groupId })),
      };
    }

    case "tab.activate": {
      await chrome.tabs.update(params.tabId, { active: true });
      return { ok: true };
    }

    case "tab.group_by_target": {
      // Resolve a CDP target ID to a Chrome tabId, then move it into the group.
      const targets = await new Promise((resolve) => chrome.debugger.getTargets(resolve));
      const target = targets.find((t) => t.tabId != null && t.id === params.targetId);
      if (!target) throw new Error(`CDP target not found: ${params.targetId}`);
      await chrome.tabs.group({ tabIds: [target.tabId], groupId: params.groupId });
      return { ok: true, tabId: target.tabId };
    }

    // ── Debugger (CDP) ────────────────────────────────────────────────────
    case "cdp.attach": {
      try {
        await chrome.debugger.attach({ tabId: params.tabId }, "1.3");
        return { ok: true, attached: true };
      } catch (err) {
        // Already attached is OK
        if (err.message.includes("already attached") || err.message.includes("Debugger")) {
          return { ok: true, attached: false, message: "Already attached" };
        }
        throw err;
      }
    }

    case "cdp.detach": {
      try {
        await chrome.debugger.detach({ tabId: params.tabId });
        return { ok: true };
      } catch (err) {
        // Not attached is OK
        if (err.message.includes("not attached") || err.message.includes("Debugger")) {
          return { ok: true, message: "Was not attached" };
        }
        throw err;
      }
    }

    case "cdp": {
      return await chrome.debugger.sendCommand(
        { tabId: params.tabId },
        params.method,
        params.params ?? {}
      );
    }

    default:
      throw new Error(`Unknown command: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg._beeline) return;

  if (msg.type === "ws_open") {
    getOrCreateExtensionId().then((extensionId) => {
      setConnected(true, { lastDisconnectReason: null });
      wsSend({
        type: "hello",
        version: EXTENSION_VERSION,
        protocolVersion: EXTENSION_PROTOCOL_VERSION,
        extensionId,
      });
    });
    return;
  }

  if (msg.type === "ws_close") {
    setConnected(false, {
      lastDisconnectReason: msg.reason || `code=${msg.code ?? "?"}`,
    });
    return;
  }

  if (msg.type === "ws_message") {
    handleCommand(JSON.parse(msg.data));
    return;
  }

  // Popup asking for live status
  if (msg.type === "status") {
    chrome.storage.session.get(["wsConnected", "lastDisconnectReason"]).then((data) => {
      sendResponse({
        connected: !!data.wsConnected,
        lastDisconnectReason: data.lastDisconnectReason || null,
      });
    });
    return true; // keep channel open for async response
  }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(ensureOffscreen);
chrome.runtime.onStartup.addListener(ensureOffscreen);

// ---------------------------------------------------------------------------
// CDP event forwarder — diagnostic channel
// ---------------------------------------------------------------------------
//
// chrome.debugger.sendCommand (the cdp handler above) only responds to
// requests. CDP also emits unsolicited EVENTS (Runtime.consoleAPICalled,
// Page.frameResized, Target.targetInfoChanged, …) that the bridge doesn't
// see today. Forward the narrow subset we're currently diagnosing so the
// Python side can correlate viewport changes with page lifecycle events.
// Filtered at the source to keep the wire slim.
const FORWARDED_CDP_EVENTS = new Set([
  "Runtime.consoleAPICalled",
  "Page.lifecycleEvent",
  "Page.frameResized",
  "Page.frameNavigated",
  "Target.targetInfoChanged",
]);

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!FORWARDED_CDP_EVENTS.has(method)) return;
  wsSend({
    type: "cdp_event",
    tabId: source.tabId,
    method,
    params: params ?? {},
  });
});

// Periodic alarm keeps the service worker from being garbage-collected and
// recreates the offscreen document if it was evicted. The keepalive ping
// also nudges the offscreen page to send a noop on the WS so a half-open
// socket surfaces as an onclose instead of sitting dead until the next
// real command.
chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "keepAlive") return;
  ensureOffscreen();
  try {
    chrome.runtime.sendMessage({ _beeline: true, type: "ws_keepalive" });
  } catch (_) {
    // sendMessage throws when there are no listeners (offscreen still spinning up) — fine.
  }
});
