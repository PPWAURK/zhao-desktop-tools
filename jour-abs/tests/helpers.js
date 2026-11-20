// Test helpers: load the vendored browser build of ExcelJS and build workbooks
// laid out like the "Fiche employés" sheet of the monthly export.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadExcelJS() {
  const ctx = { console, setTimeout, clearTimeout, setImmediate, TextDecoder, TextEncoder, Promise, Uint8Array, ArrayBuffer };
  ctx.global = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, "../src/vendor/exceljs.min.js"), "utf8");
  vm.runInContext(src, ctx);
  return ctx.ExcelJS;
}

const ExcelJS = loadExcelJS();
const JourAbs = require("../src/jour-abs-core.js");

const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;

/**
 * spec = { first: "2026-10-01", last: "2026-10-31", employees: [
 *   { name, prime, weeks: [{ no, contract, volume, days: [["Samedi 3 octobre", 5, "11h00", "16h30"], ...] }] } ] }
 */
function makeWorkbook(spec) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Fiche employés");
  const first = new Date(spec.first + "T00:00:00Z");
  const last = new Date(spec.last + "T00:00:00Z");
  let r = 1;
  for (const emp of spec.employees) {
    r += 1;
    ws.getCell(r, 1).value = emp.name;
    ws.getCell(r + 1, 1).value = "Détail Planning";
    ws.getCell(r + 2, 12).value = "Heures Travaillées de la période (h) (i)";
    ws.getCell(r + 2, 27).value = "Primes (€)";
    r += 3;
    ws.getCell(r, 1).value = `Total Période (${fmt(first)}-${fmt(last)})`;
    ws.getCell(r, 13).value = emp.systemDays ?? 0;
    if (emp.prime !== undefined) ws.getCell(r, 27).value = emp.prime;
    for (const w of emp.weeks || []) {
      r += 1;
      ws.getCell(r, 1).value = `Semaine ${w.no}`;
      ws.getCell(r, 3).value = "-";
      ws.getCell(r, 4).value = w.contract || "CDI";
      ws.getCell(r, 5).value = w.volume ?? 39;
      for (const [label, hours, start, end] of w.days || []) {
        r += 1;
        ws.getCell(r, 1).value = label;
        ws.getCell(r, 12).value = hours;
        if (start) ws.getCell(r, 7).value = start;
        if (end) ws.getCell(r, 8).value = end;
      }
    }
    r += 1;
  }
  return wb;
}

module.exports = { ExcelJS, JourAbs, makeWorkbook };
