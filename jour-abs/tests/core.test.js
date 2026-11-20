"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { JourAbs, makeWorkbook } = require("./helpers");

const OCT = { first: "2026-10-01", last: "2026-10-31" };
const SEP = { first: "2026-09-01", last: "2026-09-30" };

function octWorkbook(employees) {
  return makeWorkbook({ ...OCT, employees });
}

test("flags days where the shifts of one day add up to more than 9 hours", () => {
  // Arrange: two shifts on the same day (5 + 4.5 = 9.5 h), and a day of exactly 9 h
  const wb = octWorkbook([
    { name: "Kar Cong LEONG", prime: 0, weeks: [{ no: 42, days: [
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
    [["Kar Cong LEONG", "2026-10-12", 9.5], ["Kar Cong LEONG", "2026-10-14", 10.25]],
  );
});

test("ignores long days that belong to the neighbouring month", () => {
  // Week 44 runs from 26 Oct to 1 Nov: 1 November is outside the October period
  const wb = octWorkbook([
    { name: "Michel ZHENG", prime: 0, weeks: [{ no: 44, days: [
      ["Samedi 31 octobre", 10], ["Dimanche 1 novembre", 11],
    ] }] },
  ]);

  const res = JourAbs.processWorkbook(wb);

  assert.equal(res.longDays.length, 1);
  assert.equal(new Date(res.longDays[0].date).toISOString().slice(0, 10), "2026-10-31");
});

test("marks long days whose shifts overlap in time", () => {
  // Two evening shifts on the same slot (double booking): 4 + 5.25 + 4.75 = 14 h exported
  const wb = octWorkbook([
    { name: "Md Abdul MUKID", prime: 0, weeks: [{ no: 44, days: [
      ["Lundi 26 octobre", 4, "10h30", "15h00"],
      ["Lundi 26 octobre", 5.25, "18h00", "23h15"],
      ["Lundi 26 octobre", 4.75, "18h00", "23h15"],
      ["Mardi 27 octobre", 4.5, "10h30", "15h30"],
      ["Mardi 27 octobre", 5.25, "18h00", "23h15"],
    ] }] },
  ]);

  const days = JourAbs.processWorkbook(wb).longDays;

  assert.deepEqual(days.map((d) => [d.hours, d.overlap]), [[14, true], [9.75, false]]);
});

test("a shift ending exactly when the next starts is not an overlap", () => {
  const wb = octWorkbook([
    { name: "A B", prime: 0, weeks: [{ no: 42, days: [
      ["Lundi 12 octobre", 5, "10h00", "15h00"], ["Lundi 12 octobre", 5, "15h00", "20h00"],
    ] }] },
  ]);

  assert.equal(JourAbs.processWorkbook(wb).longDays[0].overlap, false);
});

test("returns no long days when nobody works more than 9 hours", () => {
  const wb = octWorkbook([
    { name: "Sylvie LI", prime: 100, weeks: [{ no: 41, days: [["Samedi 10 octobre", 8.75]] }] },
  ]);

  assert.deepEqual(JourAbs.processWorkbook(wb).longDays, []);
});

test("reads the prime of each employee from the Total row", () => {
  const wb = octWorkbook([
    { name: "Kar Cong LEONG", prime: 350, weeks: [] },
    { name: "Anjit GHOSH", prime: undefined, weeks: [] },
  ]);

  const summary = JourAbs.readSummary(wb);

  assert.deepEqual(summary.primes, [
    { name: "Kar Cong LEONG", prime: 350 },
    { name: "Anjit GHOSH", prime: 0 },
  ]);
  assert.equal(new Date(summary.period.first).toISOString().slice(0, 10), "2026-10-01");
});

test("readSummary does not modify the workbook", () => {
  const wb = octWorkbook([{ name: "Sylvie LI", prime: 100, weeks: [{ no: 41, days: [["Samedi 10 octobre", 6]] }] }]);

  JourAbs.readSummary(wb);

  assert.equal(wb.getWorksheet("Fiche employés").getCell(6, 32).value, null);
});

test("lists primes above 250 € that increased since last month", () => {
  const current = [
    { name: "Kar Cong LEONG", prime: 350 }, // 250 -> 350: flagged
    { name: "Mohamed SAMSUDDIN", prime: 600 }, // unchanged: not flagged
    { name: "Victor LIN", prime: 150 }, // decreased: not flagged
    { name: "Sylvie LI", prime: 200 }, // increased but not above 250
    { name: "Jun-Yi XU", prime: 250 }, // exactly 250 is not "above"
    { name: "Islam NAJRUL", prime: 300 }, // absent last month: flagged as new
  ];
  const previous = [
    { name: "Kar Cong LEONG", prime: 250 },
    { name: "Mohamed SAMSUDDIN", prime: 600 },
    { name: "Victor LIN", prime: 250 },
    { name: "Sylvie LI", prime: 100 },
    { name: "Jun-Yi XU", prime: 0 },
  ];

  const rows = JourAbs.primeIncreases(current, previous);

  assert.deepEqual(rows, [
    { name: "Kar Cong LEONG", prime: 350, previous: 250, increase: 100 },
    { name: "Islam NAJRUL", prime: 300, previous: null, increase: 300 },
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
    { name: "Md Abdul MUKID", prime: 150, weeks: [{ no: 42, days: [
      ["Lundi 12 octobre", 5], ["Mardi 13 octobre", 3], ["Mercredi 14 octobre", 1],
    ] }] },
  ]);

  const res = JourAbs.processWorkbook(wb);
  const ws = wb.getWorksheet("Fiche employés");

  assert.equal(res.employees, 1);
  assert.equal(ws.getCell(6, 32).value, 5 - 1.5); // JOUR ABS of week 42
  assert.equal(res.report[0].ruleDays, 1.5);
});
