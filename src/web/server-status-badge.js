/* Shared server-status badge.
 *
 * A small fixed pill (bottom-left) showing whether this page is keeping the
 * server active:
 *   - green  "Server active"   — page has a live claim on the server
 *   - amber  "Reconnecting…"   — transient drop, being restored
 *   - grey   "Server idle"     — idle window elapsed; page has released the server
 *
 * Only used on pages with a live WebSocket (play lobby / game viewer), where
 * idle-watcher.js drives it via window.ServerStatusBadge.set(state, label).
 * Static pages (history / config) deliberately do NOT show this badge: they
 * hold no live connection, so a status there would always read "active" and
 * communicate nothing — and any polling to make it meaningful would itself
 * keep the autoscale deployment alive (the exact bug this plumbing exists
 * to prevent).
 */
(function () {
  let badge = null;
  let label = null;

  function ensureBadge() {
    if (badge) return badge;
    const style = document.createElement('style');
    style.textContent = `
      .server-state-badge {
        position: fixed; bottom: 14px; left: 14px; z-index: 9500;
        display: flex; align-items: center; gap: 7px;
        padding: 6px 12px; border-radius: 999px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
        background: rgba(30, 30, 30, 0.92); border: 1px solid #444;
        color: #e0e0e0; box-shadow: 0 2px 10px rgba(0,0,0,0.4);
        cursor: pointer; user-select: none;
      }
      .server-state-badge.firebase-badge { bottom: 50px; cursor: default; }
      .server-state-badge .dot {
        width: 9px; height: 9px; border-radius: 50%;
        background: #888; flex: 0 0 auto;
      }
      .server-state-badge.state-active .dot,
      .server-state-badge.state-connected .dot {
        background: #4CAF50;
        box-shadow: 0 0 6px rgba(76, 175, 80, 0.8);
        animation: server-badge-pulse 2s ease-in-out infinite;
      }
      .server-state-badge.state-active,
      .server-state-badge.state-connected { border-color: #3c6e3e; }
      .server-state-badge.state-reconnecting .dot,
      .server-state-badge.state-connecting .dot { background: #FFC107; }
      .server-state-badge.state-reconnecting,
      .server-state-badge.state-connecting { border-color: #8a6d1a; }
      /* Deliberate inactivity suspension: both bubbles go ORANGE. */
      .server-state-badge.state-idle .dot,
      .server-state-badge.state-suspended .dot {
        background: #FF9800;
        box-shadow: 0 0 6px rgba(255, 152, 0, 0.7);
      }
      .server-state-badge.state-idle,
      .server-state-badge.state-suspended { border-color: #9a6a1a; }
      .server-state-badge.state-error .dot,
      .server-state-badge.state-not_configured .dot {
        background: #f44336;
        box-shadow: 0 0 6px rgba(244, 67, 54, 0.8);
      }
      .server-state-badge.state-error,
      .server-state-badge.state-not_configured { border-color: #8a2a24; }
      @keyframes server-badge-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.45; }
      }
    `;
    document.head.appendChild(style);

    badge = document.createElement('div');
    badge.className = 'server-state-badge state-reconnecting';
    badge.innerHTML =
      '<span class="dot"></span><span class="server-state-label">Connecting…</span>';
    badge.title = 'Click to toggle the WS Debugger';
    // Consolidated status UX: the server bubble is the entry point to the
    // detailed WS Debugger panel (connection-debug.js).
    badge.addEventListener('click', () => {
      if (window.WSDebuggerPanel) window.WSDebuggerPanel.toggle();
    });
    document.body.appendChild(badge);
    label = badge.querySelector('.server-state-label');
    return badge;
  }

  function set(state, text) {
    ensureBadge();
    badge.className = 'server-state-badge state-' + state;
    label.textContent = text;
    // Mirror into the page header's chip where there is one (page-chrome.js).
    // The corner bubble stays exactly where it is — play-game.html's chrome is
    // owned elsewhere and has no header to mirror into — but on the lobby the
    // same reading is also placed where the eye already passes, which is the
    // whole point of a peripheral status (01-RESEARCH #7, #10).
    if (window.PageChrome) window.PageChrome.setSocket(state, text);
  }

  window.ServerStatusBadge = { set };

  /* Firebase connection bubble, stacked above the server bubble.
   * green = connected, red = error / not configured, amber = connecting,
   * orange = suspended (deliberate, due to inactivity). */
  (function () {
    let fbBadge = null;
    let fbLabel = null;

    function ensureFbBadge() {
      if (fbBadge) return fbBadge;
      ensureBadge(); // shared styles
      fbBadge = document.createElement('div');
      fbBadge.className = 'server-state-badge firebase-badge state-connecting';
      fbBadge.innerHTML =
        '<span class="dot"></span><span class="server-state-label">Firebase…</span>';
      document.body.appendChild(fbBadge);
      fbLabel = fbBadge.querySelector('.server-state-label');
      return fbBadge;
    }

    const LABELS = {
      connected: 'Firebase connected',
      connecting: 'Firebase connecting…',
      suspended: 'Firebase paused (inactive)',
      error: 'Firebase down',
      not_configured: 'Firebase not configured',
    };

    function setStatus(status) {
      if (!status || typeof status !== 'object') return;
      ensureFbBadge();
      const state = LABELS[status.state] ? status.state : 'error';
      fbBadge.className = 'server-state-badge firebase-badge state-' + state;
      fbBadge.title = status.error || '';
      fbLabel.textContent = LABELS[state];
    }

    /* Client-side marker while THIS page is idle-disconnected: we can't know
     * the server's Firebase state without a socket, but the suspension is
     * deliberate, so show orange rather than a stale green/red. */
    function setLocalSuspended() {
      setStatus({ state: 'suspended', error: null });
    }

    window.FirebaseStatusBadge = { set: setStatus, setLocalSuspended };
  })();
})();
