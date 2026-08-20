/* 사단법인 도시공동체본부 — interactions */
(function () {
  "use strict";

  var header = document.getElementById("siteHeader");
  var navToggle = document.getElementById("navToggle");
  var mobileNav = document.getElementById("mobileNav");

  /* ---- Hero: 실사 인물 사진이 있으면 표시, 없으면 벡터 유지 ---- */
  (function () {
    var hero = document.getElementById("hero");
    var imgs = document.querySelectorAll(".people-photos img");
    if (!hero || !imgs.length) return;
    imgs.forEach(function (img) {
      var done = function () {
        // 실제로 그려질 수 있는 이미지만 인정 (깨진 파일 제외)
        if (img.complete && img.naturalWidth > 1) {
          img.classList.add("loaded");
          hero.classList.add("has-photos");
        } else {
          var pp = img.closest(".pp");
          if (pp) pp.style.display = "none";
        }
      };
      if (img.complete) { done(); }
      else {
        img.addEventListener("load", done);
        img.addEventListener("error", function () {
          var pp = img.closest(".pp");
          if (pp) pp.style.display = "none";
        });
      }
    });
  })();

  /* ---- 홈: 주요 전달 소식 + 도시공동체본부 소식 (DB에서 로드) ---- */
  (function () {
    var brief = document.getElementById("briefGrid");
    var uccGrid = document.getElementById("uccNewsGrid");
    if (!brief && !uccGrid) return;

    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    fetch("/api/home", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // 주요 최근 소식: (1) 최신 뉴스레터 피처 + (2) 기존 공지 3단(공지사항·사업안내·보도자료)
        if (brief) {
          brief.classList.add("brief-grid--feature");
          var parts = [];

          // (1) 최신 뉴스레터 (좌: 제목+요약 5줄 / 우: 이미지 2컷)
          if (data.newsletter) {
            var nl = data.newsletter;
            parts.push(
              '<a class="nl-feature" href="/newsletter">' +
                '<div class="nl-feature-text">' +
                  '<span class="nl-feature-badge">뉴스레터</span>' +
                  '<h3 class="nl-feature-title">' + esc(nl.title) + "</h3>" +
                  '<p class="nl-feature-summary">' + esc(nl.summary) + "</p>" +
                  '<span class="nl-feature-foot">' + esc(nl.source || "") +
                    (nl.date ? " · " + esc(nl.date) : "") + ' <span class="brief-arrow">→</span></span>' +
                "</div>" +
                '<div class="nl-feature-imgs">' +
                  '<span class="nl-feature-img" style="background-image:url(\'' + encodeURI(nl.image1) + "')\"></span>" +
                  '<span class="nl-feature-img" style="background-image:url(\'' + encodeURI(nl.image2) + "')\"></span>" +
                "</div>" +
              "</a>"
            );
          }

          // (2) 공지 3단 — 순서: 공지사항 → 사업안내 → 보도자료
          if (data.notices && data.notices.length) {
            var order = { notice: 0, business: 1, press: 2 };
            var notices = data.notices.slice().sort(function (a, b) {
              return (order[a.board] == null ? 9 : order[a.board]) - (order[b.board] == null ? 9 : order[b.board]);
            });
            var cards = notices.map(function (n) {
              var cls = "brief-card brief-card--" + n.board;
              if (n.post) {
                return (
                  '<a class="' + cls + '" href="/board/' + n.board + "/" + n.post.id + '">' +
                  '<span class="brief-badge">' + esc(n.name) + "</span>" +
                  '<span class="brief-en">' + esc(n.en) + "</span>" +
                  '<span class="brief-title">' + esc(n.post.title) + "</span>" +
                  '<span class="brief-foot"><span class="brief-date">' + esc(n.post.date) +
                  '</span><span class="brief-arrow">→</span></span></a>'
                );
              }
              return (
                '<a class="' + cls + '" href="/board/' + n.board + '">' +
                '<span class="brief-badge">' + esc(n.name) + "</span>" +
                '<span class="brief-en">' + esc(n.en) + "</span>" +
                '<span class="brief-title brief-empty">등록된 게시물이 없습니다.</span>' +
                '<span class="brief-foot"><span class="brief-date"></span><span class="brief-arrow">→</span></span></a>'
              );
            }).join("");
            parts.push('<div class="brief-cards">' + cards + "</div>");
          }

          brief.innerHTML = parts.join("");
        }

        // 도시공동체본부 소식 (이미지 카드, 최대 4개)
        if (uccGrid) {
          var items = (data.news || []).slice(0, 3);
          if (!items.length) {
            uccGrid.innerHTML = '<div class="ucc-empty">등록된 소식이 없습니다.</div>';
            return;
          }
          uccGrid.innerHTML = items.map(function (it) {
            var thumb = it.thumb
              ? '<span class="ucc-thumb" style="background-image:url(\'' + encodeURI(it.thumb) + "')\"></span>"
              : '<span class="ucc-thumb ucc-thumb--empty">이미지 없음</span>';
            return (
              '<a class="ucc-card" href="/board/news/' + it.id + '">' + thumb +
              '<span class="ucc-body"><span class="ucc-title">' + esc(it.title) +
              '</span><span class="ucc-date">' + esc(it.date) + "</span></span></a>"
            );
          }).join("");
        }
      })
      .catch(function () {
        if (brief) brief.innerHTML = '<div class="brief-loading">소식을 불러오지 못했습니다.</div>';
        if (uccGrid) uccGrid.innerHTML = '<div class="ucc-empty">소식을 불러오지 못했습니다.</div>';
      });
  })();

  /* ---- Sticky header state ---- */
  function onScroll() {
    if (window.scrollY > 20) header.classList.add("scrolled");
    else header.classList.remove("scrolled");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- Mobile nav toggle ---- */
  function closeMobile() {
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "메뉴 열기");
    mobileNav.hidden = true;
  }
  navToggle.addEventListener("click", function () {
    var open = navToggle.getAttribute("aria-expanded") === "true";
    if (open) {
      closeMobile();
    } else {
      navToggle.setAttribute("aria-expanded", "true");
      navToggle.setAttribute("aria-label", "메뉴 닫기");
      mobileNav.hidden = false;
    }
  });
  mobileNav.addEventListener("click", function (e) {
    if (e.target.tagName === "A") closeMobile();
  });

  /* ---- Scroll reveal ---- */
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---- Animated stat counters ---- */
  function formatNum(n) { return n.toLocaleString("ko-KR"); }
  function animateStat(el) {
    var target = parseInt(el.getAttribute("data-count"), 10) || 0;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || target === 0) { el.textContent = formatNum(target); return; }
    var start = 0, dur = 1400, t0 = null;
    function tick(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = formatNum(Math.floor(start + (target - start) * eased));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = formatNum(target);
    }
    requestAnimationFrame(tick);
  }
  var stats = document.querySelectorAll(".stat-num");
  if ("IntersectionObserver" in window && stats.length) {
    var statObs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateStat(entry.target);
            statObs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    stats.forEach(function (el) { statObs.observe(el); });
  }

  /* ---- Contact form (DB 저장) ---- */
  var form = document.getElementById("contactForm");
  var note = document.getElementById("formNote");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.name.value.trim();
      var email = form.email.value.trim();
      var msg = form.message.value.trim();
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!name || !emailOk || !msg) {
        note.textContent = "이름, 유효한 이메일, 문의 내용을 모두 입력해 주세요.";
        note.className = "form-note err";
        return;
      }
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      note.textContent = "전송 중…";
      note.className = "form-note";

      var el = function (id) { return document.getElementById(id) || {}; };
      var body = new URLSearchParams({
        _csrf: el("cf-csrf").value || "",
        name: name,
        email: email,
        phone: form.phone ? form.phone.value.trim() : "",
        topic: form.topic ? form.topic.value : "",
        message: msg,
        website: el("cf-hp").value || "",
      });

      fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body,
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (res.ok && res.d && res.d.ok) {
            note.textContent = "문의가 정상 접수되었습니다. 담당자가 확인 후 연락드리겠습니다.";
            note.className = "form-note ok";
            form.reset();
          } else {
            note.textContent = (res.d && res.d.error) || "전송에 실패했습니다. 잠시 후 다시 시도해 주세요.";
            note.className = "form-note err";
          }
        })
        .catch(function () {
          note.textContent = "전송 중 오류가 발생했습니다. contact@ucc.or.kr 로 보내주세요.";
          note.className = "form-note err";
        })
        .then(function () { if (btn) btn.disabled = false; });
    });
  }

  /* ---- Footer year ---- */
})();
