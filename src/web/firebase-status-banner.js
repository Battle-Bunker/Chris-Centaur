/* Shared Firebase connection banner.
 *
 * The bot is entirely dependent on its Firebase connection to play — when
 * that connection is down the fact must be loud. This renders a fixed red
 * banner at the top of the page whenever the server reports the Firebase
 * interface is in an error / not-configured state, with a Retry button that
 * POSTs /api/firebase-retry.
 *
 * Data sources (NO interval polling — polling would keep the autoscale
 * deployment alive, see idle-watcher.js):
 *   - one fetch of /api/firebase-status on load
 *   - a re-fetch when the tab becomes visible again
 *   - live pushes: pages with a WebSocket call
 *     window.FirebaseStatusBanner.set(status) from their 'firebase-status'
 *     message handler.
 */
(function () {
  let banner = null;
  let msgEl = null;
  let retryBtn = null;

  function ensureBanner() {
    if (banner) return banner;
    const style = document.createElement('style');
    style.textContent = `
      .firebase-status-banner {
        position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
        display: none; align-items: center; justify-content: center; gap: 12px;
        padding: 10px 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px; font-weight: 600;
        background: #b71c1c; color: #fff;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5);
      }
      .firebase-status-banner.visible { display: flex; }
      .firebase-status-banner .fb-detail {
        font-weight: 400; opacity: 0.85; max-width: 50ch;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .firebase-status-banner button {
        padding: 5px 14px; border: 1px solid rgba(255,255,255,0.7);
        border-radius: 4px; background: rgba(255,255,255,0.12); color: #fff;
        font: inherit; cursor: pointer;
      }
      .firebase-status-banner button:hover { background: rgba(255,255,255,0.25); }
      .firebase-status-banner button:disabled { opacity: 0.5; cursor: default; }
    `;
    document.head.appendChild(style);

    banner = document.createElement('div');
    banner.className = 'firebase-status-banner';
    banner.innerHTML =
      '<span class="fb-msg"></span>' +
      '<span class="fb-detail"></span>' +
      '<button type="button" class="fb-retry">Retry connect</button>';
    document.body.appendChild(banner);
    msgEl = banner.querySelector('.fb-msg');
    retryBtn = banner.querySelector('.fb-retry');
    retryBtn.addEventListener('click', retry);
    return banner;
  }

  function set(status) {
    if (!status || typeof status !== 'object') return;
    ensureBanner();
    const bad = status.state === 'error' || status.state === 'not_configured';
    banner.classList.toggle('visible', bad);
    if (!bad) return;
    msgEl.textContent =
      status.state === 'not_configured'
        ? '⚠ Bot is not configured for Firebase — it cannot play.'
        : '⚠ Bot is disconnected from Firebase — it cannot see games.';
    banner.querySelector('.fb-detail').textContent = status.error || '';
    retryBtn.style.display = status.state === 'not_configured' ? 'none' : '';
  }

  async function retry() {
    retryBtn.disabled = true;
    retryBtn.textContent = 'Retrying…';
    try {
      const res = await fetch('/api/firebase-retry', { method: 'POST' });
      set(await res.json());
    } catch (e) {
      /* keep banner as-is; refresh() below may correct it */
    } finally {
      retryBtn.disabled = false;
      retryBtn.textContent = 'Retry connect';
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/firebase-status');
      set(await res.json());
    } catch (e) {
      /* server unreachable — the server-status badge covers that case */
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }

  window.FirebaseStatusBanner = { set, refresh };
})();
