// Claude.ai Chat Export Script
// https://github.com/dungdamquoc1993/memex
// Exports Claude.ai conversations
// No data leaves your browser - everything runs locally

(function() {
  // ── memex incremental sync ──────────────────────────────────────────────
  // Set by `memex sync-script claude_web`. null = export all conversations.
  var SINCE_DATE = null; // e.g. '2026-04-10T08:23:32Z'
  var DOWNLOAD_CONCURRENCY = 3;
  var DOWNLOAD_WORKER_DELAY_MS = 150;
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

  if (!requireHost("claude.ai", "Claude", "https://claude.ai")) return;

  // Prevent double-loading
  if (document.getElementById("claude-export-panel")) {
    var existing = document.getElementById("claude-export-panel");
    existing.style.animation = "ce-shake 0.3s ease-in-out";
    setTimeout(function() { existing.style.animation = ""; }, 300);
    return;
  }

  // ========== STYLES ==========
  var style = document.createElement("style");
  style.textContent = "\
    @keyframes ce-fadein { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }\
    @keyframes ce-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }\
    @keyframes ce-spin { to { transform: rotate(360deg); } }\
    @keyframes ce-indeterminate { 0% { left: -30%; width: 30%; } 50% { left: 50%; width: 30%; } 100% { left: 100%; width: 30%; } }\
    @keyframes ce-pulse-count { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }\
    @keyframes ce-dot-bounce { 0%,80%,100% { transform: translateY(0); } 40% { transform: translateY(-4px); } }\
    .ce-progress-fill.indeterminate { position: relative; width: 100% !important; background: none !important; overflow: hidden; }\
    .ce-progress-fill.indeterminate::after { content: ''; position: absolute; top: 0; left: -30%; width: 30%; height: 100%; background: linear-gradient(90deg, transparent, #c96442, transparent); border-radius: 3px; animation: ce-indeterminate 1.5s ease-in-out infinite; }\
    .ce-scan-hero { text-align: center; padding: 20px 0 10px; }\
    .ce-scan-hero .ce-scan-count { font-size: 42px; font-weight: 800; color: #c96442; font-variant-numeric: tabular-nums; animation: ce-pulse-count 2s ease-in-out infinite; line-height: 1; }\
    .ce-scan-hero .ce-scan-label { font-size: 12px; color: #888; margin-top: 4px; }\
    .ce-scan-hero .ce-scan-status { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 12px; font-size: 12px; color: #999; }\
    .ce-scan-dots { display: flex; gap: 3px; }\
    .ce-scan-dots span { width: 4px; height: 4px; background: #c96442; border-radius: 50%; animation: ce-dot-bounce 1.2s ease-in-out infinite; }\
    .ce-scan-dots span:nth-child(2) { animation-delay: 0.15s; }\
    .ce-scan-dots span:nth-child(3) { animation-delay: 0.3s; }\
    .ce-dl-hero { text-align: center; padding: 16px 0 8px; }\
    .ce-dl-hero .ce-dl-count { font-size: 28px; font-weight: 700; color: #7eb8a0; }\
    .ce-dl-hero .ce-dl-of { font-size: 14px; color: #555; }\
    .ce-dl-hero .ce-dl-title { font-size: 11px; color: #888; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 10px; }\
    .ce-dl-pct { font-size: 11px; color: #c96442; font-family: 'SF Mono', Consolas, monospace; text-align: right; margin-top: 6px; }\
    .ce-dl-remaining { font-size: 11px; color: #666; text-align: center; margin-top: 8px; }\
    .ce-complete { text-align: center; padding: 20px 0 10px; }\
    .ce-complete-icon { font-size: 36px; margin-bottom: 6px; }\
    .ce-complete-title { font-size: 18px; font-weight: 700; color: #7eb8a0; }\
    .ce-complete-sub { font-size: 12px; color: #888; margin-top: 6px; }\
    #claude-export-panel { position: fixed; top: 50%; right: 24px; transform: translateY(-50%); width: 360px; background: #1a1a1f; border: 1px solid #333340; border-radius: 16px; box-shadow: 0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06); z-index: 999999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e8e8ec; animation: ce-fadein 0.3s ease-out; }\
    #claude-export-panel * { box-sizing: border-box; margin: 0; padding: 0; }\
    .ce-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px 14px; border-bottom: 1px solid #2a2a35; background: #1e1e24; border-radius: 16px 16px 0 0; cursor: move; }\
    .ce-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }\
    .ce-title span.claude-brand { color: #c96442; }\
    .ce-version { font-size: 10px; color: #666; font-weight: 600; margin-top: 2px; }\
    .ce-close { background: none; border: none; color: #777; font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 6px; line-height: 1; }\
    .ce-close:hover { background: #252530; color: #e8e8ec; }\
    .ce-body { padding: 18px 22px 14px; }\
    .ce-btn { width: 100%; padding: 14px 16px; border: 1px solid #333340; border-radius: 12px; background: #222228; color: #e8e8ec; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; margin-bottom: 10px; display: flex; align-items: center; gap: 12px; transition: all 0.15s ease; position: relative; overflow: hidden; }\
    .ce-btn:hover { background: #2a2a32; border-color: #444450; transform: translateY(-1px); }\
    .ce-btn:active { transform: translateY(0); }\
    .ce-btn.running { pointer-events: none; border-color: #c96442; }\
    .ce-btn.done { border-color: #7eb8a0; }\
    .ce-btn.error { border-color: #e07070; }\
    .ce-btn-icon { font-size: 20px; width: 28px; text-align: center; flex-shrink: 0; }\
    .ce-btn-text { flex: 1; }\
    .ce-btn-sub { font-size: 11px; color: #777; font-weight: 400; margin-top: 3px; }\
    .ce-progress { margin-top: 10px; }\
    .ce-progress-bar { width: 100%; height: 5px; background: #252530; border-radius: 3px; overflow: hidden; }\
    .ce-progress-fill { height: 100%; background: linear-gradient(90deg, #c96442, #e08060); border-radius: 3px; transition: width 0.3s ease; width: 0%; }\
    .ce-progress-text { font-size: 11px; color: #999; margin-top: 6px; }\
    .ce-log { margin-top: 14px; max-height: 140px; overflow-y: auto; background: #141418; border: 1px solid #252530; border-radius: 10px; padding: 10px 12px; font-family: 'SF Mono', 'Consolas', monospace; font-size: 11px; line-height: 1.6; color: #999; display: none; }\
    .ce-log.visible { display: block; }\
    .ce-log-entry { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 1px 0; }\
    .ce-log-entry.error { color: #e07070; }\
    .ce-log-entry.success { color: #7eb8a0; }\
    .ce-footer { padding: 14px 22px; border-top: 1px solid #252530; display: flex; justify-content: space-between; align-items: center; }\
    .ce-footer-text { font-size: 10px; color: #555; }\
    .ce-footer-link { font-size: 10px; color: #c96442; text-decoration: none; }\
    .ce-footer-link:hover { text-decoration: underline; }\
    .ce-spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #444; border-top-color: #c96442; border-radius: 50%; animation: ce-spin 0.6s linear infinite; }\
    .ce-toggle-log { background: none; border: none; color: #666; font-size: 11px; cursor: pointer; padding: 6px 0; margin-top: 10px; }\
    .ce-toggle-log:hover { color: #aaa; }\
    .ce-copy-log { background: none; border: none; color: #666; font-size: 11px; cursor: pointer; padding: 6px 0; margin-top: 10px; margin-left: 12px; }\
    .ce-copy-log:hover { color: #aaa; }\
    .ce-filter-panel { margin-top: 10px; }\
    .ce-filter-section { margin-bottom: 12px; }\
    .ce-filter-label { font-size: 10px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }\
    .ce-filter-input { flex: 1; padding: 6px 8px; background: #141418; border: 1px solid #252530; border-radius: 6px; color: #e8e8ec; font-size: 12px; font-family: monospace; outline: none; }\
    .ce-filter-input:focus { border-color: #c96442; }\
    .ce-filter-input::placeholder { color: #555; }\
    .ce-filter-summary { font-size: 12px; color: #c96442; padding: 8px 0; font-weight: 600; }\
    .ce-model-row { display: flex; align-items: center; padding: 3px 0; font-size: 12px; cursor: pointer; color: #ccc; }\
    .ce-model-row:hover { color: #fff; }\
    .ce-model-row input { margin-right: 8px; accent-color: #c96442; }\
    .ce-model-row .cnt { color: #666; margin-left: auto; font-size: 10px; font-family: monospace; }\
    .ce-filter-models { max-height: 120px; overflow-y: auto; background: #141418; border: 1px solid #252530; border-radius: 8px; padding: 6px 8px; }\
  ";
  document.head.appendChild(style);

  // ========== PANEL HTML ==========
  var panel = document.createElement("div");
  panel.id = "claude-export-panel";
  panel.innerHTML = '\
    <div class="ce-header">\
      <div>\
        <div class="ce-title"><span class="claude-brand">Claude</span> Chat Export</div>\
        <div class="ce-version">memex v1.0</div>\
      </div>\
      <button class="ce-close" id="ce-close">\u00D7</button>\
    </div>\
    <div class="ce-body">\
      <button class="ce-btn" id="ce-btn-current">\
        <div class="ce-btn-icon">\uD83D\uDCAC</div>\
        <div class="ce-btn-text">\
          Export current chat\
          <div class="ce-btn-sub">Download the conversation you have open</div>\
        </div>\
      </button>\
      <button class="ce-btn" id="ce-btn-convos">\
        <div class="ce-btn-icon">\uD83D\uDCE5</div>\
        <div class="ce-btn-text">\
          Export all conversations\
          <div class="ce-btn-sub">Scans and downloads all your Claude chats</div>\
        </div>\
      </button>\
      <div class="ce-progress" id="ce-progress" style="display:none;">\
        <div class="ce-progress-bar"><div class="ce-progress-fill" id="ce-progress-fill"></div></div>\
        <div class="ce-progress-text" id="ce-progress-text"></div>\
      </div>\
      <button class="ce-toggle-log" id="ce-toggle-log">Show log \u25BC</button>\
      <button class="ce-copy-log" id="ce-copy-log">Copy log</button>\
      <div class="ce-log" id="ce-log"></div>\
    </div>\
    <div class="ce-footer">\
      <span class="ce-footer-text">All data stays in your browser</span>\
      <a class="ce-footer-link" href="https://github.com/dungdamquoc1993/memex" target="_blank">GitHub</a>\
    </div>\
  ';
  document.body.appendChild(panel);

  // ========== DRAGGING ==========
  var isDragging = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;
  var header = panel.querySelector(".ce-header");

  header.addEventListener("mousedown", function(e) {
    if (e.target.classList.contains("ce-close")) return;
    isDragging = true;
    var rect = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    panel.style.transition = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", function(e) {
    if (!isDragging) return;
    panel.style.right = "auto";
    panel.style.transform = "none";
    panel.style.left = (e.clientX - dragOffsetX) + "px";
    panel.style.top = (e.clientY - dragOffsetY) + "px";
  });

  document.addEventListener("mouseup", function() {
    isDragging = false;
    panel.style.transition = "";
  });

  // ========== HELPERS ==========
  var logEl = document.getElementById("ce-log");
  var progressEl = document.getElementById("ce-progress");
  var progressFill = document.getElementById("ce-progress-fill");
  var progressText = document.getElementById("ce-progress-text");

  function log(msg, type) {
    var entry = document.createElement("div");
    entry.className = "ce-log-entry" + (type ? " " + type : "");
    entry.textContent = msg;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setProgress(pct, text) {
    progressEl.style.display = "block";
    progressFill.style.width = pct + "%";
    if (text) progressText.textContent = text;
  }

  function setButtonState(btn, state, label) {
    btn.className = "ce-btn " + state;
    var iconEl = btn.querySelector(".ce-btn-icon");
    if (state === "running") {
      iconEl.innerHTML = '<div class="ce-spinner"></div>';
    } else if (state === "done") {
      iconEl.textContent = "\u2705";
    } else if (state === "error") {
      iconEl.textContent = "\u274C";
    }
    if (label) {
      btn.querySelector(".ce-btn-sub").textContent = label;
    }
  }

  function downloadFile(content, filename, type) {
    var blob = new Blob([content], {type: type || "text/plain"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log("Downloaded: " + filename, "success");
  }

  function filenameTimestamp() {
    var iso = new Date().toISOString();
    return iso.slice(0, 10).replace(/-/g, "") + "_" + iso.slice(11, 19).replace(/:/g, "") + "Z";
  }

  // ========== CLAUDE API HELPERS ==========
  var cachedOrgId = null;
  var PAGE_LIMIT = 50;

  async function getOrgId() {
    if (cachedOrgId) return cachedOrgId;
    log("Detecting organization...");

    // Try primary endpoint first, then bootstrap fallback
    var endpoints = [
      "https://claude.ai/api/organizations",
      "https://claude.ai/api/bootstrap"
    ];

    var lastErr = null;
    for (var ei = 0; ei < endpoints.length; ei++) {
      try {
        var resp = await fetch(endpoints[ei], { credentials: "include" });
        if (resp.status === 403) throw new Error("Access denied (403). Make sure you're logged in to claude.ai.");
        if (!resp.ok) throw new Error("HTTP " + resp.status);

        var body = await resp.json();

        // /api/organizations → returns array of orgs directly
        // /api/bootstrap    → returns {account:{memberships:[{organization:{uuid,...}}]}}
        var orgs = null;
        if (Array.isArray(body)) {
          orgs = body;
        } else if (body && body.account && body.account.memberships) {
          orgs = body.account.memberships.map(function(m) { return m.organization; });
        } else if (body && body.organizations) {
          orgs = body.organizations;
        }

        if (!orgs || orgs.length === 0) {
          log("No orgs from " + endpoints[ei] + ", trying next...");
          continue;
        }

        cachedOrgId = orgs[0].uuid || orgs[0].id;
        log("Organization: " + (orgs[0].name || "Personal") + " (" + cachedOrgId + ")");
        return cachedOrgId;
      } catch(e) {
        lastErr = e;
        log("Endpoint " + endpoints[ei] + " failed: " + e.message);
      }
    }
    throw new Error("Could not detect org: " + (lastErr ? lastErr.message : "unknown"));
  }

  // Fetch conversations list with pagination
  async function fetchConversationsList(orgId) {
    var allConvos = [];
    var cursor = null;
    var pageNum = 0;
    var hitCutoff = false;

    while (true) {
      pageNum++;
      var url = "https://claude.ai/api/organizations/" + orgId + "/chat_conversations?limit=" + PAGE_LIMIT;
      if (cursor) url += "&cursor=" + encodeURIComponent(cursor);

      var resp = await fetch(url, { credentials: "include" });
      if (resp.status === 403) throw new Error("Access denied. Session may have expired — refresh claude.ai and try again.");
      if (!resp.ok) throw new Error("Could not list conversations (HTTP " + resp.status + ")");

      var data = await resp.json();

      // Debug: log what we actually got
      var rawType = Array.isArray(data) ? "array[" + data.length + "]" : (typeof data === "object" ? "object{" + Object.keys(data).join(",") + "}" : typeof data);
      log("[p" + pageNum + "] response: " + rawType);

      var items = [];
      var nextCursor = null;

      if (Array.isArray(data)) {
        items = data;
        // Claude returns flat array per page; if shorter than limit → last page
        if (items.length < PAGE_LIMIT) nextCursor = null;
        else nextCursor = "ARRAY_PAGE"; // signal to keep going
      } else if (data && typeof data === "object") {
        // Possible keys: conversations, data, items, results
        items = data.conversations || data.data || data.items || data.results || [];
        nextCursor = data.cursor || data.next_cursor || null;
        if (data.has_more === false || data.has_more === 0) nextCursor = null;
      }

      for (var i = 0; i < items.length; i++) {
        var conv = items[i];
        if (SINCE_DATE && conv.updated_at && conv.updated_at < SINCE_DATE) {
          hitCutoff = true;
          break;
        }
        allConvos.push(conv);
      }
      if (items.length > 0) {
        log("Page " + pageNum + ": +" + items.length + " (total " + allConvos.length + ")");
      }

      if (hitCutoff) break;
      if (!nextCursor || items.length === 0) break;

      // For array pagination, use offset or the cursor from response
      if (nextCursor === "ARRAY_PAGE") {
        // no cursor-based pagination — just use offset
        url = "https://claude.ai/api/organizations/" + orgId + "/chat_conversations?limit=" + PAGE_LIMIT + "&offset=" + allConvos.length;
        cursor = null; // reset so we build next URL with offset next loop
        // fetch next page directly
        var r2 = await fetch(url, { credentials: "include" });
        if (!r2.ok) break;
        var d2 = await r2.json();
        var items2 = Array.isArray(d2) ? d2 : (d2.conversations || d2.data || d2.items || []);
        if (items2.length === 0) break;
        for (var j = 0; j < items2.length; j++) {
          var conv2 = items2[j];
          if (SINCE_DATE && conv2.updated_at && conv2.updated_at < SINCE_DATE) {
            hitCutoff = true;
            break;
          }
          allConvos.push(conv2);
        }
        log("Page " + (pageNum+1) + ": +" + items2.length + " (total " + allConvos.length + ")");
        if (items2.length < PAGE_LIMIT || hitCutoff) break;
        pageNum++;
      } else {
        cursor = nextCursor;
      }

      await new Promise(function(r) { setTimeout(r, 300); });
    }

    if (allConvos.length === 0) {
      log("⚠ 0 conversations returned. Check: are you on claude.ai? Is Show Log open?", "error");
    }

    // ── Fetch conversations inside Projects ──────────────────────────────────
    // The regular chat_conversations endpoint does NOT include project conversations.
    // We need to list projects and fetch each one's conversations separately.
    try {
      log("Checking for projects...");
      var statusEl = document.getElementById("ce-scan-status");
      if (statusEl) statusEl.innerHTML = '<span class="ce-scan-dots"><span></span><span></span><span></span></span> Checking projects\u2026';
      var projResp = await fetch("https://claude.ai/api/organizations/" + orgId + "/projects", { credentials: "include" });
      if (!projResp.ok) {
        log("Projects endpoint returned " + projResp.status + " — skipping project conversations");
      } else {
        var projData = await projResp.json();
        var projects = Array.isArray(projData) ? projData : (projData.projects || projData.data || []);
        log("Found " + projects.length + " project(s)");

        // Build a set of already-fetched conversation UUIDs to deduplicate
        var seenIds = {};
        for (var si = 0; si < allConvos.length; si++) {
          seenIds[allConvos[si].uuid || allConvos[si].id] = true;
        }

        for (var pi = 0; pi < projects.length; pi++) {
          var proj = projects[pi];
          var projId = proj.uuid || proj.id;
          var projName = proj.name || projId;
          log("Fetching project: " + projName);
          if (statusEl) statusEl.innerHTML = '<span class="ce-scan-dots"><span></span><span></span><span></span></span> Scanning project: ' + projName + '\u2026';

          var projOffset = 0;
          var projHitCutoff = false;
          while (true) {
            var projUrl = "https://claude.ai/api/organizations/" + orgId + "/projects/" + projId + "/conversations?limit=" + PAGE_LIMIT + "&offset=" + projOffset;
            var pr = await fetch(projUrl, { credentials: "include" });
            if (!pr.ok) { log("Project " + projName + " fetch failed: HTTP " + pr.status, "error"); break; }
            var pd = await pr.json();
            var pitems = Array.isArray(pd) ? pd : (pd.conversations || pd.data || pd.items || []);
            if (pitems.length === 0) break;

            var added = 0;
            for (var pj = 0; pj < pitems.length; pj++) {
              var pc = pitems[pj];
              var pcId = pc.uuid || pc.id;
              if (SINCE_DATE && pc.updated_at && pc.updated_at < SINCE_DATE) { projHitCutoff = true; break; }
              if (!seenIds[pcId]) {
                seenIds[pcId] = true;
                pc._project = projName;
                pc._project_id = projId;
                allConvos.push(pc);
                added++;
              }
            }
            log("Project " + projName + ": +" + added + " conversations (offset " + projOffset + ")");
            projOffset += pitems.length;
            if (pitems.length < PAGE_LIMIT || projHitCutoff) break;
            await new Promise(function(r) { setTimeout(r, 300); });
          }
        }
        log("Total after projects: " + allConvos.length);
        // Update scan hero count
        var countEl = document.getElementById("ce-scan-count");
        if (countEl) countEl.textContent = allConvos.length.toLocaleString();
      }
    } catch (projErr) {
      log("Could not fetch project conversations: " + projErr.message, "error");
    }
    // ────────────────────────────────────────────────────────────────────────

    return allConvos;
  }

  // Fetch single conversation detail
  async function fetchConversationDetail(orgId, convoId) {
    var url = "https://claude.ai/api/organizations/" + orgId + "/chat_conversations/" + convoId;
    var delays = [0, 10000, 20000];
    var resp = null;

    for (var attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) {
        log("Rate limited, waiting " + Math.round(delays[attempt] / 1000) + "s before retry...", "error");
        await new Promise(function(r) { setTimeout(r, delays[attempt]); });
      }

      resp = await fetch(url, { credentials: "include" });
      if (resp.status !== 429) break;
    }

    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  }


  // Process Claude conversation into normalized format
  function processConversation(detail, listItem) {
    var messages = [];
    var model = null;

    // Extract messages — Claude uses chat_messages array
    var rawMessages = detail.chat_messages || detail.messages || [];
    for (var i = 0; i < rawMessages.length; i++) {
      var msg = rawMessages[i];

      // Determine role
      var role = msg.sender || msg.role || "unknown";
      // Normalize Claude roles: "human" → "user", "assistant" → "assistant"
      if (role === "human") role = "user";

      // Extract content
      var content = "";
      if (typeof msg.text === "string") {
        content = msg.text;
      } else if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Content blocks format
        var parts = [];
        for (var j = 0; j < msg.content.length; j++) {
          var block = msg.content[j];
          if (typeof block === "string") {
            parts.push(block);
          } else if (block.type === "text") {
            parts.push(block.text || "");
          } else if (block.type === "tool_use") {
            parts.push("[Tool: " + (block.name || "unknown") + "]");
          } else if (block.type === "tool_result") {
            parts.push("[Tool result]");
          } else if (block.type === "image") {
            parts.push("[Image]");
          } else if (block.type === "file") {
            parts.push("[File: " + (block.file_name || "attached file") + "]");
          } else if (block.text) {
            parts.push(block.text);
          }
        }
        content = parts.join("\n");
      } else if (msg.content && typeof msg.content === "object" && msg.content.text) {
        content = msg.content.text;
      }

      // Extract model info from assistant messages
      if (role === "assistant" && !model) {
        model = msg.model || msg.model_slug || detail.model || null;
      }

      // Extract timestamp
      var timestamp = msg.created_at || msg.updated_at || null;
      if (timestamp && typeof timestamp === "string") {
        timestamp = new Date(timestamp).getTime() / 1000;
        if (isNaN(timestamp)) timestamp = null;
      }

      if (content.trim()) {
        messages.push({
          role: role,
          content: content,
          timestamp: timestamp,
          model: (role === "assistant") ? (msg.model || model || null) : null
        });
      }
    }

    // Get model from conversation metadata if not found in messages
    if (!model) {
      model = detail.model || listItem.model || null;
    }

    return {
      id: detail.uuid || detail.id || listItem.uuid || listItem.id,
      title: detail.name || detail.title || listItem.name || listItem.title || "Untitled",
      create_time: parseTimestamp(detail.created_at || listItem.created_at),
      update_time: parseTimestamp(detail.updated_at || listItem.updated_at),
      model: model,
      source: "claude",
      project: detail.project_uuid ? (detail.project_name || detail.project_uuid) : null,
      message_count: messages.length,
      messages: messages
    };
  }

  function parseTimestamp(ts) {
    if (!ts) return null;
    if (typeof ts === "number") return ts > 1e12 ? ts / 1000 : ts;
    var parsed = new Date(ts).getTime() / 1000;
    return isNaN(parsed) ? null : parsed;
  }

  // ========== EXPORT: CURRENT CHAT ==========
  async function exportCurrentChat() {
    var btn = document.getElementById("ce-btn-current");
    setButtonState(btn, "running", "Exporting...");

    try {
      // URL patterns: /chat/{id} or /project/{pid}/chat/{id}
      var match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9-]+)/);
      if (!match) {
        throw new Error("No conversation open. Navigate to a chat first.");
      }
      var convId = match[1];
      log("Fetching conversation: " + convId);

      var orgId = await getOrgId();
      var detail = await fetchConversationDetail(orgId, convId);
      var processed = processConversation(detail, detail);
      var result = {
        export_date: new Date().toISOString(),
        source: "claude",
        conversations: [processed]
      };

      downloadFile(JSON.stringify(result, null, 2), "claude_current_" + filenameTimestamp() + ".json", "application/json");
      setButtonState(btn, "done", "Downloaded!");
      log("Current chat exported.", "success");

    } catch (err) {
      log("Export failed: " + err.message, "error");
      setButtonState(btn, "error", err.message);
    }
  }

  // ========== MAIN EXPORT FLOW ==========
  var scannedConvos = [];

  async function exportConversations() {
    var btn = document.getElementById("ce-btn-convos");
    setButtonState(btn, "running", "Scanning...");

    // Show indeterminate progress
    progressEl.style.display = "block";
    progressFill.classList.add("indeterminate");
    progressFill.style.width = "100%";

    // Insert scan hero
    var scanHero = document.createElement("div");
    scanHero.className = "ce-scan-hero";
    scanHero.id = "ce-scan-hero";
    scanHero.innerHTML = '<div class="ce-scan-count" id="ce-scan-count">0</div>' +
      '<div class="ce-scan-label">conversations found</div>' +
      '<div class="ce-scan-status" id="ce-scan-status">' +
        '<span class="ce-scan-dots"><span></span><span></span><span></span></span>' +
        ' Scanning your conversations\u2026' +
      '</div>';
    progressEl.parentNode.insertBefore(scanHero, progressEl.nextSibling);

    try {
      var orgId = await getOrgId();

      log("Scanning conversation list...");
      scannedConvos = await fetchConversationsList(orgId);

      var countEl = document.getElementById("ce-scan-count");
      if (countEl) countEl.textContent = scannedConvos.length.toLocaleString();

      var statusEl = document.getElementById("ce-scan-status");
      if (statusEl) statusEl.innerHTML = "Scan complete!";

      log("Total conversations: " + scannedConvos.length);

      if (scannedConvos.length === 0) {
        setButtonState(btn, "done", "No conversations found");
        cleanupScanUI();
        return;
      }

      // Clean up scan UI and show download option
      setButtonState(btn, "done", scannedConvos.length + " conversations found");
      cleanupScanUI();
      showDownloadPanel(orgId);

    } catch (err) {
      log("Scan failed: " + err.message, "error");
      setButtonState(btn, "error", err.message);
      cleanupScanUI();
    }
  }

  function cleanupScanUI() {
    var scanHeroEl = document.getElementById("ce-scan-hero");
    if (scanHeroEl) scanHeroEl.parentNode.removeChild(scanHeroEl);
    progressFill.classList.remove("indeterminate");
    progressFill.style.width = "0%";
    progressEl.style.display = "none";
  }

  function showDownloadPanel(orgId) {
    // Count models and sources
    var models = {};
    var sources = {};
    for (var i = 0; i < scannedConvos.length; i++) {
      var m = scannedConvos[i].model || "unknown";
      models[m] = (models[m] || 0) + 1;
      var src = scannedConvos[i]._project || "Main conversations";
      sources[src] = (sources[src] || 0) + 1;
    }
    var modelKeys = Object.keys(models).sort(function(a, b) { return models[b] - models[a]; });

    // Build model filter checkboxes
    var hasRealModels = modelKeys.length > 1 || (modelKeys.length === 1 && modelKeys[0] !== "unknown");
    var modelCheckboxes = "";
    for (var mi = 0; mi < modelKeys.length; mi++) {
      var mk = modelKeys[mi];
      modelCheckboxes += '<label class="ce-model-row"><input type="checkbox" checked data-model="' + mk + '"> ' + mk + '<span class="cnt">' + models[mk] + '</span></label>';
    }

    // Build source/project checkboxes
    var sourceKeys = Object.keys(sources).sort(function(a, b) {
      if (a === "Main conversations") return -1;
      if (b === "Main conversations") return 1;
      return sources[b] - sources[a];
    });
    var sourceCheckboxes = "";
    var hasProjects = sourceKeys.length > 1;
    for (var si = 0; si < sourceKeys.length; si++) {
      var sk = sourceKeys[si];
      var icon = sk === "Main conversations" ? "\uD83D\uDCAC" : "\uD83D\uDCC1";
      sourceCheckboxes += '<label class="ce-model-row"><input type="checkbox" checked data-source="' + sk + '"> ' + icon + ' ' + sk + '<span class="cnt">' + sources[sk] + '</span></label>';
    }

    // Scan summary with breakdown
    var projConvoCount = scannedConvos.filter(function(c) { return c._project; }).length;
    var projCount = 0;
    for (var ski = 0; ski < sourceKeys.length; ski++) {
      if (sourceKeys[ski] !== "Main conversations") projCount++;
    }
    var mainCount = scannedConvos.length - projConvoCount;
    var scanSummaryText = scannedConvos.length.toLocaleString() + '</span>' +
      '<span style="font-size:12px;color:#888;"> conversations scanned</span>';
    var breakdownParts = [];
    if (mainCount > 0) breakdownParts.push(mainCount.toLocaleString() + ' main');
    if (projConvoCount > 0) breakdownParts.push(projConvoCount + ' from ' + projCount + ' project' + (projCount > 1 ? 's' : ''));
    if (breakdownParts.length > 1) {
      scanSummaryText += '<div style="font-size:11px;color:#7eb8a0;margin-top:4px;">' + breakdownParts.join(' + ') + '</div>';
    }

    var filterHtml = '\
      <div class="ce-filter-panel" id="ce-filter-panel">\
        <div style="text-align:center;margin-bottom:14px;">\
          <span style="font-size:28px;font-weight:800;color:#7eb8a0;">' + scanSummaryText + '\
        </div>\
        <div class="ce-filter-section">\
          <div class="ce-filter-label">Search conversations</div>\
          <input type="text" class="ce-filter-input" id="ce-search" placeholder="Filter by title\u2026" style="width:100%;">\
        </div>\
        ' + (hasProjects ? '\
        <div class="ce-filter-section">\
          <div class="ce-filter-label">Source</div>\
          <div class="ce-filter-models" id="ce-filter-sources">' + sourceCheckboxes + '</div>\
        </div>' : '') + '\
        ' + (hasRealModels ? '\
        <div class="ce-filter-section">\
          <div class="ce-filter-label">Models</div>\
          <div class="ce-filter-models" id="ce-filter-models">' + modelCheckboxes + '</div>\
        </div>' : '') + '\
        <div class="ce-filter-summary" id="ce-filter-summary">' + scannedConvos.length + ' conversations selected</div>\
        <button class="ce-btn" id="ce-btn-download" style="border-color:#c96442;margin-bottom:0;">\
          <div class="ce-btn-icon">\uD83D\uDCE5</div>\
          <div class="ce-btn-text"><span style="color:#c96442;">Download ' + scannedConvos.length + ' conversations</span>\
            <div class="ce-btn-sub">~' + estimateTime(scannedConvos.length) + '</div>\
          </div>\
        </button>\
      </div>';

    // Hide the main button
    var convoBtn = document.getElementById("ce-btn-convos");
    if (convoBtn) convoBtn.style.display = "none";

    // Insert filter panel
    var bodyEl = panel.querySelector(".ce-body");
    var filterDiv = document.createElement("div");
    filterDiv.innerHTML = filterHtml;
    var filterPanel = filterDiv.firstElementChild || filterDiv.firstChild;
    var progressEl = document.getElementById("ce-progress");
    if (progressEl && progressEl.parentNode) {
      progressEl.parentNode.insertBefore(filterPanel, progressEl);
    } else {
      bodyEl.appendChild(filterPanel);
    }

    // Wire up events
    var searchInput = document.getElementById("ce-search");
    if (searchInput) searchInput.addEventListener("input", updateFilterSummary);

    var filterInputs = document.querySelectorAll("#ce-filter-models input, #ce-filter-sources input");
    for (var fi = 0; fi < filterInputs.length; fi++) {
      filterInputs[fi].addEventListener("change", updateFilterSummary);
    }

    document.getElementById("ce-btn-download").addEventListener("click", function() {
      startDownload(orgId);
    });
  }

  function estimateTime(count) {
    var seconds = Math.ceil(count / DOWNLOAD_CONCURRENCY) * 1.2; // conservative with small worker pool
    if (seconds < 60) return "~" + Math.max(Math.round(seconds), 1) + " seconds";
    var mins = Math.round(seconds / 60);
    return mins < 60 ? "~" + mins + " minutes" : "~" + (seconds / 3600).toFixed(1) + " hours";
  }

  function getFilteredConvos() {
    var selectedModels = {};
    var modelInputs = document.querySelectorAll("#ce-filter-models input");
    for (var i = 0; i < modelInputs.length; i++) {
      if (modelInputs[i].checked) {
        selectedModels[modelInputs[i].getAttribute("data-model")] = true;
      }
    }
    var hasModelFilter = modelInputs.length > 0 && Object.keys(selectedModels).length > 0;

    // Source/project filter
    var selectedSources = {};
    var sourceBoxes = document.querySelectorAll("#ce-filter-sources input");
    for (var si = 0; si < sourceBoxes.length; si++) {
      if (sourceBoxes[si].checked) selectedSources[sourceBoxes[si].getAttribute("data-source")] = true;
    }
    var hasSourceFilter = sourceBoxes.length > 0 && Object.keys(selectedSources).length > 0;

    var searchInput = document.getElementById("ce-search");
    var searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : "";

    var filtered = [];
    for (var j = 0; j < scannedConvos.length; j++) {
      var c = scannedConvos[j];
      if (searchTerm) {
        var title = (c.name || c.title || "").toLowerCase();
        if (title.indexOf(searchTerm) === -1) continue;
      }
      if (hasSourceFilter) {
        var src = c._project || "Main conversations";
        if (!selectedSources[src]) continue;
      }
      if (hasModelFilter) {
        var model = c.model || "unknown";
        if (!selectedModels[model]) continue;
      }
      filtered.push(c);
    }
    return filtered;
  }

  function updateFilterSummary() {
    var filtered = getFilteredConvos();
    var summary = document.getElementById("ce-filter-summary");
    var dlBtn = document.getElementById("ce-btn-download");
    if (summary) summary.textContent = filtered.length + " conversations selected";
    if (dlBtn) {
      var span = dlBtn.querySelector(".ce-btn-text span");
      if (span) span.textContent = "Download " + filtered.length + " conversations";
      var sub = dlBtn.querySelector(".ce-btn-sub");
      if (sub) sub.textContent = estimateTime(filtered.length);
    }
  }

  async function startDownload(orgId) {
    var convos = getFilteredConvos();
    if (convos.length === 0) {
      alert("No conversations selected. Adjust your filters.");
      return;
    }

    var filterPanel = document.getElementById("ce-filter-panel");
    if (filterPanel) {
      filterPanel.innerHTML = '\
        <div class="ce-dl-hero" id="ce-dl-hero">\
          <span class="ce-dl-count" id="ce-dl-count">0</span>\
          <span class="ce-dl-of" id="ce-dl-of"> / ' + convos.length + '</span>\
          <div class="ce-dl-title" id="ce-dl-title">Starting download\u2026</div>\
        </div>\
        <div style="margin:10px 0;">\
          <div class="ce-progress-bar"><div class="ce-progress-fill" id="ce-dl-fill" style="width:0%;"></div></div>\
          <div class="ce-dl-pct" id="ce-dl-pct">0%</div>\
        </div>\
        <div class="ce-dl-remaining" id="ce-dl-remaining"></div>';
    }

    var startTime = Date.now();
    var result = {
      export_date: new Date().toISOString(),
      tool: "memex claude-export v1.1",
      source: "claude.ai",
      format_version: 1,
      total_conversations: convos.length,
      conversations: new Array(convos.length)
    };

    var success = 0;
    var errors = 0;
    var completed = 0;
    var nextIndex = 0;

    function updateDownloadProgress(index, title) {
      var pct = Math.round(completed / convos.length * 100);
      var countEl = document.getElementById("ce-dl-count");
      var titleEl = document.getElementById("ce-dl-title");
      var fillEl = document.getElementById("ce-dl-fill");
      var pctEl = document.getElementById("ce-dl-pct");
      var remainEl = document.getElementById("ce-dl-remaining");

      if (countEl) countEl.textContent = completed;
      if (titleEl) titleEl.textContent = "Worker " + (index + 1) + ": " + title;
      if (fillEl) fillEl.style.width = pct + "%";
      if (pctEl) pctEl.textContent = pct + "%";

      if (remainEl && completed > 0) {
        var elapsed = (Date.now() - startTime) / 1000 / completed;
        var remaining = Math.round(elapsed * (convos.length - completed));
        remainEl.textContent = remaining < 60
          ? "~" + remaining + " seconds remaining · " + DOWNLOAD_CONCURRENCY + " parallel"
          : "~" + Math.round(remaining / 60) + " minutes remaining · " + DOWNLOAD_CONCURRENCY + " parallel";
      }
    }

    async function downloadWorker(workerIndex) {
      while (true) {
        var i = nextIndex++;
        if (i >= convos.length) return;

        var convo = convos[i];
        var convoId = convo.uuid || convo.id;
        var title = convo.name || convo.title || "Untitled";

        try {
          var detail = await fetchConversationDetail(orgId, convoId);
          var processed = processConversation(detail, convo);
          result.conversations[i] = processed;
          success++;
        } catch (err) {
          log("Error: " + title + " — " + err.message, "error");
          errors++;
          result.conversations[i] = {
            id: convoId,
            title: title,
            source: "claude",
            error: err.message
          };
        }

        completed++;
        updateDownloadProgress(workerIndex, title);

        // Progress log every 25
        if (completed % 25 === 0 || completed === convos.length) {
          log("Progress: " + completed + "/" + convos.length + " (" + success + " OK, " + errors + " errors)");
        }

        await new Promise(function(r) { setTimeout(r, DOWNLOAD_WORKER_DELAY_MS); });
      }
    }

    log("Downloading with " + DOWNLOAD_CONCURRENCY + " parallel workers.");

    var workerCount = Math.min(DOWNLOAD_CONCURRENCY, convos.length);
    var workers = [];
    for (var wi = 0; wi < workerCount; wi++) {
      workers.push(downloadWorker(wi));
    }
    await Promise.all(workers);
    result.conversations = result.conversations.filter(function(c) { return !!c; });

    // Download file
    var jsonStr = JSON.stringify(result, null, 2);
    var fileSize = jsonStr.length;
    var sizeLabel = fileSize < 1048576
      ? (fileSize / 1024).toFixed(0) + " KB"
      : (fileSize / 1024 / 1024).toFixed(1) + " MB";

    downloadFile(jsonStr, "claude_all_conversations_" + filenameTimestamp() + ".json", "application/json");

    var elapsed = Math.round((Date.now() - startTime) / 1000);
    var elapsedLabel = elapsed < 60 ? elapsed + "s" : Math.round(elapsed / 60) + "m " + (elapsed % 60) + "s";
    log("DONE! " + success + " conversations, " + errors + " errors, ~" + sizeLabel, "success");

    // Show completion UI
    if (filterPanel) {
      filterPanel.innerHTML = '\
        <div class="ce-complete">\
          <div class="ce-complete-icon">\u2705</div>\
          <div class="ce-complete-title">Export Complete!</div>\
          <div class="ce-complete-sub">' + success + ' conversations \u00B7 ' + sizeLabel + ' \u00B7 ' + elapsedLabel + '</div>\
        </div>';
    }
  }

  // ========== EVENT LISTENERS ==========
  document.getElementById("ce-close").addEventListener("click", function() {
    panel.style.animation = "ce-fadein 0.2s ease-out reverse";
    setTimeout(function() { panel.remove(); style.remove(); }, 200);
  });

  document.getElementById("ce-btn-current").addEventListener("click", exportCurrentChat);
  document.getElementById("ce-btn-convos").addEventListener("click", exportConversations);

  document.getElementById("ce-toggle-log").addEventListener("click", function() {
    var logVisible = logEl.classList.contains("visible");
    logEl.classList.toggle("visible");
    this.textContent = logVisible ? "Show log \u25BC" : "Hide log \u25B2";
  });

  document.getElementById("ce-copy-log").addEventListener("click", function() {
    var copyBtn = this;
    var entries = document.querySelectorAll(".ce-log-entry");
    var text = "";
    for (var i = 0; i < entries.length; i++) {
      text += entries[i].textContent + "\n";
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        copyBtn.textContent = "\u2705 Copied!";
        setTimeout(function() { copyBtn.textContent = "Copy log"; }, 2000);
      }).catch(function() {
        copyBtn.textContent = "Copy failed";
        setTimeout(function() { copyBtn.textContent = "Copy log"; }, 2000);
      });
    }
  });

  log("Ready. Click the button to start exporting.");
})();
