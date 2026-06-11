import assert from "node:assert/strict";
import test from "node:test";
import { loadDataset, normalizeRole, normalizeText } from "../src/core.js";

const radar = loadDataset();

test("normalizes German market partner text", () => {
  assert.equal(normalizeText("Übertragungsnetzbetreiber GmbH"), "ubertragungsnetzbetreiber gmbh");
});

test("normalizes role aliases", () => {
  assert.equal(normalizeRole("lf"), "Lieferant");
  assert.equal(normalizeRole("BKV"), "Bilanzkreisverantwortlicher");
  assert.equal(normalizeRole("uenb"), "Übertragungsnetzbetreiber");
});

test("looks up an exact BDEW code", () => {
  const record = radar.lookupMarketPartner("4033872000010");
  assert.equal(record.bdew_code, "4033872000010");
  assert.equal(record.role_code, "NB");
  assert.equal(record.company_name, "TenneT TSO GmbH");
});

test("searches by role alias and company", () => {
  const matches = radar.searchMarketPartners({ query: "nb tennet", limit: 5 });
  assert.ok(matches.length > 0);
  assert.ok(matches.some((record) => record.company_name === "TenneT TSO GmbH"));
  assert.ok(matches.every((record) => record.role_code === "NB"));
});

test("resolves market partners with ambiguity metadata", () => {
  const result = radar.resolveMarketPartner({ company_name: "Uniper", role_code: "LF", limit: 5 });
  assert.ok(["resolved", "ambiguous"].includes(result.status));
  assert.ok(result.matches.length > 0);
  assert.equal(result.matches[0].role_code, "LF");
  // Assert self-consistency, not a literal date, so a dataset refresh can't break it.
  assert.equal(result.dataset_version, radar.meta.dataset.version);
});

test("lists all known roles", () => {
  const roles = radar.listRoles();
  assert.ok(roles.some((role) => role.role_code === "LF" && role.market_function === "Lieferant"));
});

test("resolve prefers a matching role but does not gate on it", () => {
  // Enpal Energy GmbH is registered as BKV and LF, but not Netzbetreiber.
  const lieferant = radar.resolveMarketPartner({ company_name: "Enpal", role: "Lieferant" });
  assert.equal(lieferant.matches[0].company_name, "Enpal Energy GmbH");
  assert.equal(lieferant.matches[0].role_code, "LF");

  // Asking for a role the company lacks must still surface the company, not 404.
  const grid = radar.resolveMarketPartner({ company_name: "Enpal", role: "Netzbetreiber" });
  assert.notEqual(grid.status, "not_found");
  assert.equal(grid.matches[0].company_name, "Enpal Energy GmbH");
});

test("resolve without a role groups the company's codes by role", () => {
  const result = radar.resolveMarketPartner({ company_name: "TenneT TSO GmbH" });
  assert.equal(result.status, "resolved");
  assert.equal(result.company.company_name, "TenneT TSO GmbH");
  assert.ok(result.roles.length >= 4);
  const codes = result.roles.map((entry) => entry.role_code);
  assert.ok(codes.includes("LF") && codes.includes("NB"));
});
