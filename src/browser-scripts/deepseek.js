// DeepSeek Chat Export Script
// Paste into chat.deepseek.com DevTools Console
// Exports all DeepSeek conversations as JSON for memex sync

(function() {
  // ── memex incremental sync ──────────────────────────────────────────────
  // Set by `memex sync-script deepseek`. null = export all conversations.
  var SINCE_DATE = null; // e.g. '2026-04-10T08:23:32Z'
  var KNOWN_IDS = new Set(); // injected by sync-script.ts — raw DeepSeek session IDs
  var sinceTs = SINCE_DATE ? new Date(SINCE_DATE).getTime() / 1000 : 0; // unix seconds
  var USER_TOKEN = null;
  // ────────────────────────────────────────────────────────────────────────

  function requireHost(expectedHost, productName, targetUrl) {
    var currentHost = window.location.hostname;
    if (currentHost === expectedHost) return true;
    alert(
      "Wrong site for this memex script.\n\n" +
      "This is the " + productName + " export script.\n" +
      "Current site: " + currentHost + "\n" +
      "Expected site: " + expectedHost + "\n\n" +
      "Open " + targetUrl + " and paste this script there."
    );
    return false;
  }

  if (!requireHost("chat.deepseek.com", "DeepSeek", "https://chat.deepseek.com")) return;

  if (document.getElementById('memex-ds-panel')) {
    document.getElementById('memex-ds-panel').remove();
    return;
  }

  // ========== STYLES ==========
  var style = document.createElement('style');
  style.textContent = [
    '#memex-ds-panel{position:fixed;top:50%;right:24px;transform:translateY(-50%);width:340px;background:#0d0d0d;border:1px solid #1e3a5f;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,0.7);z-index:999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e0e0e0;}',
    '#memex-ds-panel *{box-sizing:border-box;margin:0;padding:0;}',
    '.mds-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px 12px;border-bottom:1px solid #1a2a3a;background:#0a1628;border-radius:14px 14px 0 0;}',
    '.mds-title{font-size:14px;font-weight:700;color:#fff;}',
    '.mds-title span{color:#4a9eff;}',
    '.mds-close{background:none;border:none;color:#777;font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px;line-height:1;}',
    '.mds-close:hover{color:#e0e0e0;}',
    '.mds-body{padding:16px 20px;}',
    '.mds-btn{width:100%;padding:12px 14px;border:1px solid #1e3a5f;border-radius:10px;background:#0a1628;color:#e0e0e0;font-size:13px;font-weight:600;cursor:pointer;text-align:left;margin-bottom:8px;transition:all 0.15s;}',
    '.mds-btn:hover{background:#0d1f3a;border-color:#4a9eff;}',
    '.mds-btn:disabled{opacity:0.5;cursor:not-allowed;}',
    '.mds-progress{margin-top:10px;}',
    '.mds-bar{width:100%;height:4px;background:#1a2a3a;border-radius:2px;overflow:hidden;margin-bottom:6px;}',
    '.mds-fill{height:100%;background:#4a9eff;border-radius:2px;transition:width 0.3s;width:0%;}',
    '.mds-status{font-size:11px;color:#888;}',
    '.mds-log{margin-top:10px;max-height:120px;overflow-y:auto;background:#060d17;border:1px solid #1a2a3a;border-radius:8px;padding:8px 10px;font-family:monospace;font-size:11px;line-height:1.6;color:#888;}',
    '.mds-log-line.ok{color:#4ade80;}',
    '.mds-log-line.err{color:#f87171;}',
    '.mds-footer{padding:10px 20px;border-top:1px solid #1a2a3a;font-size:10px;color:#555;}',
  ].join('');
  document.head.appendChild(style);

  // ========== PANEL ==========
  var panel = document.createElement('div');
  panel.id = 'memex-ds-panel';
  panel.innerHTML = [
    '<div class="mds-header">',
    '  <div class="mds-title"><span>DeepSeek</span> Export · memex</div>',
    '  <button class="mds-close" id="mds-close">✕</button>',
    '</div>',
    '<div class="mds-body">',
    '  <button class="mds-btn" id="mds-export">📥 Export all conversations</button>',
    '  <div class="mds-progress" id="mds-progress" style="display:none">',
    '    <div class="mds-bar"><div class="mds-fill" id="mds-fill"></div></div>',
    '    <div class="mds-status" id="mds-status"></div>',
    '  </div>',
    '  <div class="mds-log" id="mds-log" style="display:none"></div>',
    '</div>',
    '<div class="mds-footer">All data stays in your browser</div>',
  ].join('');
  document.body.appendChild(panel);

  document.getElementById('mds-close').onclick = function() { panel.remove(); };

  var logEl = document.getElementById('mds-log');
  var fillEl = document.getElementById('mds-fill');
  var statusEl = document.getElementById('mds-status');

  function log(msg, type) {
    logEl.style.display = 'block';
    var line = document.createElement('div');
    line.className = 'mds-log-line' + (type ? ' ' + type : '');
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setProgress(pct, text) {
    document.getElementById('mds-progress').style.display = 'block';
    fillEl.style.width = pct + '%';
    if (text) statusEl.textContent = text;
  }

  function downloadJson(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], {type: 'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function filenameTimestamp() {
    var d = new Date();
    return d.toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')
      .replace('T', '_');
  }

  function deepSeekHeaders(includeAuth) {
    var headers = {
      'x-app-version': '20241129.1',
      'x-client-locale': 'en_US',
      'x-client-platform': 'web',
      'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
      'x-client-version': '1.8.0',
    };
    if (includeAuth && USER_TOKEN) {
      headers.Authorization = 'Bearer ' + USER_TOKEN;
    }
    return headers;
  }

  function apiErrorMessage(prefix, data) {
    var code = data && data.code;
    var msg = data && data.msg;
    var biz = data && data.data;
    var bizCode = biz && biz.biz_code;
    var bizMsg = biz && biz.biz_msg;
    var parts = [prefix];
    if (code !== undefined) parts.push('code=' + code);
    if (msg) parts.push(msg);
    if (bizCode !== undefined) parts.push('biz_code=' + bizCode);
    if (bizMsg) parts.push(bizMsg);
    return parts.join(' ');
  }

  function looksLikeToken(value) {
    var token = String(value || '').trim().replace(/^Bearer\s+/i, '');
    return /^[A-Za-z0-9._~-]{40,}$/.test(token) ? token : null;
  }

  function tokenFromStorageValue(value, depth) {
    if (value == null || depth > 4) return null;
    if (typeof value === 'string') {
      var trimmed = value.trim();
      var direct = looksLikeToken(trimmed);
      if (direct) return direct;
      try {
        return tokenFromStorageValue(JSON.parse(trimmed), depth + 1);
      } catch (_) {
        return null;
      }
    }
    if (typeof value === 'object') {
      var tokenKeys = ['userToken', 'user_token', 'token', 'accessToken', 'access_token', 'authToken', 'auth_token', 'value'];
      for (var i = 0; i < tokenKeys.length; i++) {
        if (Object.prototype.hasOwnProperty.call(value, tokenKeys[i])) {
          var directObj = tokenFromStorageValue(value[tokenKeys[i]], depth + 1);
          if (directObj) return directObj;
        }
      }
      var keys = Object.keys(value);
      for (var j = 0; j < keys.length; j++) {
        var nested = tokenFromStorageValue(value[keys[j]], depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  }

  function readTokenFromStorageArea(area) {
    if (!area) return null;
    var preferred = ['userToken', 'user_token', 'deepseek_userToken', 'token'];
    for (var i = 0; i < preferred.length; i++) {
      var direct = tokenFromStorageValue(area.getItem(preferred[i]), 0);
      if (direct) return direct;
    }
    for (var j = 0; j < area.length; j++) {
      var key = area.key(j);
      if (!/token|auth/i.test(key || '')) continue;
      var found = tokenFromStorageValue(area.getItem(key), 0);
      if (found) return found;
    }
    return null;
  }

  function readTokenFromStorage() {
    return readTokenFromStorageArea(localStorage) || readTokenFromStorageArea(sessionStorage);
  }

  function tokenStorageKeySummary() {
    var labels = [];
    function collect(name, area) {
      try {
        for (var i = 0; i < area.length; i++) {
          var key = area.key(i);
          if (/token|auth/i.test(key || '')) labels.push(name + ':' + key);
        }
      } catch (_) {}
    }
    collect('localStorage', localStorage);
    collect('sessionStorage', sessionStorage);
    return labels.slice(0, 12).join(', ') || 'none';
  }

  async function ensureUserToken() {
    if (USER_TOKEN) return USER_TOKEN;
    USER_TOKEN = readTokenFromStorage();
    if (USER_TOKEN) return USER_TOKEN;

    try {
      var resp = await fetch('https://chat.deepseek.com/api/v0/users/current', {
        credentials: 'include',
        headers: deepSeekHeaders(false),
      });
      if (!resp.ok) throw new Error('Current user: HTTP ' + resp.status);
      var data = await resp.json();
      if (data && data.code !== 0) {
        throw new Error(apiErrorMessage('Current user failed:', data));
      }
      if (data && data.data && data.data.biz_code !== 0) {
        throw new Error(apiErrorMessage('Current user failed:', data));
      }
      var user = data && data.data && data.data.biz_data;
      USER_TOKEN = user && user.token;
    } catch (e) {
      throw new Error('DeepSeek userToken not found in browser storage, and /users/current failed: ' + e.message + '. Token-like storage keys: ' + tokenStorageKeySummary());
    }
    if (!USER_TOKEN) throw new Error('DeepSeek userToken not found. Token-like storage keys: ' + tokenStorageKeySummary());
    return USER_TOKEN;
  }

  function extractSessionId(text) {
    var m = String(text || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : null;
  }

  function isKnownSession(id) {
    return KNOWN_IDS.has(id) || KNOWN_IDS.has('deepseek_' + id);
  }

  function shouldFetchSession(sess) {
    if (!sess || !sess.id) return false;
    if (!isKnownSession(sess.id)) return true;
    return sinceTs > 0 && (sess.updated_at || 0) >= sinceTs;
  }

  function dedupeSessions(sessions) {
    var seen = new Set();
    var out = [];
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      if (!s || !s.id || seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
    return out;
  }

  function sessionsFromPayload(data) {
    var biz = data && data.data && data.data.biz_data;
    var candidates = [
      biz && biz.chat_sessions,
      biz && biz.sessions,
      data && data.chat_sessions,
      data && data.sessions,
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (Array.isArray(candidates[i])) return candidates[i];
    }
    return [];
  }

  function scrapeSessionsFromDom() {
    var out = [];
    var nodes = Array.from(document.querySelectorAll('a[href], [data-id], [data-session-id], [data-chat-session-id]'));
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var raw = [
        node.getAttribute('href'),
        node.getAttribute('data-id'),
        node.getAttribute('data-session-id'),
        node.getAttribute('data-chat-session-id'),
      ].filter(Boolean).join(' ');
      var id = extractSessionId(raw);
      if (!id) continue;
      var title = (node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ');
      out.push({
        id: id,
        title: title || id,
        model_type: '',
        updated_at: 0,
      });
    }
    return dedupeSessions(out);
  }

  async function fetchSessionList() {
    await ensureUserToken();
    var all = [];
    var cursor = null;
    while (true) {
      var url = 'https://chat.deepseek.com/api/v0/chat_session/fetch_page?lte_cursor.pinned=false';
      if (cursor && cursor.seq_id) url += '&lte_cursor.seq_id=' + encodeURIComponent(cursor.seq_id);
      if (cursor && cursor.updated_at) url += '&lte_cursor.updated_at=' + encodeURIComponent(cursor.updated_at);
      var resp = await fetch(url, {
        credentials: 'include',
        headers: deepSeekHeaders(true),
      });
      if (!resp.ok) throw new Error('Session list: HTTP ' + resp.status);
      var data = await resp.json();
      if (data && data.code !== 0) {
        throw new Error(apiErrorMessage('Session list failed:', data));
      }
      if (data && data.data && data.data.biz_code !== 0) {
        throw new Error(apiErrorMessage('Session list failed:', data));
      }
      var biz = data && data.data && data.data.biz_data;
      var sessions = sessionsFromPayload(data);
      all = all.concat(sessions);
      log('Loaded ' + all.length + ' sessions...');
      if (!biz || !biz.has_more || sessions.length === 0) break;
      var last = sessions[sessions.length - 1];
      if (!last) break;
      cursor = {
        seq_id: last.seq_id,
        updated_at: last.updated_at,
      };
      if (!cursor.seq_id && !cursor.updated_at) break;
      await sleep(300);
    }
    all = dedupeSessions(all);
    if (all.length === 0) {
      var scraped = scrapeSessionsFromDom();
      if (scraped.length > 0) {
        log('API list empty; found ' + scraped.length + ' sessions in sidebar DOM');
        return scraped;
      }
    }
    return all;
  }

  async function fetchMessages(sessionId) {
    await ensureUserToken();
    var url = 'https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=' + encodeURIComponent(sessionId);
    var resp = await fetch(url, {
      credentials: 'include',
      headers: deepSeekHeaders(true),
      referrer: 'https://chat.deepseek.com/a/chat/s/' + encodeURIComponent(sessionId),
    });
    if (!resp.ok) throw new Error('Messages HTTP ' + resp.status);
    var data = await resp.json();
    if (data && data.code !== 0) {
      throw new Error(apiErrorMessage('Messages failed:', data));
    }
    if (data && data.data && data.data.biz_code !== 0) {
      throw new Error(apiErrorMessage('Messages failed:', data));
    }
    var biz = data.data && data.data.biz_data;
    if (!biz || !Array.isArray(biz.chat_messages)) {
      throw new Error('Messages response missing chat_messages');
    }
    return {
      session: biz && biz.chat_session,
      messages: biz.chat_messages,
    };
  }

  document.getElementById('mds-export').onclick = async function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = '⏳ Exporting...';

    try {
      setProgress(5, 'Loading session list...');
      var sessions = await fetchSessionList();
      log('Total: ' + sessions.length + ' sessions');

      if (KNOWN_IDS.size > 0 || sinceTs > 0) {
        sessions = sessions.filter(shouldFetchSession);
        log('After incremental filter: ' + sessions.length + ' sessions');
      }

      if (sessions.length === 0) {
        log('No new sessions to export', 'ok');
        btn.textContent = '✅ Nothing new';
        return;
      }

      var exported = [];
      var emptyCount = 0;
      var failureCount = 0;
      for (var i = 0; i < sessions.length; i++) {
        var sess = sessions[i];
        var pct = 10 + Math.round((i / sessions.length) * 85);
        setProgress(pct, (i + 1) + '/' + sessions.length + ': ' + (sess.title || sess.id || '').slice(0, 40));
        try {
          var result = await fetchMessages(sess.id);
          if (!result.messages || result.messages.length === 0) {
            emptyCount++;
            log('✗ ' + (sess.title || sess.id).slice(0, 40) + ': 0 messages returned', 'err');
            continue;
          }
          var fullSession = result.session || {};
          exported.push({
            id: sess.id,
            title: fullSession.title || sess.title || '',
            model_type: fullSession.model_type || sess.model_type || '',
            updated_at: fullSession.updated_at || sess.updated_at,
            inserted_at: fullSession.inserted_at,
            agent: fullSession.agent,
            messages: result.messages,
          });
          log('✓ ' + (sess.title || sess.id).slice(0, 50));
        } catch(e) {
          failureCount++;
          log('✗ ' + (sess.title || sess.id).slice(0, 40) + ': ' + e.message, 'err');
        }
        await sleep(200);
      }

      if (exported.length === 0) {
        throw new Error('Fetched 0 conversations with messages (' + emptyCount + ' empty, ' + failureCount + ' failed). Refresh DeepSeek or open a chat, then run the export again.');
      }

      setProgress(100, 'Done! Downloading...');
      var stamp = filenameTimestamp();
      downloadJson({conversations: exported}, 'deepseek_' + stamp + '.json');
      log('Downloaded deepseek_' + stamp + '.json (' + exported.length + ', ' + emptyCount + ' empty, ' + failureCount + ' failed)', 'ok');
      btn.textContent = '✅ Done! (' + exported.length + ')';

    } catch(e) {
      log('Error: ' + e.message, 'err');
      btn.textContent = '❌ Error';
      btn.disabled = false;
    }
  };
})();
