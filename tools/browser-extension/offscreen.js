/**
 * Offscreen document: hosts the persistent WebSocket connection to Hive.
 *
 * MV3 service workers suspend after ~30s of inactivity, which would drop a
 * WebSocket. The offscreen document lives as long as Chrome does and relays
 * messages to/from the background service worker.
 */

const HIVE_WS_URL = "ws://127.0.0.1:9229/bridge";

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;

// Exponential backoff: 250ms, 500ms, 1s, 2s, 4s, ..., capped at 30s. The old
// fixed 2s flooded the runtime log when Hive was intentionally down and never
// gave a slow start any breathing room.
const RECONNECT_BASE_MS = 250;
const RECONNECT_CAP_MS = 30_000;

function nextDelay() {
  const exp = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempts);
  // Tiny jitter so two extension instances don't reconnect in lockstep.
  return exp + Math.floor(Math.random() * 250);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = nextDelay();
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  try {
    ws = new WebSocket(HIVE_WS_URL);

    ws.onopen = () => {
      reconnectAttempts = 0;
      console.log("[Beeline] WebSocket connected to Hive");
      chrome.runtime.sendMessage({ _beeline: true, type: "ws_open" });
    };

    ws.onmessage = (event) => {
      // App-level pings are answered inline so the bridge sees a
      // low-latency pong even when the SW is briefly busy. WS-layer
      // ping/pong frames are handled automatically by the platform.
      try {
        const parsed = JSON.parse(event.data);
        if (parsed && parsed.type === "ping") {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
          return;
        }
      } catch (_) {
        // Non-JSON frames fall through to the SW.
      }
      chrome.runtime.sendMessage({ _beeline: true, type: "ws_message", data: event.data });
    };

    ws.onclose = (event) => {
      console.log(`[Beeline] WebSocket closed: code=${event.code}, reason=${event.reason}`);
      chrome.runtime.sendMessage({
        _beeline: true,
        type: "ws_close",
        code: event.code,
        reason: event.reason || "",
      });
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onerror is followed by onclose; the close handler schedules the retry.
      console.warn(`[Beeline] WebSocket connection failed (server may not be running)`);
    };
  } catch (error) {
    console.error("[Beeline] Failed to create WebSocket:", error.message);
    scheduleReconnect();
  }
}

// Forward outbound messages from the service worker onto the WebSocket.
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg._beeline) return;

  if (msg.type === "ws_send") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg.data);
    } else {
      console.warn("[Beeline] Cannot send - WebSocket not connected (state: %s)",
        ws ? ws.readyState : "null");
    }
    return;
  }

  // Service-worker poke: the background alarm pings us so the offscreen
  // page stays warm and the SW exercises its message channel. A noop on
  // a healthy WS is harmless; on a broken WS the send throws and onclose
  // schedules a reconnect.
  if (msg.type === "ws_keepalive") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "noop" }));
      } catch (_) {
        // ignored — onclose will follow
      }
    }
  }
});

// Start connection
connect();
