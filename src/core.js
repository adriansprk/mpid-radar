import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_DATASET_URL = new URL("../data/latest.json", import.meta.url);
const MAX_LIMIT = 100;

const ROLE_ALIASES = new Map(Object.entries({
  biko: "Bilanzkoordinator",
  bilanzkoordinator: "Bilanzkoordinator",
  bkv: "Bilanzkreisverantwortlicher",
  bilanzkreis: "Bilanzkreisverantwortlicher",
  bilanzkreisverantwortlicher: "Bilanzkreisverantwortlicher",
  btr: "Betreiber einer technischen Ressource",
  tr: "Betreiber einer technischen Ressource",
  technische: "Betreiber einer technischen Ressource",
  data: "Data Provider",
  dataprovider: "Data Provider",
  dp: "Data Provider",
  eiv: "Einsatzverantwortlicher",
  einsatz: "Einsatzverantwortlicher",
  einsatzverantwortlicher: "Einsatzverantwortlicher",
  esa: "Energieserviceanbieter des Anschlussnutzers",
  energieserviceanbieter: "Energieserviceanbieter des Anschlussnutzers",
  lf: "Lieferant",
  lieferant: "Lieferant",
  supplier: "Lieferant",
  msb: "Messstellenbetreiber",
  messstellenbetreiber: "Messstellenbetreiber",
  nb: "Netzbetreiber",
  netz: "Netzbetreiber",
  netzbetreiber: "Netzbetreiber",
  vnb: "Netzbetreiber",
  nn: "Netznutzer ohne All-Inklusiv-Vertrag",
  netznutzer: "Netznutzer ohne All-Inklusiv-Vertrag",
  reg: "Registerbetreiber",
  register: "Registerbetreiber",
  registerbetreiber: "Registerbetreiber",
  ueb: "Übertragungsnetzbetreiber",
  uenb: "Übertragungsnetzbetreiber",
  unb: "Übertragungsnetzbetreiber",
  uebertragungsnetzbetreiber: "Übertragungsnetzbetreiber",
  übertragungsnetzbetreiber: "Übertragungsnetzbetreiber"
}));

const ROLE_GLOSSES = new Map([
  ["Lieferant", "Supplier"],
  ["Einsatzverantwortlicher", "Dispatch responsible"],
  ["Bilanzkreisverantwortlicher", "Balancing group manager"],
  ["Betreiber einer technischen Ressource", "Technical resource operator"],
  ["Messstellenbetreiber", "Metering point operator"],
  ["Netzbetreiber", "Grid operator"],
  ["Energieserviceanbieter des Anschlussnutzers", "Connection-user energy service provider"],
  ["Netznutzer ohne All-Inklusiv-Vertrag", "Grid user without all-inclusive contract"],
  ["Data Provider", "Data provider"],
  ["Bilanzkoordinator", "Balancing coordinator"],
  ["Übertragungsnetzbetreiber", "Transmission system operator"],
  ["Registerbetreiber", "Register operator"]
]);

const LEGAL_FORM_TOKENS = new Set(["ag", "co", "eg", "ev", "e", "gbr", "gmbh", "kg", "mbh", "v"]);

function clampLimit(value, fallback = 10) {
  const limit = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(1, Math.min(MAX_LIMIT, limit));
}

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLocaleLowerCase("de-DE")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value, dropLegalForms = false) {
  let parts = normalizeText(value).split(/\s+/).filter((token) => token.length >= 2);
  if (dropLegalForms) parts = parts.filter((token) => !LEGAL_FORM_TOKENS.has(token));
  return parts;
}

function normalizeQuery(value) {
  const trimmed = String(value || "").trim();
  const parts = trimmed.split(/\s+/);
  if (["bdew", "mpid"].includes(parts[0].toLocaleLowerCase("de-DE"))) {
    return parts.slice(1).join(" ").trim();
  }
  return trimmed;
}

function editDistanceAtMost(left, right, limit) {
  if (Math.abs(left.length - right.length) > limit) return null;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) return null;
    previous = current;
  }
  const distance = previous[previous.length - 1];
  return distance <= limit ? distance : null;
}

// A short query token (< 5 chars) may only match a target token by equality or
// prefix — never as a mid-word substring. Without this, "swe" matches inside
// "elektrizitätswerk" and floods results with unrelated companies. Longer tokens
// keep substring matching (e.g. "bayern" in "bayernwerk").
const MIN_SUBSTRING_TOKEN = 5;

function tokenInName(token, nameTokens) {
  return nameTokens.some((nt) =>
    nt === token || nt.startsWith(token) || (token.length >= MIN_SUBSTRING_TOKEN && nt.includes(token)));
}

function tokenMatchScore(queryTokens, targetTokens) {
  if (!queryTokens.length || !targetTokens.length) return null;
  let total = 0;
  for (const queryToken of queryTokens) {
    let best = null;
    for (const targetToken of targetTokens) {
      let score = null;
      if (targetToken === queryToken) score = 0;
      else if (targetToken.startsWith(queryToken)) score = 1;
      else if (queryToken.length >= MIN_SUBSTRING_TOKEN && targetToken.includes(queryToken)) score = 2;
      else {
        const limit = queryToken.length < 11 ? 1 : 2;
        const distance = editDistanceAtMost(queryToken, targetToken, limit);
        if (distance !== null) score = 4 + distance;
      }
      if (score !== null && (best === null || score < best)) best = score;
    }
    if (best === null) return null;
    total += best;
  }
  return total;
}

const ROLE_CODES = new Map([
  ["Lieferant", "LF"],
  ["Netzbetreiber", "NB"],
  ["Messstellenbetreiber", "MSB"],
  ["Bilanzkreisverantwortlicher", "BKV"],
  ["Bilanzkoordinator", "BIKO"],
  ["Einsatzverantwortlicher", "EIV"],
  ["Betreiber einer technischen Ressource", "BTR"],
  ["Data Provider", "DP"],
  ["Registerbetreiber", "REG"],
  ["Übertragungsnetzbetreiber", "ÜNB"],
  ["Netznutzer ohne All-Inklusiv-Vertrag", "NN"],
  ["Energieserviceanbieter des Anschlussnutzers", "ESA"]
]);

function roleCodeFor(role) {
  return ROLE_CODES.get(role) || null;
}

function compactRecord(record, score = null) {
  const result = {
    bdew_code: record.bdew_code,
    role_code: record.role_code || roleCodeFor(record.market_function),
    market_function: record.market_function,
    company_name: record.company_name,
    // company_id is an opaque internal key (no external meaning); kept only so a
    // caller can tell apart two distinct registrations that share a name, e.g.
    // the two "SWE Netz GmbH" entities. company_uid/code_row_id are dropped as
    // noise — they carry no information an agent can use.
    company_id: record.company_id
  };
  if (score !== null) {
    result.match_score = score;
    result.confidence = confidenceFromScore(score);
  }
  return result;
}

function confidenceFromScore(score) {
  if (score <= -10) return "exact";
  if (score <= 2) return "high";
  if (score <= 10) return "medium";
  return "low";
}

function parseQuery(value, roleHint, roleCodeHint) {
  const query = normalizeQuery(value);
  const paramRole = normalizeRole(roleHint || roleCodeHint);
  if (paramRole) {
    // Role given explicitly: keep the company text intact. A company name may
    // legitimately contain a role word (e.g. "SWE Netz GmbH"), so we must not
    // strip it.
    return { raw: query, text: query, role: paramRole };
  }
  // No explicit role: infer one only from a LEADING role token (e.g. "lf enpal",
  // "nb tennet"). A role word elsewhere is treated as part of the company name,
  // so "swe netz gmbh" keeps "netz" and isn't mistaken for a Netzbetreiber query.
  const queryTokens = tokenize(query);
  const leadRole = queryTokens.length ? ROLE_ALIASES.get(queryTokens[0]) : null;
  if (leadRole) {
    return { raw: query, text: queryTokens.slice(1).join(" "), role: leadRole };
  }
  return { raw: query, text: query, role: null };
}

// In "prefer" mode the role is a ranking signal, not a gate: a matching role
// improves the score, a mismatch is demoted but never eliminated, so we never
// hide the right company — or confidently return the wrong one — because of an
// imperfect role guess.
const ROLE_MATCH_BONUS = -3;
const ROLE_MISMATCH_PENALTY = 10;

function baseScore(record, qNorm, qTokens) {
  const name = normalizeText(record.company_name);
  const code = normalizeText(record.bdew_code);
  const role = normalizeText(record.market_function);
  const roleCode = normalizeText(record.role_code || roleCodeFor(record.market_function));

  if (/^\d+$/.test(qNorm) && qNorm.length >= 4) {
    if (code === qNorm) return -20;
    if (code.startsWith(qNorm)) return -15;
    if (code.includes(qNorm)) return -5;
  }
  if (name === qNorm) return -10;
  if (name.startsWith(qNorm)) return -8;
  if (name.includes(qNorm)) return 0;
  const nameTokens = tokenize(record.company_name);
  if (qTokens.length && qTokens.every((token) => tokenInName(token, nameTokens))) return 2;

  const companyTokenScore = tokenMatchScore(qTokens, tokenize(record.company_name, true));
  if (companyTokenScore !== null) return 8 + companyTokenScore;

  if (role.includes(qNorm) || roleCode === qNorm) return 4;
  if (qTokens.length && qTokens.every((token) => role.includes(token))) return 5;
  if (qNorm.length >= 4 && code.includes(qNorm)) return 7;

  const roleTokenScore = tokenMatchScore(qTokens, tokenize(record.market_function));
  if (roleTokenScore !== null) return 18 + roleTokenScore;

  return null;
}

function scoreRecord(record, parsed, rolePrefer = false) {
  // Role-only query (e.g. "list all Lieferanten"): match members of that role.
  if (!parsed.text) return parsed.role && record.market_function === parsed.role ? 0 : null;

  // Plain search treats a role as a hard filter; resolve() prefers instead.
  if (parsed.role && !rolePrefer && record.market_function !== parsed.role) return null;

  const qNorm = normalizeText(parsed.text);
  if (!qNorm) return null;

  const base = baseScore(record, qNorm, tokenize(parsed.text));
  if (base === null) return null;

  if (parsed.role && rolePrefer) {
    return base + (record.market_function === parsed.role ? ROLE_MATCH_BONUS : ROLE_MISMATCH_PENALTY);
  }
  return base;
}

function sortRanked(a, b) {
  return a.score - b.score
    || String(a.record.company_name).localeCompare(String(b.record.company_name), "de-DE")
    || String(a.record.bdew_code).localeCompare(String(b.record.bdew_code), "de-DE");
}

export function normalizeRole(value) {
  if (!value) return null;
  const normalized = normalizeText(value);
  return ROLE_ALIASES.get(normalized) || null;
}

export function loadDataset(pathOrUrl = DEFAULT_DATASET_URL) {
  const sourcePath = pathOrUrl instanceof URL ? fileURLToPath(pathOrUrl) : pathOrUrl;
  const data = JSON.parse(readFileSync(sourcePath, "utf8"));
  return new MpidRadar(data, sourcePath);
}

export class MpidRadar {
  constructor(data, sourcePath = fileURLToPath(DEFAULT_DATASET_URL)) {
    this.meta = data.meta || {};
    this.codes = Array.isArray(data.codes) ? data.codes : [];
    this.companies = Array.isArray(data.companies) ? data.companies : [];
    this.errors = Array.isArray(data.errors) ? data.errors : [];
    this.sourcePath = sourcePath;
    this.byCode = new Map(this.codes.map((record) => [String(record.bdew_code), record]));
    this.byCompanyId = new Map();
    for (const record of this.codes) {
      // Guard null/""/undefined explicitly: Number(null) and Number("") are 0
      // (finite), which would silently bucket id-less records under company 0.
      if (record.company_id === null || record.company_id === undefined || record.company_id === "") continue;
      const id = Number(record.company_id);
      if (Number.isFinite(id)) {
        if (!this.byCompanyId.has(id)) this.byCompanyId.set(id, []);
        this.byCompanyId.get(id).push(record);
      }
    }
    this.roles = this.buildRoles();
  }

  buildRoles() {
    const byRole = new Map();
    for (const record of this.codes) {
      const role = record.market_function || "";
      if (!role) continue;
      const current = byRole.get(role) || {
        role_code: record.role_code || roleCodeFor(role),
        market_function: role,
        english_gloss: ROLE_GLOSSES.get(role) || null,
        count: 0
      };
      current.count += 1;
      byRole.set(role, current);
    }
    return [...byRole.values()].sort((a, b) => b.count - a.count || a.market_function.localeCompare(b.market_function, "de-DE"));
  }

  metadata() {
    return {
      dataset: this.meta.dataset || {},
      source: this.meta.source || {},
      records: this.meta.records || {
        companies: this.companies.length,
        market_partners: this.codes.length,
        errors: this.errors.length
      },
      source_path: this.sourcePath
    };
  }

  listRoles() {
    return this.roles;
  }

  lookupMarketPartner(bdewCode) {
    const normalized = String(bdewCode || "").replace(/\D/g, "");
    const record = this.byCode.get(normalized);
    return record ? compactRecord(record) : null;
  }

  searchMarketPartners({ query = "", role_code = null, market_function = null, limit = 10, role_mode = "filter" } = {}) {
    const parsed = parseQuery(query, market_function, role_code);
    if (!parsed.text && !parsed.role) return [];

    const rolePrefer = role_mode === "prefer";
    let ranked = [];
    for (const record of this.codes) {
      const score = scoreRecord(record, parsed, rolePrefer);
      if (score !== null) ranked.push({ score, record });
    }

    if (ranked.some((entry) => entry.score < 8)) {
      ranked = ranked.filter((entry) => entry.score < 8);
    }

    return ranked
      .sort(sortRanked)
      .slice(0, clampLimit(limit))
      .map((entry) => compactRecord(entry.record, entry.score));
  }

  resolveMarketPartner({ company_name, role = null, role_code = null, limit = 5 } = {}) {
    const roleHint = role || role_code || null;
    // Pass the role only via the params, not glued onto the query text — that
    // kept role words out of the company match and is what let a name like
    // "SWE Netz GmbH" get mis-parsed.
    const matches = this.searchMarketPartners({
      query: company_name || "",
      role_code,
      market_function: role,
      limit,
      role_mode: "prefer"
    });

    const status = matches.length === 0 ? "not_found" : this.isAmbiguous(matches) ? "ambiguous" : "resolved";
    const result = {
      status,
      matches,
      dataset_version: this.meta.dataset?.version || null,
      source: this.meta.source?.name || null,
      published_at: this.meta.dataset?.published_at || null
    };

    // No role was given but a single company resolved: list all of its codes by
    // role so the caller can pick the right one instead of guessing from matches.
    if (!roleHint && status === "resolved" && matches[0]) {
      const top = matches[0];
      const partners = this.byCompanyId.get(top.company_id) || [];
      if (partners.length > 1) {
        result.company = { company_id: top.company_id, company_name: top.company_name };
        result.roles = partners
          .map((record) => ({
            role_code: record.role_code || roleCodeFor(record.market_function),
            market_function: record.market_function,
            bdew_code: record.bdew_code
          }))
          .sort((a, b) => String(a.market_function).localeCompare(String(b.market_function), "de-DE"));
      }
    }

    return result;
  }

  isAmbiguous(matches) {
    if (matches.length <= 1) return false;
    const first = matches[0];
    if (first.confidence !== "exact" && first.confidence !== "high") return true;
    // Among the best-scoring matches, is more than one distinct company in play?
    // This catches both different companies and two distinct registrations that
    // share a name (the two "SWE Netz GmbH" entities, same name, different id).
    const topCompanies = new Set(
      matches.filter((m) => m.match_score === first.match_score).map((m) => m.company_id)
    );
    return topCompanies.size > 1;
  }
}

