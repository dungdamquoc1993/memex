// Gemini Chat Export Script
// https://github.com/dungdamquoc1993/memex
// Exports Gemini conversations via internal API (no DOM scraping).
// No data leaves your browser - everything runs locally.
//
(function () {
  // ── memex incremental sync ──────────────────────────────────────────────
  var SINCE_DATE = null;   // injected by sync-script.ts
  var KNOWN_IDS = new Set(); // injected by sync-script.ts — raw Gemini conv IDs
  var DOWNLOAD_CONCURRENCY = 5;
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

  if (!requireHost("gemini.google.com", "Gemini", "https://gemini.google.com")) return;

  // Prevent double-loading
  if (document.getElementById("gemini-export-panel")) {
    var existing = document.getElementById("gemini-export-panel");
    existing.style.animation = "ge-shake 0.3s ease-in-out";
    setTimeout(function () { existing.style.animation = ""; }, 300);
    return;
  }

  // ========== STYLES ==========
  var style = document.createElement("style");
  style.textContent = "\
    @keyframes ge-fadein { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }\
    @keyframes ge-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }\
    @keyframes ge-spin { to { transform: rotate(360deg); } }\
    #gemini-export-panel { position: fixed; top: 50%; right: 24px; transform: translateY(-50%); width: 360px; background: #1a1a1f; border: 1px solid #333340; border-radius: 16px; box-shadow: 0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06); z-index: 999999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e8e8ec; animation: ge-fadein 0.3s ease-out; }\
    #gemini-export-panel * { box-sizing: border-box; margin: 0; padding: 0; }\
    .ge-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px 14px; border-bottom: 1px solid #2a2a35; background: #1e1e24; border-radius: 16px 16px 0 0; cursor: move; }\
    .ge-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }\
    .ge-title .brand { color: #4285f4; }\
    .ge-version { font-size: 10px; color: #666; font-weight: 600; margin-top: 2px; }\
    .ge-close { background: none; border: none; color: #777; font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 6px; line-height: 1; }\
    .ge-close:hover { background: #252530; color: #e8e8ec; }\
    .ge-body { padding: 18px 22px 14px; }\
    .ge-note { font-size: 12px; color: #a7a7b8; line-height: 1.45; padding: 10px 12px; border: 1px solid rgba(66,133,244,0.25); background: rgba(66,133,244,0.08); border-radius: 10px; margin-bottom: 12px; }\
    .ge-btn { width: 100%; padding: 14px 16px; border: 1px solid #333340; border-radius: 12px; background: #222228; color: #e8e8ec; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; margin-bottom: 10px; display: flex; align-items: center; gap: 12px; transition: all 0.15s ease; }\
    .ge-btn:hover { background: #2a2a32; border-color: #444450; transform: translateY(-1px); }\
    .ge-btn:active { transform: translateY(0); }\
    .ge-btn.running { pointer-events: none; border-color: #4285f4; }\
    .ge-btn.done { border-color: #7eb8a0; }\
    .ge-btn.error { border-color: #e07070; }\
    .ge-btn-icon { font-size: 20px; width: 28px; text-align: center; flex-shrink: 0; }\
    .ge-btn-text { flex: 1; }\
    .ge-btn-sub { font-size: 11px; color: #777; font-weight: 400; margin-top: 3px; }\
    .ge-log { margin-top: 14px; max-height: 140px; overflow-y: auto; background: #141418; border: 1px solid #252530; border-radius: 10px; padding: 10px 12px; font-family: 'SF Mono', 'Consolas', monospace; font-size: 11px; line-height: 1.6; color: #999; display: none; }\
    .ge-log.visible { display: block; }\
    .ge-log-entry { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 1px 0; }\
    .ge-log-entry.error { color: #e07070; }\
    .ge-log-entry.success { color: #7eb8a0; }\
    .ge-footer { padding: 14px 22px; border-top: 1px solid #252530; display: flex; justify-content: space-between; align-items: center; }\
    .ge-footer-text { font-size: 10px; color: #555; }\
    .ge-footer-link { font-size: 10px; color: #4285f4; text-decoration: none; }\
    .ge-footer-link:hover { text-decoration: underline; }\
    .ge-spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #444; border-top-color: #4285f4; border-radius: 50%; animation: ge-spin 0.6s linear infinite; }\
    .ge-row { display:flex; gap:10px; }\
    .ge-row .ge-btn { flex:1; }\
    .ge-toggle-log { background: none; border: none; color: #666; font-size: 11px; cursor: pointer; padding: 6px 0; margin-top: 10px; }\
    .ge-toggle-log:hover { color: #aaa; }\
    .ge-copy-log { background: none; border: none; color: #666; font-size: 11px; cursor: pointer; padding: 6px 0; margin-top: 10px; margin-left: 12px; }\
    .ge-copy-log:hover { color: #aaa; }\
    .ge-progress { margin-top: 10px; }\
    .ge-progress-bar { width: 100%; height: 5px; background: #252530; border-radius: 3px; overflow: hidden; }\
    .ge-progress-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #4285f4, #34a853); border-radius: 3px; transition: width 0.3s ease; }\
    .ge-progress-text { font-size: 11px; color: #999; margin-top: 6px; }\
    .ge-progress-sub { margin-top: 6px; font-size: 11px; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\
    .ge-row-actions { display:flex; gap:10px; margin-top: 10px; }\
    .ge-row-actions .ge-btn { margin-bottom: 0; }\
  ";
  document.head.appendChild(style);

  // ========== PANEL HTML ==========
  var panel = document.createElement("div");
  panel.id = "gemini-export-panel";
  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  var headerEl = el("div", "ge-header");
  var headerLeft = el("div");
  var titleEl = el("div", "ge-title");
  var brand = el("span", "brand", "Gemini");
  titleEl.appendChild(brand);
  titleEl.appendChild(document.createTextNode(" Chat Export"));
  headerLeft.appendChild(titleEl);
  headerLeft.appendChild(el("div", "ge-version", "memex v0.4"));

  var closeBtn = el("button", "ge-close", "×");
  closeBtn.id = "ge-close";

  headerEl.appendChild(headerLeft);
  headerEl.appendChild(closeBtn);

  var bodyEl = el("div", "ge-body");
  var note = el("div", "ge-note");
  var noteStrong = el("strong", null, "API mode:");
  noteStrong.style.color = "#e8e8ec";
  note.appendChild(noteStrong);
  note.appendChild(document.createTextNode(" fetches data directly from Gemini's internal API — no DOM scraping, no sidebar scrolling needed."));
  bodyEl.appendChild(note);

  function makeButton(id, iconText, titleText, subText) {
    var btn = el("button", "ge-btn");
    btn.id = id;
    var icon = el("div", "ge-btn-icon", iconText);
    var txt = el("div", "ge-btn-text");
    txt.appendChild(document.createTextNode(titleText));
    txt.appendChild(el("div", "ge-btn-sub", subText));
    btn.appendChild(icon);
    btn.appendChild(txt);
    return btn;
  }

  bodyEl.appendChild(makeButton("ge-btn-export-current", "💬", "Export current chat", "Fetch the currently open conversation"));
  bodyEl.appendChild(makeButton("ge-btn-export-all", "📥", "Export all conversations", "Fetch full history via API with incremental sync"));

  var progressWrap = el("div", "ge-progress");
  progressWrap.id = "ge-progress";
  progressWrap.style.display = "none";
  var progressTop = el("div", "ge-progress-top");
  var progressTitle = el("div", "ge-progress-title", "Progress");
  var progressMeta = el("div", "ge-progress-meta", "0%");
  progressMeta.id = "ge-progress-meta";
  progressTop.appendChild(progressTitle);
  progressTop.appendChild(progressMeta);
  progressWrap.appendChild(progressTop);
  var bar = el("div", "ge-progress-bar");
  var fill = el("div", "ge-progress-fill");
  fill.id = "ge-progress-fill";
  bar.appendChild(fill);
  progressWrap.appendChild(bar);
  var sub = el("div", "ge-progress-sub", "");
  sub.id = "ge-progress-sub";
  progressWrap.appendChild(sub);
  bodyEl.appendChild(progressWrap);

  var toggleLogBtn = el("button", "ge-toggle-log", "Hide log ▲");
  toggleLogBtn.id = "ge-toggle-log";
  bodyEl.appendChild(toggleLogBtn);

  var copyLogBtn = el("button", "ge-copy-log", "Copy log");
  copyLogBtn.id = "ge-copy-log";
  bodyEl.appendChild(copyLogBtn);

  var logBox = el("div", "ge-log");
  logBox.id = "ge-log";
  logBox.classList.add("visible");
  bodyEl.appendChild(logBox);

  var footerEl = el("div", "ge-footer");
  footerEl.appendChild(el("span", "ge-footer-text", "All data stays in your browser"));
  var link = el("a", "ge-footer-link", "GitHub");
  link.href = "https://github.com/dungdamquoc1993/memex";
  link.target = "_blank";
  footerEl.appendChild(link);

  panel.appendChild(headerEl);
  panel.appendChild(bodyEl);
  panel.appendChild(footerEl);
  document.body.appendChild(panel);

  // ========== DRAGGING ==========
  var isDragging = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;
  var header = panel.querySelector(".ge-header");

  header.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains("ge-close")) return;
    isDragging = true;
    var rect = panel.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    panel.style.transition = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", function (e) {
    if (!isDragging) return;
    panel.style.right = "auto";
    panel.style.transform = "none";
    panel.style.left = (e.clientX - dragOffsetX) + "px";
    panel.style.top = (e.clientY - dragOffsetY) + "px";
  });
  document.addEventListener("mouseup", function () {
    isDragging = false;
    panel.style.transition = "";
  });

  // ========== HELPERS ==========
  var logEl = document.getElementById("ge-log");
  var progressEl = document.getElementById("ge-progress");
  var progressFill = document.getElementById("ge-progress-fill");
  var progressMetaEl = document.getElementById("ge-progress-meta");
  var progressSubEl = document.getElementById("ge-progress-sub");

  function log(msg, type) {
    var entry = document.createElement("div");
    entry.className = "ge-log-entry" + (type ? " " + type : "");
    entry.textContent = msg;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setProgress(pct, meta, subText) {
    if (!progressEl) return;
    progressEl.style.display = "block";
    if (progressFill) progressFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
    if (progressMetaEl) progressMetaEl.textContent = meta || (pct + "%");
    if (progressSubEl) progressSubEl.textContent = subText || "";
  }

  function formatDuration(seconds) {
    seconds = Math.max(0, Math.round(seconds || 0));
    if (seconds < 60) return seconds + "s";
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + "m " + s + "s";
  }

  function setButtonState(btn, state, sublabel) {
    btn.className = "ge-btn " + state;
    var iconEl = btn.querySelector(".ge-btn-icon");
    while (iconEl.firstChild) iconEl.removeChild(iconEl.firstChild);
    if (state === "running") {
      var sp = document.createElement("div");
      sp.className = "ge-spinner";
      iconEl.appendChild(sp);
    } else if (state === "done") {
      iconEl.textContent = "✅";
    } else if (state === "error") {
      iconEl.textContent = "❌";
    }
    if (sublabel) {
      var sub = btn.querySelector(".ge-btn-sub");
      if (sub) sub.textContent = sublabel;
    }
  }

  function downloadFile(content, filename, type) {
    var blob = new Blob([content], { type: type || "text/plain" });
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

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function getCurrentTitle() {
    var t = (document.title || "").trim();
    if (!t) return "Untitled";
    t = t.replace(/\s*[-—]\s*Gemini.*$/i, "").replace(/^Gemini\s*[-—]\s*/i, "").trim();
    return t || "Untitled";
  }

  function getConversationIdFromUrl() {
    var p = window.location.pathname || "";
    var m = p.match(/\/app\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    var q = new URLSearchParams(window.location.search || "");
    return q.get("c") || q.get("chat") || q.get("conversation") || null;
  }

  // ========== GWF API CLIENT ==========

  var _at = null, _bl = null, _sid = "";
  var _reqId = Math.floor(Math.random() * 900000) + 100000;

  function extractAt() {
    // Strategy 1: WIZ_global_data.SNlM0e (standard Google CSRF token location)
    try {
      if (window.WIZ_global_data && window.WIZ_global_data.SNlM0e) {
        return window.WIZ_global_data.SNlM0e;
      }
    } catch (_) {}
    // Strategy 2: scan inline scripts for "SNlM0e":"..."
    var scripts = document.querySelectorAll("script:not([src])");
    for (var i = 0; i < scripts.length; i++) {
      var m = scripts[i].textContent.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
      if (m) return m[1];
    }
    return null;
  }

  function extractBlAndSid() {
    var bl = null, sid = null;
    // From existing batchexecute request URLs in performance entries
    var entries = performance.getEntriesByType("resource");
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].name.indexOf("batchexecute") === -1) continue;
      try {
        var u = new URL(entries[i].name);
        if (!bl) bl = u.searchParams.get("bl");
        if (!sid) sid = u.searchParams.get("f.sid");
        if (bl && sid) break;
      } catch (_) {}
    }
    // Fallback for bl: scan inline scripts for cfb2h key
    if (!bl) {
      var scripts = document.querySelectorAll("script:not([src])");
      for (var j = 0; j < scripts.length; j++) {
        var m = scripts[j].textContent.match(/"cfb2h"\s*:\s*"([^"]+)"/);
        if (m) { bl = m[1]; break; }
      }
    }
    return { bl: bl, sid: sid || "" };
  }

  function initAuth() {
    _at = extractAt();
    var bs = extractBlAndSid();
    _bl = bs.bl;
    _sid = bs.sid;
    if (!_at) throw new Error("Could not find auth token. Make sure gemini.google.com is fully loaded.");
    if (!_bl) throw new Error("Could not find build version. Try refreshing the page and running again.");
  }

  // Extract a JSON string value from `text` starting at position `pos` (which must be `"`).
  // Returns the parsed (unescaped) string, or null on failure.
  function extractJsonStr(text, pos) {
    if (pos >= text.length || text[pos] !== '"') return null;
    var end = pos + 1;
    while (end < text.length) {
      var c = text[end];
      if (c === "\\") { end += 2; continue; }
      if (c === '"') { end++; break; }
      end++;
    }
    try {
      return JSON.parse(text.substring(pos, end));
    } catch (_) {
      return null;
    }
  }

  // Parse a GWF batchexecute response and return the inner payload for `rpcId`.
  function parseGWF(text, rpcId) {
    if (text.indexOf("wrb.fr") === -1 && /^[A-Za-z0-9+/=\r\n]+$/.test((text || "").trim())) {
      try {
        var binary = atob(text.trim());
        var bytes = new Uint8Array(binary.length);
        for (var bi = 0; bi < binary.length; bi++) bytes[bi] = binary.charCodeAt(bi);
        var decoded = new TextDecoder("utf-8").decode(bytes);
        if (decoded.indexOf("wrb.fr") !== -1) text = decoded;
      } catch (_) {}
    }

    // Strip )]}'\n CSRF prefix
    if (text.indexOf(")]}'") === 0) {
      var nlIdx = text.indexOf("\n");
      if (nlIdx !== -1) text = text.substring(nlIdx + 1);
    }

    // Remove chunk-size lines (lines containing only digits)
    text = text.replace(/^[0-9]+\r?\n/gm, "");

    function parseInnerPayload(value) {
      if (typeof value !== "string") return null;
      try {
        return JSON.parse(value);
      } catch (e) {
        log("[parseGWF] inner JSON parse failed for " + rpcId + ": " + e.message, "error");
        return null;
      }
    }

    function parseChunkLines() {
      var lines = text.split(/\r?\n/);
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li].trim();
        if (!line || line[0] !== "[") continue;
        try {
          var chunk = JSON.parse(line);
          if (!Array.isArray(chunk)) continue;
          for (var ci = 0; ci < chunk.length; ci++) {
            var row = chunk[ci];
            if (Array.isArray(row) && row[0] === "wrb.fr" && row[1] === rpcId) {
              return parseInnerPayload(row[2]);
            }
          }
        } catch (_) {}
      }
      return null;
    }

    // Find the wrb.fr entry for our rpcId
    var marker = '"wrb.fr","' + rpcId + '",';
    var idx = text.indexOf(marker);
    if (idx === -1) return parseChunkLines();

    // Skip to the position of the inner JSON string (right after the comma)
    var pos = idx + marker.length;
    // Skip whitespace
    while (pos < text.length && text[pos] === " ") pos++;

    // Extract and unescape the inner JSON string
    var innerStr = extractJsonStr(text, pos);
    if (!innerStr) return null;

    return parseInnerPayload(innerStr) || parseChunkLines();
  }

  async function callGWF(rpcId, innerParams, sourcePath) {
    _reqId += 100000 + Math.floor(Math.random() * 100000);
    var sp = sourcePath || "/app";
    var url = "/_/BardChatUi/data/batchexecute"
      + "?rpcids=" + rpcId
      + "&source-path=" + encodeURIComponent(sp)
      + "&bl=" + encodeURIComponent(_bl)
      + "&f.sid=" + encodeURIComponent(_sid)
      + "&hl=en"
      + "&_reqid=" + _reqId
      + "&rt=c";

    var innerJson = JSON.stringify(innerParams);
    var fReq = JSON.stringify([[[rpcId, innerJson, null, "generic"]]]);
    var body = "f.req=" + encodeURIComponent(fReq) + "&at=" + encodeURIComponent(_at) + "&";

    var resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-same-domain": "1"
      },
      body: body
    });

    if (!resp.ok) throw new Error("HTTP " + resp.status + " calling " + rpcId);
    var text = await resp.text();
    var parsed = parseGWF(text, rpcId);
    if (parsed === null) {
      console.log("[memex:" + rpcId + "] parseGWF returned null. Raw response:", text.slice(0, 1200));
    }
    return parsed;
  }

  function summarizeShape(data) {
    if (!data || !Array.isArray(data)) return "null/non-array";
    var shape = data.map(function(x) {
      if (x === null) return "null";
      if (Array.isArray(x)) return "arr(" + x.length + ")";
      if (typeof x === "string") return "str(" + x.length + ")";
      return typeof x;
    });
    return "shape[" + data.length + "]: [" + shape.join(", ") + "]";
  }

  // Fetch a page of the conversation list.
  // Returns { token: string|null, convs: Array }
  // Each conv entry: [id, title, null, null, null, [ts_sec, ts_ns], null, null, null, int]
  async function fetchConvList(pageToken) {
    // HAR trace: [13,null,[1,null,1]] can return [], while [13,null,[0,null,1]]
    // returns the visible chat history.
    var paramsList = pageToken
      ? [[13, pageToken, [0, null, 1]], [13, pageToken, [1, null, 1]]]
      : [[13, null, [0, null, 1]], [13, null, [1, null, 1]]];

    for (var pi = 0; pi < paramsList.length; pi++) {
      for (var attempt = 1; attempt <= 2; attempt++) {
        var params = paramsList[pi];
        var data = await callGWF("MaZiqc", params, "/app");

        // Debug: log structure so we can diagnose parsing issues
        console.log("[memex:MaZiqc] raw data:", JSON.stringify(data).slice(0, 800));
        if (data && Array.isArray(data)) {
          var msg = "[memex:MaZiqc] " + summarizeShape(data);
          log(msg);
          console.log(msg);
        }

        if (!data || !Array.isArray(data)) {
          log("[memex:MaZiqc] parse returned null/non-array; retrying list variant " + (pi + 1) + ", attempt " + attempt, "error");
          await sleep(500);
          continue;
        }

        var convs = findGeminiConvArray(data);
        var token = findGeminiPageToken(data);

        if (convs) {
          return { token: token, convs: convs };
        }

        log("[memex:MaZiqc] conversations array not found for list variant " + (pi + 1), "error");
        if (token) return { token: token, convs: [] };
      }
    }

    return { token: null, convs: [] };
  }

  function isGeminiConvMeta(value) {
    return Array.isArray(value)
      && typeof value[0] === "string"
      && value[0].indexOf("c_") === 0
      && typeof value[1] === "string";
  }

  function findGeminiConvArray(node) {
    if (!Array.isArray(node)) return null;
    if (node.length > 0 && isGeminiConvMeta(node[0])) return node;
    for (var i = 0; i < node.length; i++) {
      var found = findGeminiConvArray(node[i]);
      if (found) return found;
    }
    return null;
  }

  function findGeminiPageToken(node) {
    if (!Array.isArray(node)) return null;
    for (var i = 0; i < node.length; i++) {
      if (typeof node[i] === "string" && node[i].length > 20 && node[i].indexOf("c_") !== 0) {
        return node[i];
      }
    }
    for (var j = 0; j < node.length; j++) {
      var found = findGeminiPageToken(node[j]);
      if (found) return found;
    }
    return null;
  }

  // Fetch full content of a single conversation.
  // convId format: "c_9ced66f029b65e87"
  async function fetchConvContent(convId, maxTurns) {
    var shortId = convId.replace(/^c_/, "");
    // params: [convId, maxTurns, null, 1, [responseVariant], [dataFlags], null, 1]
    var params = [convId, maxTurns || 1000, null, 1, [1], [4], null, 1];
    return await callGWF("hNvQHb", params, "/app/" + shortId);
  }

  // Safely navigate a nested array/object path. Returns undefined if any step is null/missing.
  function safeGet(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function contentStrings(node, out) {
    out = out || [];
    if (typeof node === "string") {
      var s = node.trim();
      if (!s) return out;
      if (/^(c|r|rc)_[a-zA-Z0-9_-]+$/.test(s)) return out;
      if (/^[a-f0-9]{12,}$/i.test(s)) return out;
      out.push(s);
      return out;
    }
    if (!Array.isArray(node)) return out;
    for (var i = 0; i < node.length; i++) {
      contentStrings(node[i], out);
    }
    return out;
  }

  function uniqueJoin(parts) {
    var seen = {};
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = (parts[i] || "").trim();
      if (!p || seen[p]) continue;
      seen[p] = true;
      out.push(p);
    }
    return out.join("\n\n").trim();
  }

  function assistantStrings(node, out) {
    out = out || [];
    if (!Array.isArray(node)) return out;
    if (typeof node[0] === "string" && node[0].indexOf("rc_") === 0 && Array.isArray(node[1])) {
      contentStrings(node[1], out);
      return out;
    }
    for (var i = 0; i < node.length; i++) {
      assistantStrings(node[i], out);
    }
    return out;
  }

  function userTextFromTurn(turn) {
    var userText = safeGet(turn, [2, 0, 0]);
    if (typeof userText !== "string") userText = safeGet(turn, [2, 0]);
    if (typeof userText === "string" && userText.trim()) return userText.trim();
    return uniqueJoin(contentStrings(turn[2], []));
  }

  function assistantTextFromTurn(turn) {
    var assistText = safeGet(turn, [3, 0, 0, 1, 0]);
    if (typeof assistText !== "string") assistText = safeGet(turn, [3, 0, 1, 0]);
    if (typeof assistText === "string" && assistText.trim()) return assistText.trim();
    return uniqueJoin(assistantStrings(turn[3], []));
  }

  // Parse a hNvQHb response into an array of { role, content, timestamp } message objects.
  // convTs: [sec, ns] from MaZiqc (used as fallback timestamp)
  function parseConvContent(data, convTs) {
    if (!data || !Array.isArray(data)) return [];
    var convSec = (convTs && convTs[0]) ? convTs[0] : 0;

    // Debug: dump top-level structure
    console.log("[memex:hNvQHb] raw data (800 chars):", JSON.stringify(data).slice(0, 800));

    var turns = findGeminiTurns(data);
    if (!Array.isArray(turns) || turns.length === 0) {
      console.log("[memex:hNvQHb] could not locate turns array. data[0][0]=", JSON.stringify(safeGet(data,[0,0])).slice(0,200));
      log("[memex:hNvQHb] turns not found — check browser console for details", "error");
      return [];
    }

    var messages = [];

    for (var ti = 0; ti < turns.length; ti++) {
      var turn = turns[ti];
      if (!turn || !Array.isArray(turn)) continue;

      // ── User message ──
      // turn[2] = [text_array, type, null, int, model_id, ...]
      // text at turn[2][0][0]
      var userText = userTextFromTurn(turn);
      if (typeof userText === "string" && userText.trim()) {
        messages.push({ role: "user", content: userText.trim(), timestamp: convSec, model: null });
      }

      // ── Assistant response ──
      // Primary candidate: turn[3][0][0] = [response_id, [text, ...], ...]
      // Text at turn[3][0][0][1][0]
      var assistText = assistantTextFromTurn(turn);
      if (typeof assistText === "string" && assistText.trim()) {
        messages.push({ role: "assistant", content: assistText.trim(), timestamp: convSec, model: null });
      }

      // Debug first turn if nothing was found
      if (ti === 0 && messages.length === 0) {
        console.log("[memex:hNvQHb] turn[0] structure:", JSON.stringify(turn).slice(0, 500));
      }
    }

    return messages;
  }

  function isGeminiTurn(value) {
    return Array.isArray(value)
      && Array.isArray(value[0])
      && typeof value[0][0] === "string"
      && value[0][0].indexOf("c_") === 0
      && Array.isArray(value[2])
      && Array.isArray(value[3]);
  }

  function isLikelyGeminiTurn(value) {
    return Array.isArray(value)
      && Array.isArray(value[0])
      && typeof value[0][0] === "string"
      && (value[0][0].indexOf("c_") === 0 || value[0][0].indexOf("r_") === 0)
      && Array.isArray(value[2])
      && Array.isArray(value[3])
      && (userTextFromTurn(value) || assistantTextFromTurn(value));
  }

  function findGeminiTurns(data) {
    var turns = [];

    function walk(node) {
      if (!Array.isArray(node)) return;
      if (isGeminiTurn(node) || isLikelyGeminiTurn(node)) {
        turns.push(node);
        return;
      }
      for (var i = 0; i < node.length; i++) {
        walk(node[i]);
      }
    }

    walk(data);
    return turns;
  }

  async function fetchConvMessages(convId, convTs) {
    var maxTurnsList = [1000, 100, 10];
    var lastData = null;

    for (var i = 0; i < maxTurnsList.length; i++) {
      var maxTurns = maxTurnsList[i];
      var data = await fetchConvContent(convId, maxTurns);
      lastData = data;
      var messages = parseConvContent(data, convTs);
      if (messages && messages.length > 0) return messages;
      if (i < maxTurnsList.length - 1) {
        log("[memex:hNvQHb] no messages with maxTurns=" + maxTurns + "; retrying", "error");
        await sleep(350);
      }
    }

    console.log("[memex:hNvQHb] all detail attempts empty for", convId, JSON.stringify(lastData).slice(0, 1200));
    return [];
  }

  // ========== EXPORT FUNCTIONS ==========

  async function exportCurrentChat() {
    var btn = document.getElementById("ge-btn-export-current");
    setButtonState(btn, "running", "Fetching…");
    try {
      initAuth();
      var shortId = getConversationIdFromUrl();
      if (!shortId) throw new Error("No conversation ID in URL. Open a chat first.");
      var convId = "c_" + shortId;

      log("Fetching conversation " + shortId + "…");
      var messages = await fetchConvMessages(convId, null);

      if (!messages || messages.length === 0) {
        throw new Error("No messages found. The API response may have an unexpected format.");
      }

      var title = getCurrentTitle();
      var result = {
        export_date: new Date().toISOString(),
        tool: "memex gemini-export v0.4",
        source: "gemini.google.com",
        format_version: 1,
        total_conversations: 1,
        conversations: [{
          id: shortId,
          title: title,
          create_time: 0,
          update_time: 0,
          model: null,
          source: "gemini",
          message_count: messages.length,
          messages: messages
        }]
      };
      downloadFile(JSON.stringify(result, null, 2), "gemini_current_conversation.json", "application/json");
      setButtonState(btn, "done", messages.length + " messages");
      log("Exported: " + title + " (" + messages.length + " messages)", "success");
    } catch (e) {
      setButtonState(btn, "error", (e.message || String(e)).slice(0, 60));
      log("Error: " + (e.message || String(e)), "error");
    }
  }

  async function exportAllConversations() {
    var btn = document.getElementById("ge-btn-export-all");
    setButtonState(btn, "running", "Initializing…");

    try {
      initAuth();
    } catch (e) {
      setButtonState(btn, "error", (e.message || "Auth failed").slice(0, 60));
      log("Auth failed: " + (e.message || String(e)), "error");
      return;
    }

    log("Auth OK. Fetching conversation list…");

    // ── Phase 1: collect all conversation metadata via MaZiqc (paginated) ──
    var allMeta = [];
    var token = null;
    var page = 0;
    var maxPages = 200; // safety cap (~2600 conversations)

    do {
      try {
        var result = await fetchConvList(token);
        allMeta = allMeta.concat(result.convs);
        token = result.token;
        page++;
        log("Page " + page + ": +" + result.convs.length + " conversations (total: " + allMeta.length + ")");
        if (result.convs.length === 0) break;
        await sleep(200);
      } catch (e) {
        log("Error fetching list page " + page + ": " + (e.message || String(e)), "error");
        break;
      }
    } while (token && page < maxPages);

    log("Found " + allMeta.length + " total conversations.", "success");

    // ── Phase 2: filter against KNOWN_IDS for incremental sync ──
    var toFetch = allMeta.filter(function (c) {
      var rawId = (c[0] || "").replace(/^c_/, "");
      return !KNOWN_IDS.has(rawId) && !KNOWN_IDS.has(c[0] || "");
    });

    log("New / unsynced: " + toFetch.length + " conversations to fetch.");

    if (toFetch.length === 0) {
      setProgress(100, "Up to date", "No new conversations");
      setButtonState(btn, "done", "Already up to date");
      return;
    }

    // ── Phase 3: fetch content for each new conversation via hNvQHb ──
    var outConvos = new Array(toFetch.length);
    var failures = 0;
    var success = 0;
    var completed = 0;
    var nextIndex = 0;
    var startTime = Date.now();

    function updateDownloadProgress(workerIndex, title) {
      var pct = Math.round((completed / toFetch.length) * 100);
      var elapsedSec = (Date.now() - startTime) / 1000;
      var perItem = elapsedSec / Math.max(1, completed);
      var remaining = perItem * (toFetch.length - completed);
      setProgress(
        pct,
        completed + "/" + toFetch.length + " · " + pct + "% · ~" + formatDuration(remaining) + " left · " + DOWNLOAD_CONCURRENCY + " parallel",
        "Worker " + (workerIndex + 1) + ": " + title
      );
    }

    async function downloadWorker(workerIndex) {
      while (true) {
        var i = nextIndex++;
        if (i >= toFetch.length) return;

        var meta = toFetch[i];
        var convId  = meta[0] || "";          // "c_9ced66f029b65e87"
        var title   = meta[1] || "Untitled";
        var convTs  = meta[5];                // [ts_sec, ts_ns] or null
        var convSec = (convTs && convTs[0]) ? convTs[0] : 0;
        var shortId = convId.replace(/^c_/, "");

        if (!shortId) {
          failures++;
          log("Skip: bad conv ID at index " + i, "error");
          completed++;
          updateDownloadProgress(workerIndex, title);
          continue;
        }

        try {
          var messages = await fetchConvMessages(convId, convTs);

          if (!messages || messages.length === 0) {
            failures++;
            log("No messages: " + title, "error");
            outConvos[i] = {
              id: shortId, title: title,
              create_time: convSec, update_time: convSec,
              model: null, source: "gemini",
              message_count: 0, messages: []
            };
          } else {
            success++;
            outConvos[i] = {
              id: shortId, title: title,
              create_time: convSec, update_time: convSec,
              model: null, source: "gemini",
              message_count: messages.length, messages: messages
            };
            log("OK: " + title + " (" + messages.length + " msgs)", "success");
          }
        } catch (e) {
          failures++;
          log("Error: " + title + " — " + (e.message || String(e)), "error");
          outConvos[i] = {
            id: shortId, title: title,
            create_time: convSec, update_time: convSec,
            model: null, source: "gemini",
            message_count: 0, messages: [],
            error: e.message || String(e)
          };
        }

        completed++;
        updateDownloadProgress(workerIndex, title);

        if (completed % 25 === 0 || completed === toFetch.length) {
          log("Progress: " + completed + "/" + toFetch.length + " (" + success + " OK, " + failures + " empty/errors)");
        }

        await sleep(DOWNLOAD_WORKER_DELAY_MS);
      }
    }

    log("Downloading with " + DOWNLOAD_CONCURRENCY + " parallel workers.");
    var workerCount = Math.min(DOWNLOAD_CONCURRENCY, toFetch.length);
    var workers = [];
    for (var wi = 0; wi < workerCount; wi++) {
      workers.push(downloadWorker(wi));
    }
    await Promise.all(workers);
    outConvos = outConvos.filter(function(c) { return !!c; });

    // ── Download ──
    var exportData = {
      export_date: new Date().toISOString(),
      tool: "memex gemini-export v0.4",
      source: "gemini.google.com",
      format_version: 1,
      total_conversations: outConvos.length,
      conversations: outConvos
    };
    var dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    var filename = "gemini_" + dateStr + ".json";
    downloadFile(JSON.stringify(exportData, null, 2), filename, "application/json");

    var ok = outConvos.filter(function (c) { return c.messages && c.messages.length > 0; }).length;
    setProgress(100, "Done · " + ok + "/" + outConvos.length, "Downloaded " + filename);
    setButtonState(btn, "done", ok + "/" + toFetch.length + " exported");
    log("DONE: " + ok + " OK, " + failures + " empty/errors.", failures ? "error" : "success");
  }

  // ========== EVENTS ==========
  document.getElementById("ge-close").addEventListener("click", function () {
    panel.style.animation = "ge-fadein 0.2s ease-out reverse";
    setTimeout(function () { panel.remove(); style.remove(); }, 200);
  });
  document.getElementById("ge-btn-export-current").addEventListener("click", exportCurrentChat);
  document.getElementById("ge-btn-export-all").addEventListener("click", exportAllConversations);
  document.getElementById("ge-toggle-log").addEventListener("click", function () {
    var logVisible = logEl.classList.contains("visible");
    logEl.classList.toggle("visible");
    this.textContent = logVisible ? "Show log ▼" : "Hide log ▲";
  });
  document.getElementById("ge-copy-log").addEventListener("click", function () {
    var text = Array.from(logEl.querySelectorAll(".ge-log-entry")).map(function (e) { return e.textContent; }).join("\n");
    navigator.clipboard.writeText(text).then(function () {
      var btn = document.getElementById("ge-copy-log");
      if (btn) { btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = "Copy log"; }, 1500); }
    });
  });

  log("Ready. Click Export to start.");
})();
