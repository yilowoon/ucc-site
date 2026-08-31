/* mail-templates.js — 발송 메일 본문(HTML+텍스트) 생성.
 * 라우트에서 분리해 재사용·미리보기 테스트가 가능하도록 함.
 */
"use strict";

const cfg = require("./config");
const esc = cfg.escapeHtml || ((s) => String(s == null ? "" : s));

const MEMBER_FEE = { "개인회원": 10000, "기업회원": 300000, "단체회원": 0 };

// ISO → "YYYY년 M월 D일" (KST)
function dateKo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}

// 정회원 전환 환영 메일 — { subject, text, html } 반환
function welcomeMemberMail(m, paidAt) {
  const fee = MEMBER_FEE[m.member_type] || 0;
  const paidDate = dateKo(paidAt);
  const feeText = fee > 0
    ? `${paidDate}, 회비 ${fee.toLocaleString()}원이 정상적으로 납부되었습니다.`
    : `${paidDate}, ${m.member_type}(회비 면제)으로 정상 등록되었습니다.`;

  const subject = "[사단법인 도시공동체본부] 정회원 전환 완료 — 회원가입을 환영합니다";

  const text =
    `${m.name}님, 사단법인 도시공동체본부 회원가입을 진심으로 환영합니다.\n\n` +
    `${feeText}\n` +
    `이제 정회원으로서 본부의 다양한 활동과 혜택에 함께하실 수 있습니다.\n\n` +
    `· 회원유형: ${m.member_type}\n` +
    `· 회원자격: 정회원\n` +
    (fee > 0 ? `· 납부금액: ${fee.toLocaleString()}원\n` : "") +
    `· 회비납부일: ${paidDate}\n\n` +
    `다시 한번 도시공동체본부의 정회원이 되신 것을 환영합니다.\n감사합니다.\n\n` +
    `사단법인 도시공동체본부 사무처\n대표전화 1670-9678 · https://ucc.or.kr`;

  const row = (label, val) =>
    `<tr><td style="padding:9px 0;color:#6b766f;font-size:13px;width:96px;vertical-align:top">${label}</td>` +
    `<td style="padding:9px 0;color:#16211c;font-size:14px;font-weight:600">${val}</td></tr>`;

  const html =
    '<div style="font-family:\'Malgun Gothic\',AppleSDGothicNeo,sans-serif;background:#eef1ec;padding:28px 14px">' +
    '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e2da;border-radius:14px;overflow:hidden">' +
      '<div style="background:#123a2e;color:#fff;padding:22px 26px">' +
        '<div style="font-size:13px;letter-spacing:1px;color:#d8b25f;font-weight:700;margin-bottom:4px">URBAN COMMUNITY CENTER</div>' +
        '<div style="font-size:19px;font-weight:800">정회원 전환을 축하드립니다</div>' +
      '</div>' +
      '<div style="padding:26px">' +
        `<p style="font-size:16px;color:#16211c;margin:0 0 6px"><b>${esc(m.name)}</b>님, 반갑습니다.</p>` +
        '<p style="font-size:14px;color:#3a463f;line-height:1.7;margin:0 0 20px">사단법인 도시공동체본부 회원가입을 진심으로 환영합니다. ' +
        `${esc(feeText)} 이제 <b style="color:#123a2e">정회원</b>으로서 본부의 다양한 활동과 혜택에 함께하실 수 있습니다.</p>` +
        '<div style="background:#f8f6f0;border:1px solid #eee7d6;border-radius:10px;padding:6px 18px;margin:0 0 22px">' +
          '<table style="width:100%;border-collapse:collapse">' +
            row("회원유형", esc(m.member_type)) +
            row("회원자격", '<span style="display:inline-block;background:#123a2e;color:#fff;font-size:12px;font-weight:700;padding:3px 12px;border-radius:999px">정회원</span>') +
            (fee > 0 ? row("납부금액", fee.toLocaleString() + "원") : "") +
            row("회비납부일", paidDate) +
          '</table>' +
        '</div>' +
        '<p style="font-size:14px;color:#3a463f;line-height:1.7;margin:0 0 6px">다시 한번 도시공동체본부의 정회원이 되신 것을 환영합니다.</p>' +
        '<p style="font-size:14px;color:#3a463f;margin:0 0 4px">감사합니다.</p>' +
      '</div>' +
      '<div style="background:#f4f5f1;border-top:1px solid #e4e2da;padding:16px 26px;color:#6b766f;font-size:12px;line-height:1.6">' +
        '<b style="color:#16211c">사단법인 도시공동체본부</b> 사무처<br>' +
        '대표전화 1670-9678 · <a href="https://ucc.or.kr" style="color:#123a2e;text-decoration:none">ucc.or.kr</a><br>' +
        '<span style="color:#9aa39c">본 메일은 회원가입 및 회비 납부 확인에 따라 발송되었습니다.</span>' +
      '</div>' +
    '</div></div>';

  return { subject, text, html };
}

// 비밀번호 초기화 메일 — { subject, text, html } 반환
function resetPasswordMail(m, tempPw) {
  const name = m.name || "회원";
  const subject = "[사단법인 도시공동체본부] 임시 비밀번호 안내";
  const text =
    `${name}님, 요청하신 임시 비밀번호를 안내드립니다.\n\n` +
    `임시 비밀번호: ${tempPw}\n\n` +
    `로그인 후 보안을 위해 반드시 새 비밀번호로 변경해 주세요.\n` +
    `본인이 요청하지 않았다면 이 메일을 무시하고 비밀번호를 변경해 주세요.\n\n` +
    `로그인: https://ucc.or.kr/login\n\n` +
    `사단법인 도시공동체본부 사무처\n대표전화 1670-9678 · https://ucc.or.kr`;

  const html =
    '<div style="font-family:\'Malgun Gothic\',AppleSDGothicNeo,sans-serif;background:#eef1ec;padding:28px 14px">' +
    '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e2da;border-radius:14px;overflow:hidden">' +
      '<div style="background:#123a2e;color:#fff;padding:22px 26px">' +
        '<div style="font-size:13px;letter-spacing:1px;color:#d8b25f;font-weight:700;margin-bottom:4px">URBAN COMMUNITY CENTER</div>' +
        '<div style="font-size:19px;font-weight:800">임시 비밀번호 안내</div>' +
      '</div>' +
      '<div style="padding:26px">' +
        `<p style="font-size:15px;color:#16211c;margin:0 0 6px"><b>${esc(name)}</b>님, 요청하신 임시 비밀번호입니다.</p>` +
        '<p style="font-size:14px;color:#3a463f;line-height:1.7;margin:0 0 16px">아래 임시 비밀번호로 로그인하신 뒤, 보안을 위해 <b style="color:#123a2e">반드시 새 비밀번호로 변경</b>해 주세요.</p>' +
        `<div style="font-size:22px;font-weight:800;letter-spacing:2px;color:#123a2e;background:#f8f6f0;border:1px solid #eee7d6;border-radius:10px;text-align:center;padding:16px;margin:0 0 18px">${esc(tempPw)}</div>` +
        '<p style="margin:0 0 18px"><a href="https://ucc.or.kr/login" style="display:inline-block;background:#123a2e;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:8px">로그인하기</a></p>' +
        '<p style="font-size:13px;color:#6b766f;margin:0;line-height:1.6">본인이 요청하지 않았다면 이 메일을 무시하시고, 계정 보호를 위해 비밀번호를 변경해 주세요.</p>' +
      '</div>' +
      '<div style="background:#f4f5f1;border-top:1px solid #e4e2da;padding:16px 26px;color:#6b766f;font-size:12px;line-height:1.6">' +
        '<b style="color:#16211c">사단법인 도시공동체본부</b> 사무처<br>' +
        '대표전화 1670-9678 · <a href="https://ucc.or.kr" style="color:#123a2e;text-decoration:none">ucc.or.kr</a>' +
      '</div>' +
    '</div></div>';

  return { subject, text, html };
}

module.exports = { welcomeMemberMail, resetPasswordMail, MEMBER_FEE, dateKo };
