import assert from "node:assert/strict";
import test from "node:test";
import { loadDataset } from "../src/core.js";

const radar = loadDataset();

// Real name(+role) -> expected top match. Guards the resolve relevance that the
// SWE Netz bug exposed: role words embedded in a company name must not be
// stripped, and short tokens must not substring-match inside longer words.
const CASES = [
  { q: { company_name: "Uniper", role: "lf" }, company: /uniper/i, role_code: "LF" },
  { q: { company_name: "Enpal", role: "Lieferant" }, company: "Enpal Energy GmbH", role_code: "LF" },
  // A role the company lacks must still surface the right company (not 404).
  { q: { company_name: "Enpal", role: "Netzbetreiber" }, company: "Enpal Energy GmbH" },
  { q: { company_name: "TenneT TSO GmbH" }, company: "TenneT TSO GmbH" },
  { q: { company_name: "EnBW", role: "lf" }, company: /enbw/i, role_code: "LF" },
];

for (const { q, company, role_code } of CASES) {
  test(`resolve top match: ${JSON.stringify(q)}`, () => {
    const result = radar.resolveMarketPartner(q);
    const top = result.matches[0];
    assert.ok(top, "expected at least one match");
    if (company instanceof RegExp) assert.match(top.company_name, company);
    else assert.equal(top.company_name, company);
    if (role_code) assert.equal(top.role_code, role_code);
  });
}

test("SWE Netz GmbH resolves to itself, not 'Elektrizitätswerk' lookalikes", () => {
  // Regression: "netz" was parsed as a role and "swe" matched inside
  // "elektrizitätswerk", burying the real company below the result limit.
  const result = radar.resolveMarketPartner({ company_name: "SWE Netz GmbH" });
  assert.equal(result.matches[0].company_name, "SWE Netz GmbH");
  // Two distinct registrations share the name -> surfaced as ambiguous.
  assert.equal(result.status, "ambiguous");
  const ids = new Set(result.matches.map((m) => m.company_id));
  assert.ok(ids.size > 1, "both SWE Netz entities should appear");
});

test("a leading role token is still parsed (lf enpal)", () => {
  const result = radar.resolveMarketPartner({ company_name: "lf enpal" });
  assert.equal(result.matches[0].company_name, "Enpal Energy GmbH");
  assert.equal(result.matches[0].role_code, "LF");
});
