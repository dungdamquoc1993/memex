// Grok Chat Export Script
// Paste into grok.com DevTools Console
// Exports all Grok conversations as JSON for memex sync

(function() {
  // ── memex incremental sync ──────────────────────────────────────────────
  // Set by `memex sync-script grok`. null = export all conversations.
  var SINCE_DATE = null; // e.g. '2026-04-10T08:23:32Z'
  var KNOWN_IDS = new Set(); // injected by sync-script.ts — raw Grok conversation IDs
  var sinceTs = SINCE_DATE ? new Date(SINCE_DATE).getTime() : 0;
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

  if (!requireHost("grok.com", "Grok", "https://grok.com")) return;

  if (document.getElementById('memex-grok-panel')) {
    document.getElementById('memex-grok-panel').remove();
    return;
  }

  // ========== STYLES ==========
  var style = document.createElement('style');
  style.textContent = [
    '#memex-grok-panel{position:fixed;top:50%;right:24px;transform:translateY(-50%);width:340px;background:#0d0d0d;border:1px solid #2a2a2a;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,0.7);z-index:999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e0e0e0;}',
    '#memex-grok-panel *{box-sizing:border-box;margin:0;padding:0;}',
    '.mgk-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px 12px;border-bottom:1px solid #222;background:#111;border-radius:14px 14px 0 0;}',
    '.mgk-title{font-size:14px;font-weight:700;color:#fff;}',
    '.mgk-title span{color:#a78bfa;}',
    '.mgk-close{background:none;border:none;color:#777;font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px;line-height:1;}',
    '.mgk-close:hover{color:#e0e0e0;}',
    '.mgk-body{padding:16px 20px;}',
    '.mgk-btn{width:100%;padding:12px 14px;border:1px solid #2a2a2a;border-radius:10px;background:#1a1a1a;color:#e0e0e0;font-size:13px;font-weight:600;cursor:pointer;text-align:left;margin-bottom:8px;transition:all 0.15s;}',
    '.mgk-btn:hover{background:#252525;border-color:#444;}',
    '.mgk-btn:disabled{opacity:0.5;cursor:not-allowed;}',
    '.mgk-progress{margin-top:10px;}',
    '.mgk-bar{width:100%;height:4px;background:#222;border-radius:2px;overflow:hidden;margin-bottom:6px;}',
    '.mgk-fill{height:100%;background:#a78bfa;border-radius:2px;transition:width 0.3s;width:0%;}',
    '.mgk-status{font-size:11px;color:#888;}',
    '.mgk-log{margin-top:10px;max-height:120px;overflow-y:auto;background:#111;border:1px solid #222;border-radius:8px;padding:8px 10px;font-family:monospace;font-size:11px;line-height:1.6;color:#888;}',
    '.mgk-log-line.ok{color:#6ee7b7;}',
    '.mgk-log-line.err{color:#f87171;}',
    '.mgk-footer{padding:10px 20px;border-top:1px solid #222;font-size:10px;color:#555;}',
  ].join('');
  document.head.appendChild(style);

  // ========== PANEL ==========
  var panel = document.createElement('div');
  panel.id = 'memex-grok-panel';
  panel.innerHTML = [
    '<div class="mgk-header">',
    '  <div class="mgk-title"><span>Grok</span> Export · memex</div>',
    '  <button class="mgk-close" id="mgk-close">✕</button>',
    '</div>',
    '<div class="mgk-body">',
    '  <button class="mgk-btn" id="mgk-export">📥 Export all conversations</button>',
    '  <div class="mgk-progress" id="mgk-progress" style="display:none">',
    '    <div class="mgk-bar"><div class="mgk-fill" id="mgk-fill"></div></div>',
    '    <div class="mgk-status" id="mgk-status"></div>',
    '  </div>',
    '  <div class="mgk-log" id="mgk-log" style="display:none"></div>',
    '</div>',
    '<div class="mgk-footer">All data stays in your browser</div>',
  ].join('');
  document.body.appendChild(panel);

  document.getElementById('mgk-close').onclick = function() { panel.remove(); };

  var logEl = document.getElementById('mgk-log');
  var fillEl = document.getElementById('mgk-fill');
  var statusEl = document.getElementById('mgk-status');

  function log(msg, type) {
    logEl.style.display = 'block';
    var line = document.createElement('div');
    line.className = 'mgk-log-line' + (type ? ' ' + type : '');
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setProgress(pct, text) {
    document.getElementById('mgk-progress').style.display = 'block';
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

  function isKnownConversation(id) {
    return KNOWN_IDS.has(id) || KNOWN_IDS.has('grok_' + id);
  }

  function shouldFetchConversation(conv) {
    if (!conv || !conv.conversationId) return false;
    if (!isKnownConversation(conv.conversationId)) return true;
    return sinceTs > 0 && new Date(conv.modifyTime || conv.createTime || 0).getTime() >= sinceTs;
  }

  function dedupeConversations(convos) {
    var seen = new Set();
    var out = [];
    for (var i = 0; i < convos.length; i++) {
      var conv = convos[i];
      if (!conv || !conv.conversationId || seen.has(conv.conversationId)) continue;
      seen.add(conv.conversationId);
      out.push(conv);
    }
    return out;
  }

  async function fetchConversationList() {
    var all = [];
    var pageSize = 60;
    var pageToken = null;
    while (true) {
      var url = 'https://grok.com/rest/app-chat/conversations?pageSize=' + pageSize;
      if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
      var resp = await fetch(url, {credentials: 'include'});
      if (!resp.ok) throw new Error('Conversations list: HTTP ' + resp.status);
      var data = await resp.json();
      var convos = data.conversations || [];
      all = all.concat(convos);
      log('Loaded ' + all.length + ' conversations...');
      pageToken = data.nextPageToken || data.nextCursor || data.cursor || null;
      if (!pageToken || convos.length === 0 || convos.length < pageSize) break;
      await sleep(300);
    }
    return dedupeConversations(all);
  }

  function sortResponses(responses, nodeOrder) {
    var order = new Map();
    for (var i = 0; i < nodeOrder.length; i++) order.set(nodeOrder[i], i);
    return (responses || []).slice().sort(function(a, b) {
      var ai = order.has(a.responseId) ? order.get(a.responseId) : 999999;
      var bi = order.has(b.responseId) ? order.get(b.responseId) : 999999;
      if (ai !== bi) return ai - bi;
      return new Date(a.createTime || 0).getTime() - new Date(b.createTime || 0).getTime();
    });
  }

  function selectResponseIds(nodes) {
    var byId = new Map();
    var parentIds = new Set();
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node || !node.responseId) continue;
      byId.set(node.responseId, node);
      if (node.parentResponseId) parentIds.add(node.parentResponseId);
    }

    var leaf = null;
    for (var j = nodes.length - 1; j >= 0; j--) {
      var candidate = nodes[j];
      if (candidate && candidate.responseId && !parentIds.has(candidate.responseId)) {
        leaf = candidate;
        break;
      }
    }
    if (!leaf && nodes.length > 0) leaf = nodes[nodes.length - 1];
    if (!leaf || !leaf.responseId) return [];

    var path = [];
    var seen = new Set();
    while (leaf && leaf.responseId && !seen.has(leaf.responseId)) {
      seen.add(leaf.responseId);
      path.unshift(leaf.responseId);
      leaf = leaf.parentResponseId ? byId.get(leaf.parentResponseId) : null;
    }
    return path;
  }

  async function loadResponseNodes(conversationId) {
    var resp = await fetch('https://grok.com/rest/app-chat/conversations/' + conversationId + '/response-node?includeThreads=true', {
      credentials: 'include',
    });
    if (!resp.ok) throw new Error('response-node HTTP ' + resp.status);
    var data = await resp.json();
    return data.responseNodes || [];
  }

  function decodeLoadResponses(text) {
    try {
      return JSON.parse(text);
    } catch (_) {}
    try {
      var binary = atob(text);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (_) {}
    throw new Error('Could not parse load-responses payload');
  }

  async function loadResponses(conversationId) {
    var nodes = await loadResponseNodes(conversationId);
    var responseIds = selectResponseIds(nodes);
    if (responseIds.length === 0) return {responses: []};

    var resp = await fetch('https://grok.com/rest/app-chat/conversations/' + conversationId + '/load-responses', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({responseIds: responseIds}),
    });
    if (!resp.ok) throw new Error('load-responses HTTP ' + resp.status);
    var text = await resp.text();
    var data = decodeLoadResponses(text);
    data.responses = sortResponses(data.responses || [], responseIds);
    return data;
  }

  document.getElementById('mgk-export').onclick = async function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = '⏳ Exporting...';

    try {
      setProgress(5, 'Loading conversation list...');
      var convos = await fetchConversationList();
      log('Total: ' + convos.length + ' conversations');

      if (KNOWN_IDS.size > 0 || sinceTs > 0) {
        convos = convos.filter(shouldFetchConversation);
        log('After incremental filter: ' + convos.length + ' conversations');
      }

      if (convos.length === 0) {
        log('No new conversations to export', 'ok');
        btn.textContent = '✅ Nothing new';
        return;
      }

      var exported = [];
      for (var i = 0; i < convos.length; i++) {
        var conv = convos[i];
        var pct = 10 + Math.round((i / convos.length) * 85);
        setProgress(pct, (i + 1) + '/' + convos.length + ': ' + (conv.title || conv.conversationId).slice(0, 40));
        try {
          var msgs = await loadResponses(conv.conversationId);
          exported.push({
            conversationId: conv.conversationId,
            title: conv.title || '',
            createTime: conv.createTime,
            modifyTime: conv.modifyTime,
            starred: conv.starred || false,
            systemPromptName: conv.systemPromptName || '',
            responses: msgs.responses || [],
          });
          log('✓ ' + (conv.title || conv.conversationId).slice(0, 50));
        } catch(e) {
          log('✗ ' + (conv.title || conv.conversationId).slice(0, 40) + ': ' + e.message, 'err');
        }
        await sleep(200);
      }

      setProgress(100, 'Done! Downloading...');
      var stamp = filenameTimestamp();
      downloadJson({conversations: exported}, 'grok_' + stamp + '.json');
      log('Downloaded grok_' + stamp + '.json (' + exported.length + ' conversations)', 'ok');
      btn.textContent = '✅ Done! (' + exported.length + ')';

    } catch(e) {
      log('Error: ' + e.message, 'err');
      btn.textContent = '❌ Error';
      btn.disabled = false;
    }
  };
})();
