/* Core logic for JOUR ABS: reads the monthly "Fiche employés" export, writes JOUR ABS columns,
   and lists long days and prime increases. Plain ES module, used by the app and the Node tests. */
const JourAbs = (function () {
  "use strict";

  var SHEET = "Fiche employés";
  var OUT_COL = 32; // AF: JOUR ABS (weekly)
  var EXTRA_COL = 33; // AG: extra days worked above 5 (weekly)
  var NET_COL = 34; // AH: net monthly JOUR ABS = sum of AF - sum of AG (total row only)
  var WEEK_BASE_DAYS = 5;
  var FULL_DAY_H = 5;
  var HALF_DAY_H = 2;
  var MIN_FULL_TIME_H = 35;
  var MIN_DAYS_IN_MONTH = 4; // more than 3 days
  var DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  var MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
    "septembre", "octobre", "novembre", "décembre"];
  var CONTRACTS = ["CDI", "CDD", "Extra", "Aucun contrat"];
  var HEADER_NOTE = "Jours d'absence par semaine = 5 - jours travaillés convertis (>=5h = 1 j; " +
    ">2h et <5h = 0,5 j; <=2h = 0 j). Vide: sans contrat/sans ligne, contrat <35h, aucune heure travaillée.";
  var EXTRA_NOTE = "Jours en plus par semaine = jours convertis - 5, quand la semaine dépasse 5 jours.";
  var NET_NOTE = "JOUR ABS net du mois = total JOUR ABS - total JOURS EN +. " +
    "Équivaut à 22 - (22 - absences + jours en plus), exemple: 1 + 2 - 1 - 0,5 = 1,5 jour.";
  var DAY_MS = 86400000;
  var LONG_DAY_H = 9; // a day is flagged when its shifts add up to this many hours or more
  var PRIME_MIN_EUR = 250; // prime increases are flagged only above this amount
  var PRIME_HEADER = "Primes (€)";
  var PRIME_COL = 27; // AA: used when the header is not found

  function utc(y, m, d) { return Date.UTC(y, m - 1, d); }

  function dayCredit(hours) {
    if (hours >= FULL_DAY_H) return 1;
    return hours > HALF_DAY_H ? 0.5 : 0;
  }

  function cellValue(cell) {
    var v = cell.value;
    if (v && typeof v === "object") {
      if ("result" in v) return v.result;
      if (v.richText) return v.richText.map(function (t) { return t.text; }).join("");
      if (v instanceof Date) return v;
    }
    return v === undefined ? null : v;
  }

  function text(ws, r, c) {
    var v = cellValue(ws.getCell(r, c));
    return v === null || v === undefined ? "" : String(v);
  }

  function startsWithDay(s) {
    return DAY_NAMES.some(function (d) { return s.indexOf(d) === 0; });
  }

  function parsePeriod(ws) {
    var re = /\((\d\d)\/(\d\d)\/(\d{4})-(\d\d)\/(\d\d)\/(\d{4})\)/;
    for (var r = 1; r <= ws.rowCount; r++) {
      var m = re.exec(text(ws, r, 1));
      if (m) return { first: utc(+m[3], +m[2], +m[1]), last: utc(+m[6], +m[5], +m[4]) };
    }
    throw new Error("Période (dd/mm/yyyy-dd/mm/yyyy) introuvable");
  }

  function year(ms) { return new Date(ms).getUTCFullYear(); }

  /** Pick the year (period year -1/0/+1) that puts the date closest to the period. */
  function closestToPeriod(month, day, period) {
    var best = null, bestDist = Infinity;
    [-1, 0, 1].forEach(function (off) {
      var t = utc(year(period.first) + off, month, day);
      var dist = t < period.first ? period.first - t : (t > period.last ? t - period.last : 0);
      if (dist < bestDist) { bestDist = dist; best = t; }
    });
    return best;
  }

  function labelDate(label, period) {
    var m = /^\S+ (\d+) (\S+)/.exec(label || "");
    if (!m) return null;
    var idx = MONTHS.indexOf(m[2].toLowerCase());
    return idx < 0 ? null : closestToPeriod(idx + 1, +m[1], period);
  }

  function isoMonday(weekNo, period) {
    var best = null, bestDist = Infinity;
    [-1, 0, 1].forEach(function (off) {
      var y = year(period.first) + off;
      var jan4 = utc(y, 1, 4);
      var dow = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
      var monday = jan4 - dow * DAY_MS + (weekNo - 1) * 7 * DAY_MS;
      var dist = monday + 6 * DAY_MS < period.first ? period.first - monday :
        (monday > period.last ? monday - period.last : 0);
      if (dist < bestDist) { bestDist = dist; best = monday; }
    });
    return best;
  }

  function daysInMonth(weekNo, period) {
    if (weekNo === null) return 0;
    var monday = isoMonday(weekNo, period), n = 0;
    for (var i = 0; i < 7; i++) {
      var t = monday + i * DAY_MS;
      if (t >= period.first && t <= period.last) n++;
    }
    return n;
  }

  function primeColumn(ws, headerRow) {
    for (var c = 1; c <= ws.columnCount; c++) {
      if (text(ws, headerRow, c).trim() === PRIME_HEADER) return c;
    }
    return PRIME_COL;
  }

  /** Amount in euros; an empty cell is 0; anything unreadable (text, formula error) is null. */
  function parseAmount(v) {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v !== "string") return null;
    var s = v.replace(/[\s\u00a0\u202f€]/g, "").replace(",", ".");
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  }

  function readPrime(ws, totalRow) {
    return parseAmount(cellValue(ws.getCell(totalRow, primeColumn(ws, totalRow - 1))));
  }

  /** "18h00" -> minutes since midnight, or null ("toute la journée", empty). */
  function parseClock(s) {
    var m = /^(\d{1,2})h(\d{2})$/.exec(String(s || "").trim());
    return m ? +m[1] * 60 + +m[2] : null;
  }

  /** A timed day row: start/end in minutes (an end before the start runs past midnight). */
  function readShift(ws, r, hours) {
    var startText = text(ws, r, 7).trim(), endText = text(ws, r, 8).trim();
    var start = parseClock(startText), end = parseClock(endText);
    if (start === null || end === null) return null;
    return { start: start, end: end <= start ? end + 24 * 60 : end, startText: startText, endText: endText,
      hours: hours, poste: text(ws, r, 2).trim() };
  }

  function overlapMinutes(a, b) {
    return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  }

  /** Same slot planned twice: they overlap by at least half of the shorter shift. */
  function isDuplicateSlot(a, b) {
    var shorter = Math.min(a.end - a.start, b.end - b.start);
    return shorter > 0 && overlapMinutes(a, b) * 2 >= shorter;
  }

  /**
   * A double-booked slot is counted once: the shorter shift (fewest hours) is kept, the other is
   * set aside. Small partial overlaps keep both shifts.
   */
  function splitDuplicates(shifts) {
    var byHours = shifts.slice().sort(function (a, b) { return a.hours - b.hours || a.start - b.start; });
    return byHours.reduce(function (acc, sh) {
      var dup = acc.kept.some(function (k) { return isDuplicateSlot(k, sh); });
      return dup ? { kept: acc.kept, removed: acc.removed.concat([sh]) }
        : { kept: acc.kept.concat([sh]), removed: acc.removed };
    }, { kept: [], removed: [] });
  }

  /** Hours actually worked in a day: untimed rows plus timed shifts, duplicates counted once. */
  function dayWorked(day) {
    var split = splitDuplicates(day.shifts);
    var timed = split.kept.reduce(function (sum, sh) { return sum + sh.hours; }, 0);
    return { hours: round2(day.untimedHours + timed), removed: split.removed };
  }

  /** True when two shifts of the same day share some time (touching ends do not count). */
  function hasOverlap(shifts) {
    var sorted = shifts.slice().sort(function (a, b) { return a.start - b.start; });
    return sorted.some(function (s, i) { return i > 0 && s.start < sorted[i - 1].end; });
  }

  function readBlocks(ws, period) {
    var blocks = [], emp = null, prevWeek = null;
    var isDay = function (r) { return startsWithDay(text(ws, r, 1)); };
    for (var r = 1; r <= ws.rowCount; r++) {
      var a = text(ws, r, 1);
      var isWeek = text(ws, r, 3) === "-" && CONTRACTS.indexOf(text(ws, r, 4)) >= 0 && !isDay(r);
      if (a.indexOf("Total") === 0) {
        emp = { name: text(ws, r - 3, 1), totalRow: r, weeks: [], sysDays: cellValue(ws.getCell(r, 13)),
          prime: readPrime(ws, r) };
        blocks.push(emp); prevWeek = null;
      } else if (isWeek && emp) {
        var m = /^Semaine (\d+)/.exec(a);
        var weekNo = m ? +m[1] : (prevWeek ? prevWeek + 1 : null);
        prevWeek = weekNo;
        var days = [], idx = {}, q = r + 1;
        while (q <= ws.rowCount && isDay(q)) {
          var d = labelDate(text(ws, q, 1), period);
          var h = cellValue(ws.getCell(q, 12));
          h = typeof h === "number" ? h : 0;
          if (idx[d] === undefined) { idx[d] = days.length; days.push({ date: d, hours: 0, untimedHours: 0, shifts: [] }); }
          var day = days[idx[d]];
          day.hours += h; // as exported (used for JOUR ABS, unchanged)
          var shift = h > 0 ? readShift(ws, q, h) : null;
          if (shift) day.shifts.push(shift);
          else day.untimedHours += h;
          q++;
        }
        var vol = cellValue(ws.getCell(r, 5));
        emp.weeks.push({ row: r, no: weekNo, contract: text(ws, r, 4), volume: vol, days: days, abs: null });
      }
    }
    return blocks;
  }

  function compute(blocks, period) {
    return blocks.map(function (emp) {
      var workedH = 0, ruleDays = 0;
      emp.weeks.forEach(function (w) {
        w.days.forEach(function (d) {
          workedH += d.hours;
          if (d.date !== null && d.date >= period.first && d.date <= period.last) ruleDays += dayCredit(d.hours);
        });
      });
      emp.weeks.forEach(function (w) {
        w.abs = null; w.extra = null;
        var fullTime = w.contract === "Extra" ||
          ((w.contract === "CDI" || w.contract === "CDD") && typeof w.volume === "number" && w.volume >= MIN_FULL_TIME_H);
        if (!fullTime || w.days.length === 0 || workedH === 0 || daysInMonth(w.no, period) < MIN_DAYS_IN_MONTH) return;
        var credits = w.days.reduce(function (s, d) { return s + dayCredit(d.hours); }, 0);
        w.abs = Math.max(0, WEEK_BASE_DAYS - credits);
        w.extra = Math.max(0, credits - WEEK_BASE_DAYS);
      });
      return { name: emp.name, systemDays: emp.sysDays, ruleDays: ruleDays };
    });
  }

  function colLetter(n) {
    var s = "";
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  function copyStyle(target, source) {
    target.style = JSON.parse(JSON.stringify(source.style || {}));
  }

  function setHeader(ws, row, col, label) {
    var cell = ws.getCell(row, col);
    cell.value = label;
    copyStyle(cell, ws.getCell(row, 31));
    return cell;
  }

  function setNumber(ws, row, col, value) {
    var cell = ws.getCell(row, col);
    cell.value = value;
    copyStyle(cell, ws.getCell(row, 13));
    cell.numFmt = "0.0;-0.0;0";
  }

  function sumFormula(col, rows) {
    return rows.map(function (r) { return colLetter(col) + r; }).join("+");
  }

  function write(ws, blocks) {
    blocks.forEach(function (emp) {
      var t = emp.totalRow, hdr = t - 1;
      setHeader(ws, hdr, OUT_COL, "JOUR ABS");
      setHeader(ws, hdr, EXTRA_COL, "JOURS EN +");
      setHeader(ws, hdr, NET_COL, "JOUR ABS NET");
      var rows = [], sumAbs = 0, sumExtra = 0;
      emp.weeks.forEach(function (w) {
        if (w.abs === null) return;
        rows.push(w.row); sumAbs += w.abs; sumExtra += w.extra;
        setNumber(ws, w.row, OUT_COL, w.abs);
        setNumber(ws, w.row, EXTRA_COL, w.extra);
      });
      setNumber(ws, t, OUT_COL, rows.length ? { formula: sumFormula(OUT_COL, rows), result: sumAbs } : 0);
      setNumber(ws, t, EXTRA_COL, rows.length ? { formula: sumFormula(EXTRA_COL, rows), result: sumExtra } : 0);
      setNumber(ws, t, NET_COL, {
        formula: colLetter(OUT_COL) + t + "-" + colLetter(EXTRA_COL) + t, result: sumAbs - sumExtra });
    });
    var firstHdr = blocks[0].totalRow - 1;
    ws.getCell(firstHdr, OUT_COL).note = HEADER_NOTE;
    ws.getCell(firstHdr, EXTRA_COL).note = EXTRA_NOTE;
    ws.getCell(firstHdr, NET_COL).note = NET_NOTE;
    [OUT_COL, EXTRA_COL, NET_COL].forEach(function (col) { ws.getColumn(col).width = 13; });
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function forEachMonthDay(blocks, period, fn) {
    blocks.forEach(function (emp) {
      emp.weeks.forEach(function (w) {
        w.days.forEach(function (d) {
          if (d.date !== null && d.date >= period.first && d.date <= period.last) fn(emp, d);
        });
      });
    });
  }

  /**
   * Days of the month where an employee worked LONG_DAY_H hours or more. A double-booked slot is
   * counted once (see splitDuplicates); exportHours keeps the total as exported.
   */
  function findLongDays(blocks, period) {
    var out = [];
    forEachMonthDay(blocks, period, function (emp, d) {
      var worked = dayWorked(d);
      if (worked.hours >= LONG_DAY_H) {
        out.push({ name: emp.name, date: d.date, hours: worked.hours, exportHours: round2(d.hours),
          overlap: hasOverlap(d.shifts) });
      }
    });
    return out;
  }

  /** Shifts set aside because they double-book a slot (the export still counts them). */
  function findDuplicateShifts(blocks, period) {
    var out = [];
    forEachMonthDay(blocks, period, function (emp, d) {
      var worked = dayWorked(d);
      worked.removed.forEach(function (sh) {
        out.push({ name: emp.name, date: d.date, poste: sh.poste, start: sh.startText, end: sh.endText,
          hours: sh.hours, dayHours: worked.hours, exportHours: round2(d.hours) });
      });
    });
    return out;
  }

  function listPrimes(blocks) {
    return blocks.map(function (emp) { return { name: emp.name, prime: emp.prime }; });
  }

  function normalizeName(name) {
    return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/\s+/g, " ").trim();
  }

  /**
   * Employees whose prime is above minPrime (default 250 €) and higher than last month.
   * Someone absent from last month's file counts as a previous prime of 0 (previous: null).
   */
  function primeIncreases(current, previous, minPrime) {
    var min = typeof minPrime === "number" ? minPrime : PRIME_MIN_EUR;
    var before = {};
    (previous || []).forEach(function (p) { before[normalizeName(p.name)] = p.prime; });
    return (current || []).reduce(function (rows, c) {
      var key = normalizeName(c.name);
      var absent = !Object.prototype.hasOwnProperty.call(before, key);
      var prev = absent ? null : before[key];
      if (c.prime === null || (!absent && prev === null)) return rows; // unreadable: see unreadablePrimes
      if (c.prime > min && c.prime > (absent ? 0 : prev)) {
        rows.push({ name: c.name, prime: c.prime, previous: prev, increase: round2(c.prime - (prev || 0)) });
      }
      return rows;
    }, []);
  }

  /** Names whose prime cell could not be read, so they were left out of the comparison. */
  function unreadablePrimes(current, previous) {
    var bad = function (list) { return (list || []).filter(function (p) { return p.prime === null; }); };
    return bad(current).map(function (p) { return p.name; })
      .concat(bad(previous).map(function (p) { return p.name + " (mois précédent)"; }));
  }

  /** True when period `prev` is the calendar month right before period `cur`. */
  function isPreviousMonth(prev, cur) {
    var p = new Date(prev.first), c = new Date(cur.first);
    var months = (c.getUTCFullYear() - p.getUTCFullYear()) * 12 + (c.getUTCMonth() - p.getUTCMonth());
    return months === 1;
  }

  function loadSheet(wb) {
    var ws = wb.getWorksheet(SHEET);
    if (!ws) throw new Error("Onglet « " + SHEET + " » introuvable : vérifiez que c'est bien l'export mensuel");
    var period = parsePeriod(ws);
    var blocks = readBlocks(ws, period);
    if (!blocks.length) throw new Error("Aucune donnée d'employé trouvée");
    return { ws: ws, period: period, blocks: blocks };
  }

  /** Reads period, primes and long days without changing the workbook. */
  function readSummary(wb) {
    var s = loadSheet(wb);
    return { period: s.period, employees: s.blocks.length, primes: listPrimes(s.blocks),
      longDays: findLongDays(s.blocks, s.period), duplicateShifts: findDuplicateShifts(s.blocks, s.period) };
  }

  function processWorkbook(wb) {
    var s = loadSheet(wb);
    var report = compute(s.blocks, s.period);
    write(s.ws, s.blocks);
    return { period: s.period, employees: s.blocks.length, report: report,
      primes: listPrimes(s.blocks), longDays: findLongDays(s.blocks, s.period),
      duplicateShifts: findDuplicateShifts(s.blocks, s.period) };
  }

  var api = {
    processWorkbook: processWorkbook, readSummary: readSummary, primeIncreases: primeIncreases,
    unreadablePrimes: unreadablePrimes,
    isPreviousMonth: isPreviousMonth, dayCredit: dayCredit, LONG_DAY_H: LONG_DAY_H, PRIME_MIN_EUR: PRIME_MIN_EUR
  };
  return api;
})();

export default JourAbs;
