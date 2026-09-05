/**
 * Shared WebSocket client factory for the lobby (play.html) and game
 * (play-game.html) pages.
 *
 * Both pages ran near-identical connect/status/reconnect/idle-close blocks;
 * this factory is the single copy, with the REAL page deltas parameterized:
 *   - status element + class prefix + per-phase text overrides;
 *   - the subscribe payload sent on open;
 *   - play-game's pre-open timeout (finished-game fallback) and post-open
 *     hook (clock-ping burst);
 *   - extra fields on the idle-close connection-log POST;
 *   - the per-page message handler;
 *   - reconnect scheduling style (see dedupeReconnect below).
 *
 * Behavior deliberately preserved verbatim from the originals:
 *   - hook order: onclose runs wsDebug.onClose THEN idleWatcher.onClose; an
 *     idle close logs and STOPS (no reconnect); otherwise
 *     idleWatcher.shouldSuppressReconnect() gates the reconnect schedule;
 *   - onopen order: status, subscribe send, clear pending reconnect timer,
 *     wsDebug.onOpen, idleWatcher.onConnected, afterOpen hook;
 *   - reconnect delay 2000ms;
 *   - JSON parse AND the page handler run inside one try/catch, logging
 *     "WS message parse error".
 *
 * Usage:
 *   const wsClient = window.WSClient.create({ ... });
 *   wsClient.connect();
 */
(function (global) {
  'use strict';

  const DEFAULT_STATUS_TEXT = {
    connecting: 'Connecting',
    connected: 'Connected',
    disconnected: 'Disconnected',
    error: 'Error',
  };

  function create(opts) {
    const {
      // Status rendering: element + class prefix; className becomes
      // `${statusClassPrefix} ${phase}` (phase 'error' renders with the
      // 'disconnected' class, as both pages did). statusText(phase, event)
      // may return a string to override the default text for that phase.
      statusEl,
      statusClassPrefix,
      statusText,
      // () => object — the subscribe message sent on every open (evaluated
      // per-open so late-bound fields like playerName are current).
      subscribeMessage,
      // (msg) => void — page message handler for each parsed message.
      onMessage,
      wsDebug,
      idleWatcher,
      // (ws) => void — called with each new socket right after construction,
      // BEFORE handlers can fire, so the page's `ws` variable (and
      // idleWatcher.getWS) always sees the current socket.
      onSocket,
      // Optional: if the socket is not OPEN after this many ms, call
      // onOpenTimeout(). Cleared on open only — a failed attempt still fires
      // it (play-game's finished-game fallback relies on that).
      openTimeoutMs,
      onOpenTimeout,
      // Optional post-open hook (play-game's clock-ping burst).
      afterOpen,
      // Optional () => object — extra fields for the idle-close log POST.
      idleCloseExtra,
      // true  = play.html style: never stack a second timer while one is
      //         pending, and null the handle when it fires;
      // false = play-game style: overwrite the handle unconditionally and
      //         leave it set when it fires (onopen clears it).
      dedupeReconnect,
      reconnectDelayMs = 2000,
    } = opts;

    let reconnectTimer = null;

    function setStatus(phase, event) {
      // Optional: the lobby renders its connection state as a header chip
      // (page-chrome.js, fed by idle-watcher through ServerStatusBadge) and
      // has no pill of its own, so it passes no element.
      if (!statusEl) return;
      const override = statusText && statusText(phase, event);
      statusEl.textContent = override != null ? override : DEFAULT_STATUS_TEXT[phase];
      statusEl.className =
        statusClassPrefix + ' ' + (phase === 'error' ? 'disconnected' : phase);
    }

    function scheduleReconnect() {
      if (dedupeReconnect) {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          wsDebug.onReconnectAttempt();
          connect();
        }, reconnectDelayMs);
      } else {
        reconnectTimer = setTimeout(() => {
          wsDebug.onReconnectAttempt();
          connect();
        }, reconnectDelayMs);
      }
    }

    function connect() {
      setStatus('connecting');

      const protocol = global.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${global.location.host}/ws`);
      if (onSocket) onSocket(ws);

      let openTimeout = null;
      if (openTimeoutMs != null) {
        openTimeout = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) onOpenTimeout();
        }, openTimeoutMs);
      }

      ws.onopen = () => {
        if (openTimeout) clearTimeout(openTimeout);
        setStatus('connected');
        ws.send(JSON.stringify(subscribeMessage()));
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        wsDebug.onOpen();
        idleWatcher.onConnected();
        if (afterOpen) afterOpen();
      };

      ws.onmessage = (event) => {
        try {
          onMessage(JSON.parse(event.data));
        } catch (e) {
          console.error('WS message parse error:', e);
        }
      };

      ws.onclose = (event) => {
        setStatus('disconnected', event);
        wsDebug.onClose(event);
        const wasIdle = idleWatcher.onClose(event);
        if (wasIdle) {
          // Surface the idle close in the connection log as its own event so
          // /connection-debug clearly distinguishes "user went idle" from a
          // network blip or page navigation.
          fetch('/api/connection-log/client', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign(
              { type: 'client-idle-close' },
              idleCloseExtra ? idleCloseExtra() : null,
              { code: event.code, reason: event.reason || '' }
            )),
          }).catch(() => {});
          return;
        }
        if (idleWatcher.shouldSuppressReconnect()) return;
        scheduleReconnect();
      };

      ws.onerror = (event) => {
        setStatus('error', event);
        wsDebug.onError(event);
      };

      return ws;
    }

    return { connect };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.WSClient = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
