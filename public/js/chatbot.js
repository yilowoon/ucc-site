/* 도시공동체본부 소개 챗봇 — 자체 주입형 플로팅 위젯
 * 서버: POST /api/chat (message, history) · GET /api/chat/config
 */
(function () {
  "use strict";
  if (window.__uccChatLoaded) return;
  window.__uccChatLoaded = true;
  // 관리자 화면에서는 숨김
  if (location.pathname.indexOf("/admin") === 0) return;

  var GREETING = "안녕하세요! 사단법인 도시공동체본부 안내 도우미입니다. 비전·사업·회원제도·사람들 등 무엇이든 물어보세요.";
  var SUGGESTIONS = [
    "도시공동체본부는 어떤 곳인가요?",
    "미션과 비전이 궁금해요",
    "어떤 사업을 하나요?",
    "회원 가입은 어떻게 하나요?",
  ];
  var history = [];        // {role:'user'|'bot', text}
  var opened = false, busy = false, configLoaded = false;

  /* ---------- 스타일 ---------- */
  var css = ""
    + "#uccChatBtn{position:fixed;right:20px;bottom:20px;z-index:9998;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;"
    + "background:linear-gradient(150deg,#1a4a3a,#123a2e);color:#fff;box-shadow:0 10px 26px -8px rgba(14,42,32,.6);display:flex;align-items:center;justify-content:center;transition:transform .18s ease}"
    + "#uccChatBtn:hover{transform:translateY(-2px)}"
    + "#uccChatBtn svg{width:28px;height:28px}"
    + "#uccChatBtn .badge{position:absolute;top:-3px;right:-3px;background:#cd9b4c;color:#231800;font-size:10px;font-weight:800;border-radius:10px;padding:2px 6px}"
    + "#uccChat{position:fixed;right:20px;bottom:92px;z-index:9999;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);"
    + "background:#fff;border:1px solid #e4e2da;border-radius:18px;box-shadow:0 24px 60px -20px rgba(14,42,32,.55);display:none;flex-direction:column;overflow:hidden;"
    + "font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif}"
    + "#uccChat.open{display:flex;animation:uccChatIn .2s ease}"
    + "@keyframes uccChatIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}"
    + ".ucc-head{background:linear-gradient(150deg,#123a2e,#0e2a20);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}"
    + ".ucc-head .dot{width:9px;height:9px;border-radius:50%;background:#7ddba0;box-shadow:0 0 0 3px rgba(125,219,160,.25)}"
    + ".ucc-head b{font-size:15px;font-weight:700}"
    + ".ucc-head small{display:block;font-size:11px;color:rgba(255,255,255,.65);margin-top:1px}"
    + ".ucc-head .x{margin-left:auto;background:transparent;border:none;color:rgba(255,255,255,.8);font-size:20px;cursor:pointer;line-height:1;padding:4px}"
    + ".ucc-head .x:hover{color:#fff}"
    + ".ucc-msgs{flex:1;overflow-y:auto;padding:16px;background:#f8f6f0;display:flex;flex-direction:column;gap:10px}"
    + ".ucc-m{max-width:85%;padding:10px 13px;border-radius:14px;font-size:13.7px;line-height:1.6;white-space:pre-wrap;word-break:break-word}"
    + ".ucc-m.bot{background:#fff;border:1px solid #e9e6dd;color:#1f2937;align-self:flex-start;border-bottom-left-radius:4px}"
    + ".ucc-m.user{background:#1a4a3a;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}"
    + ".ucc-m a{color:inherit;text-decoration:underline}"
    + ".ucc-sugg{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}"
    + ".ucc-sugg button{background:#fff;border:1px solid #cdb98a;color:#8a6d2f;font-size:12px;border-radius:20px;padding:6px 12px;cursor:pointer;font-family:inherit}"
    + ".ucc-sugg button:hover{background:#faf6ec}"
    + ".ucc-typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:#fff;border:1px solid #e9e6dd;border-radius:14px}"
    + ".ucc-typing i{width:7px;height:7px;border-radius:50%;background:#b9c2bc;animation:uccBlink 1.2s infinite}"
    + ".ucc-typing i:nth-child(2){animation-delay:.2s}.ucc-typing i:nth-child(3){animation-delay:.4s}"
    + "@keyframes uccBlink{0%,60%,100%{opacity:.3}30%{opacity:1}}"
    + ".ucc-in{display:flex;gap:8px;padding:12px;border-top:1px solid #ece9e0;background:#fff}"
    + ".ucc-in textarea{flex:1;resize:none;border:1px solid #dcd8cc;border-radius:12px;padding:10px 12px;font-size:13.5px;font-family:inherit;max-height:88px;outline:none}"
    + ".ucc-in textarea:focus{border-color:#1a4a3a}"
    + ".ucc-in button{background:#cd9b4c;color:#231800;border:none;border-radius:12px;width:44px;font-size:18px;cursor:pointer;flex-shrink:0}"
    + ".ucc-in button:disabled{opacity:.5;cursor:default}"
    + ".ucc-note{font-size:10.5px;color:#8b8b8b;text-align:center;padding:0 12px 10px;background:#fff}"
    + "@media(max-width:480px){#uccChat{right:8px;left:8px;width:auto;bottom:84px;height:calc(100vh - 104px)}}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- DOM ---------- */
  var btn = document.createElement("button");
  btn.id = "uccChatBtn";
  btn.setAttribute("aria-label", "도시공동체본부 안내 챗봇 열기");
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg><span class="badge">AI</span>';

  var panel = document.createElement("div");
  panel.id = "uccChat";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "도시공동체본부 안내 챗봇");
  panel.innerHTML =
    '<div class="ucc-head"><span class="dot"></span><div><b>도시공동체본부 안내</b><small>AI 도우미 · 소개 안내</small></div><button class="x" aria-label="닫기">&times;</button></div>'
    + '<div class="ucc-msgs" id="uccMsgs"></div>'
    + '<div class="ucc-in"><textarea id="uccInput" rows="1" placeholder="궁금한 점을 입력하세요…" aria-label="메시지 입력"></textarea><button id="uccSend" aria-label="보내기">➤</button></div>'
    + '<div class="ucc-note">AI가 공개된 본부 소개 정보를 바탕으로 답합니다. 정확한 확인은 1670-9678로 문의해 주세요.</div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var msgs = panel.querySelector("#uccMsgs");
  var input = panel.querySelector("#uccInput");
  var send = panel.querySelector("#uccSend");

  /* ---------- 유틸 ---------- */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function linkify(s) {
    // 이메일·전화·URL을 링크로
    return esc(s)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '<a href="mailto:$1">$1</a>')
      .replace(/\n/g, "<br>");
  }
  function scrollBottom() { msgs.scrollTop = msgs.scrollHeight; }

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "ucc-m " + (role === "user" ? "user" : "bot");
    el.innerHTML = linkify(text);
    msgs.appendChild(el);
    scrollBottom();
    return el;
  }

  function addSuggestions() {
    if (!SUGGESTIONS.length) return;
    var wrap = document.createElement("div");
    wrap.className = "ucc-sugg";
    SUGGESTIONS.forEach(function (q) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = q;
      b.addEventListener("click", function () { wrap.remove(); ask(q); });
      wrap.appendChild(b);
    });
    msgs.appendChild(wrap);
    scrollBottom();
  }

  var typingEl = null;
  function showTyping() {
    typingEl = document.createElement("div");
    typingEl.className = "ucc-typing";
    typingEl.innerHTML = "<i></i><i></i><i></i>";
    msgs.appendChild(typingEl); scrollBottom();
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  function ask(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true; send.disabled = true;
    addMsg("user", text);
    history.push({ role: "user", text: text });
    input.value = ""; autosize();
    showTyping();

    var body = new URLSearchParams();
    body.set("message", text);
    body.set("history", JSON.stringify(history.slice(-6)));

    fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        hideTyping();
        var reply = (d && d.reply) || "죄송합니다. 지금은 답변이 어렵습니다. 1670-9678로 문의해 주세요.";
        addMsg("bot", reply);
        history.push({ role: "bot", text: reply });
      })
      .catch(function () {
        hideTyping();
        addMsg("bot", "연결에 문제가 있습니다. 잠시 후 다시 시도해 주세요.");
      })
      .finally(function () { busy = false; send.disabled = false; input.focus(); });
  }

  /* ---------- 열기/닫기 ---------- */
  function loadConfig() {
    if (configLoaded) return Promise.resolve();
    configLoaded = true;
    return fetch("/api/chat/config").then(function (r) { return r.json(); }).then(function (c) {
      if (c && c.greeting) GREETING = c.greeting;
      if (c && Array.isArray(c.suggestions) && c.suggestions.length) SUGGESTIONS = c.suggestions;
    }).catch(function () {});
  }

  function open() {
    panel.classList.add("open");
    btn.style.display = "none";
    loadConfig().then(function () {
      if (!opened) {
        opened = true;
        addMsg("bot", GREETING);
        addSuggestions();
      }
      input.focus();
    });
  }
  function close() { panel.classList.remove("open"); btn.style.display = "flex"; }

  btn.addEventListener("click", open);
  panel.querySelector(".x").addEventListener("click", close);

  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 88) + "px"; }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input.value); }
  });
  send.addEventListener("click", function () { ask(input.value); });
})();
