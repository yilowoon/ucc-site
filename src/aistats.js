/* aistats.js — AI활용전문가과정 '수료생 현황' 통계 + 소속기관 로고
 * 통계는 app_settings(JSON)에, 소속기관은 ai_orgs 테이블에 저장. 관리자에서 편집.
 */
"use strict";
const { db, getSetting, setSetting } = require("./db");

const KEY = "ai_course_stats";
const DEFAULT = {
  total: 600,
  jobs: [
    { label: "기획·전략", pct: 22 },
    { label: "행정·공공", pct: 20 },
    { label: "마케팅·홍보", pct: 18 },
    { label: "연구·R&D", pct: 14 },
    { label: "교육·강사", pct: 12 },
    { label: "기타", pct: 14 },
  ],
  companies: [
    { label: "공공기관·지자체", pct: 28 },
    { label: "중소기업", pct: 24 },
    { label: "대학·연구기관", pct: 22 },
    { label: "사회적경제·비영리", pct: 14 },
    { label: "스타트업·1인기업", pct: 12 },
  ],
};

function getStats() {
  try {
    const raw = getSetting(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        total: Number(o.total) || DEFAULT.total,
        jobs: Array.isArray(o.jobs) && o.jobs.length ? o.jobs : DEFAULT.jobs,
        companies: Array.isArray(o.companies) && o.companies.length ? o.companies : DEFAULT.companies,
      };
    }
  } catch (e) {}
  return DEFAULT;
}
function setStats(o) {
  const clean = {
    total: Math.max(0, parseInt(o.total, 10) || 0),
    jobs: (o.jobs || []).filter((r) => r && r.label).map((r) => ({ label: String(r.label).slice(0, 40), pct: Math.max(0, Math.min(100, Number(r.pct) || 0)) })),
    companies: (o.companies || []).filter((r) => r && r.label).map((r) => ({ label: String(r.label).slice(0, 40), pct: Math.max(0, Math.min(100, Number(r.pct) || 0)) })),
  };
  setSetting(KEY, JSON.stringify(clean));
  return clean;
}

function listOrgs() { try { return db.prepare("SELECT * FROM ai_orgs ORDER BY sort_order, id").all(); } catch (e) { return []; } }
function getOrg(id) { return db.prepare("SELECT * FROM ai_orgs WHERE id = ?").get(id); }
function addOrg(name, logo) {
  db.prepare("INSERT INTO ai_orgs (name, logo, sort_order, created_at) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order)+1,0) FROM ai_orgs), ?)")
    .run(String(name).slice(0, 80), logo || "", new Date().toISOString());
}
function updateOrg(id, name, logo) {
  if (logo === undefined) db.prepare("UPDATE ai_orgs SET name = ? WHERE id = ?").run(String(name).slice(0, 80), id);
  else db.prepare("UPDATE ai_orgs SET name = ?, logo = ? WHERE id = ?").run(String(name).slice(0, 80), logo, id);
}
function removeOrg(id) { db.prepare("DELETE FROM ai_orgs WHERE id = ?").run(id); }

module.exports = { getStats, setStats, listOrgs, getOrg, addOrg, updateOrg, removeOrg, DEFAULT };
