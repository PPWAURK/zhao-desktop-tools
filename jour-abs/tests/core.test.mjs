import test from "node:test";
import assert from "node:assert/strict";
import { JourAbs, makeWorkbook } from "./helpers.mjs";

const OCT = { first: "2026-10-01", last: "2026-10-31" };
const SEP = { first: "2026-09-01", last: "2026-09-30" };

function octWorkbook(employees) {
  return makeWorkbook({ ...OCT, employees });
}

test("flags days where the shifts of one day add up to 9 hours or more", () => {
  // Arrange: two shifts on the same day (5 + 4.5 = 9.5 h), and a day of exactly 9 h (flagged)
  const wb = octWorkbook([
    { name: "Paul MARTIN", prime: 0, weeks: [{ no: 42, days: [
      ["Lundi 12 octobre", 5], ["Lundi 12 octobre", 4.5],
      ["Mardi 13 octobre", 9],
      ["Mercredi 14 octobre", 4], ["Mercredi 14 octobre", 6.25],
    ] }] },
  ]);

  // Act
  const res = JourAbs.processWorkbook(wb);

  // Assert
  assert.deepEqual(
    res.longDays.map((d) => [d.name, new Date(d.date).toISOString().slice(0, 10), d.hours]),
    [["Paul MARTIN", "2026-10-12", 9.5], ["Paul MARTIN", "2026-10-13", 9], ["Paul MARTIN", "2026-10-14", 10.25]],
  );
});

test("a day summing to exactly 9 h from rounded shifts is flagged", () => {
  // 3.83 + 5.17 is 9 within rounding (floating point gives 8.999999…)
  const wb = octWorkbook([
    { name: "Ines ROBERT", prime: 0, weeks: [{ no: 42, days: [["Jeudi 15 octobre", 3.83], ["Jeudi 15 octobre", 5.17]] }] },
  ]);

  assert.deepEqual(JourAbs.processWorkbook(wb).longDays.map((d) => d.hours), [9]);
});

test("ignores long days that belong to the neighbouring month", () => {
  // Week 44 runs from 26 Oct to 1 Nov: 1 November is outside the October period
  const wb = octWorkbook([
    { name: "Sam LAURENT", prime: 0, weeks: [{ no: 44, days: [
      ["Samedi 31 octobre", 10], ["Dimanche 1 novembre", 11],
    ] }] },
  ]);

  const res = JourAbs.processWorkbook(wb);

  assert.equal(res.longDays.length, 1);
  assert.equal(new Date(res.longDays[0].date).toISOString().slice(0, 10), "2026-10-31");
});

test("a double-booked slot is counted once, keeping the shorter shift", () => {
  // Same evening slot planned twice: only EC + Mo (4.75 h) counts -> 4 + 4.75 = 8.75 h, not 14 h
  const wb = octWorkbook([
    { name: "Alex MOREAU", prime: 0, weeks: [{ no: 44, days: [
      ["Lundi 26 octobre", 4, "10h30", "15h00", "EC + Mo"],
      ["Lundi 26 octobre", 5.25, "18h00", "23h15", "EF+Riz"],
      ["Lundi 26 octobre", 4.75, "18h00", "23h15", "EC + Mo"],
    ] }] },
  ]);

  const res = JourAbs.processWorkbook(wb);

  assert.deepEqual(res.longDays, []);
  assert.deepEqual(res.duplicateShifts.map((d) => [d.name, d.poste, d.start, d.end, d.hours, d.dayHours, d.exportHours]),
    [["Alex MOREAU", "EF+Riz", "18h00", "23h15", 5.25, 8.75, 14]]);
});

test("a day still at 9 h or more after removing a duplicate stays flagged", () => {
  const wb = octWorkbook([
    { name: "Lea BERNARD", prime: 0, weeks: [{ no: 42, days: [
      ["Lundi 12 octobre", 5.5, "10h00", "16h00", "Salle"],
      ["Lundi 12 octobre", 4.5, "18h00", "23h00", "Salle"],
      ["Lundi 12 octobre", 4, "18h30", "23h00", "Bar"],
    ] }] },
  ]);

  const [day] = JourAbs.processWorkbook(wb).longDays;

  assert.deepEqual([day.hours, day.exportHours, day.overlap], [9.5, 14, true]);
});

test("a small partial overlap keeps both shifts and is only marked", () => {
  // 10h-15h and 14h30-20h overlap 30 min (< half of the shorter shift): both count
  const wb = octWorkbook([
    { name: "Sam LAURENT", prime: 0, weeks: [{ no: 42, days: [
      ["Mardi 13 octobre", 5, "10h00", "15h00"], ["Mardi 13 octobre", 5.5, "14h30", "20h00"],
    ] }] },
  ]);

  const res = JourAbs.processWorkbook(wb);

  assert.deepEqual(res.longDays.map((d) => [d.hours, d.exportHours, d.overlap]), [[10.5, 10.5, true]]);
  assert.deepEqual(res.duplicateShifts, []);
});

test("duplicates are listed even when the day stays under 9 hours", () => {
  const wb = octWorkbook([
    { name: "Nina DURAND", prime: 0, weeks: [{ no: 42, days: [
      ["Dimanche 18 octobre", 3.5, "19h30", "23h00", "Présence"], ["Dimanche 18 octobre", 3, "19h30", "23h00", "Serveur A"],
    ] }] },
  ]);

  const res = JourAbs.processWorkbook(wb);

  assert.deepEqual(res.longDays, []);
  assert.deepEqual(res.duplicateShifts.map((d) => [d.poste, d.hours, d.dayHours]), [["Présence", 3.5, 3]]);
});

test("a shift ending exactly when the next starts is not an overlap", () => {
  const wb = octWorkbook([
    { name: "A B", prime: 0, weeks: [{ no: 42, days: [
      ["Lundi 12 octobre", 5, "10h00", "15h00"], ["Lundi 12 octobre", 5, "15h00", "20h00"],
    ] }] },
  ]);

  assert.equal(JourAbs.processWorkbook(wb).longDays[0].overlap, false);
});

test("returns no long days when everybody works less than 9 hours", () => {
  const wb = octWorkbook([
    { name: "Ines ROBERT", prime: 100, weeks: [{ no: 41, days: [["Samedi 10 octobre", 8.75]] }] },
  ]);

  assert.deepEqual(JourAbs.processWorkbook(wb).longDays, []);
});

test("reads the prime of each employee from the Total row", () => {
  const wb = octWorkbook([
    { name: "Paul MARTIN", prime: 350, weeks: [] },
    { name: "Eva GARNIER", prime: undefined, weeks: [] },
  ]);

  const summary = JourAbs.readSummary(wb);

  assert.deepEqual(summary.primes, [
    { name: "Paul MARTIN", prime: 350 },
    { name: "Eva GARNIER", prime: 0 },
  ]);
  assert.equal(new Date(summary.period.first).toISOString().slice(0, 10), "2026-10-01");
});

test("reads primes written as text and reports unreadable ones as null", () => {
  const wb = octWorkbook([
    { name: "Paul MARTIN", prime: "1 250,50 €", weeks: [] },
    { name: "Lea BERNARD", prime: "300", weeks: [] },
    { name: "Hugo PETIT", prime: { formula: "AA1+AA2" }, weeks: [] }, // formula without cached result
    { name: "Ines ROBERT", prime: "Aucune prime", weeks: [] },
  ]);

  const primes = JourAbs.readSummary(wb).primes;

  assert.deepEqual(primes.map((p) => p.prime), [1250.5, 300, null, null]);
});

test("unreadable primes are never flagged and are listed separately", () => {
  const current = [{ name: "Paul MARTIN", prime: null }, { name: "Lea BERNARD", prime: 400 }];
  const previous = [{ name: "Lea BERNARD", prime: null }];

  assert.deepEqual(JourAbs.primeIncreases(current, previous), []);
  assert.deepEqual(JourAbs.unreadablePrimes(current, previous), ["Paul MARTIN", "Lea BERNARD (mois précédent)"]);
});

test("falls back to column AA when the prime header is missing", () => {
  const wb = octWorkbook([{ name: "Paul MARTIN", prime: 320, weeks: [] }]);
  wb.getWorksheet("Fiche employés").getCell(4, 27).value = null; // remove header

  assert.equal(JourAbs.readSummary(wb).primes[0].prime, 320);
});

test("recognises December -> January as consecutive months", () => {
  const dec = JourAbs.readSummary(makeWorkbook({ first: "2026-12-01", last: "2026-12-31", employees: [{ name: "A B", prime: 0 }] })).period;
  const jan = JourAbs.readSummary(makeWorkbook({ first: "2027-01-01", last: "2027-01-31", employees: [{ name: "A B", prime: 0 }] })).period;

  assert.equal(JourAbs.isPreviousMonth(dec, jan), true);
});

test("readSummary does not modify the workbook", () => {
  const wb = octWorkbook([{ name: "Ines ROBERT", prime: 100, weeks: [{ no: 41, days: [["Samedi 10 octobre", 6]] }] }]);

  JourAbs.readSummary(wb);

  assert.equal(wb.getWorksheet("Fiche employés").getCell(6, 32).value, null);
});

test("lists primes above 250 € that increased since last month", () => {
  const current = [
    { name: "Paul MARTIN", prime: 350 }, // 250 -> 350: flagged
    { name: "Lea BERNARD", prime: 600 }, // unchanged: not flagged
    { name: "Hugo PETIT", prime: 150 }, // decreased: not flagged
    { name: "Ines ROBERT", prime: 200 }, // increased but not above 250
    { name: "Tom RICHARD", prime: 250 }, // exactly 250 is not "above"
    { name: "Nina DURAND", prime: 300 }, // absent last month: flagged as new
  ];
  const previous = [
    { name: "Paul MARTIN", prime: 250 },
    { name: "Lea BERNARD", prime: 600 },
    { name: "Hugo PETIT", prime: 250 },
    { name: "Ines ROBERT", prime: 100 },
    { name: "Tom RICHARD", prime: 0 },
  ];

  const rows = JourAbs.primeIncreases(current, previous);

  assert.deepEqual(rows, [
    { name: "Paul MARTIN", prime: 350, previous: 250, increase: 100 },
    { name: "Nina DURAND", prime: 300, previous: null, increase: 300 },
  ]);
});

test("matches employees across months ignoring case, accents and extra spaces", () => {
  const rows = JourAbs.primeIncreases(
    [{ name: "Zoé  MARTIN ", prime: 400 }],
    [{ name: "zoe martin", prime: 400 }],
  );

  assert.deepEqual(rows, []);
});

test("recognises when one period is the month just before another", () => {
  const sep = JourAbs.readSummary(makeWorkbook({ ...SEP, employees: [{ name: "A B", prime: 0 }] })).period;
  const oct = JourAbs.readSummary(makeWorkbook({ ...OCT, employees: [{ name: "A B", prime: 0 }] })).period;

  assert.equal(JourAbs.isPreviousMonth(sep, oct), true);
  assert.equal(JourAbs.isPreviousMonth(oct, sep), false);
  assert.equal(JourAbs.isPreviousMonth(oct, oct), false);
});

test("JOUR ABS output is unchanged by the new checks", () => {
  const wb = octWorkbook([
    { name: "Alex MOREAU", prime: 150, weeks: [{ no: 42, days: [
      ["Lundi 12 octobre", 5], ["Mardi 13 octobre", 3], ["Mercredi 14 octobre", 1],
    ] }] },
  ]);

  const res = JourAbs.processWorkbook(wb);
  const ws = wb.getWorksheet("Fiche employés");

  assert.equal(res.employees, 1);
  assert.equal(ws.getCell(6, 32).value, 5 - 1.5); // JOUR ABS of week 42
  assert.equal(res.report[0].ruleDays, 1.5);
});
