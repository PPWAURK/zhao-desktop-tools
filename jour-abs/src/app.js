(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var drop = $("drop"), fileInput = $("file"), errBox = $("error"), resultBox = $("result");
  var prevDrop = $("prevDrop"), prevInput = $("prevFile");
  var MAX_FILES = 2;
  var WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  var MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
    "septembre", "octobre", "novembre", "décembre"];
  var output = null; // { blob, name }
  var current = null; // { period, primes } of the processed month

  function showError(message) {
    errBox.textContent = message; errBox.hidden = false; resultBox.hidden = true;
  }

  function errorText(e, fallback) {
    return typeof e === "string" ? e : (e && e.message) || fallback;
  }

  function fmtDate(ms) {
    var d = new Date(ms);
    return d.getUTCDate() + "/" + (d.getUTCMonth() + 1) + "/" + d.getUTCFullYear();
  }

  function fmtDay(ms) {
    var d = new Date(ms);
    return WEEKDAYS[d.getUTCDay()] + " " + d.getUTCDate() + "/" + (d.getUTCMonth() + 1);
  }

  function monthName(period) {
    var d = new Date(period.first);
    return MONTH_NAMES[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  function fmtNum(n) { return n === null || n === undefined ? "-" : String(Math.round(n * 100) / 100); }
  function fmtEur(n) { return n === null || n === undefined ? "—" : fmtNum(n) + " €"; }

  /** Fills a tbody with one row per item; cells after the first are right-aligned numbers. */
  function fillTable(body, rows) {
    body.textContent = "";
    rows.forEach(function (cells) {
      var tr = document.createElement("tr");
      cells.forEach(function (v, i) {
        var td = document.createElement("td"); td.textContent = v; if (i) td.className = "n"; tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function showDiffs(res) {
    var diffs = res.report.filter(function (r) { return r.systemDays !== r.ruleDays; });
    fillTable($("diffBody"), diffs.map(function (r) { return [r.name, fmtNum(r.systemDays), fmtNum(r.ruleDays)]; }));
    $("diffCard").hidden = diffs.length === 0;
    $("noDiff").hidden = diffs.length !== 0;
  }

  function showLongDays(longDays) {
    fillTable($("longBody"), longDays.map(function (d) { return [d.name, fmtDay(d.date), fmtNum(d.hours) + " h"]; }));
    $("longTable").hidden = longDays.length === 0;
    $("noLong").hidden = longDays.length !== 0;
    $("longCount").textContent = longDays.length ? "(" + longDays.length + ")" : "";
  }

  /** previous = { period, primes } or null when no previous month was given. */
  function showPrimes(previous) {
    var waiting = !previous;
    $("primeWaiting").hidden = !waiting;
    $("primeResult").hidden = waiting;
    if (waiting) return;
    var rows = JourAbs.primeIncreases(current.primes, previous.primes);
    $("primeCompare").textContent = "Comparaison " + monthName(current.period) + " / " + monthName(previous.period) + ".";
    $("primeGap").hidden = JourAbs.isPreviousMonth(previous.period, current.period);
    fillTable($("primeBody"), rows.map(function (r) {
      return [r.name, fmtEur(r.prime), r.previous === null ? "absent" : fmtEur(r.previous), "+" + fmtEur(r.increase)];
    }));
    $("primeTable").hidden = rows.length === 0;
    $("noPrime").hidden = rows.length !== 0;
  }

  function showResult(res) {
    $("summary").textContent = "Traitement terminé : du " + fmtDate(res.period.first) + " au " + fmtDate(res.period.last) +
      ", " + res.employees + " employés.";
    showDiffs(res);
    showLongDays(res.longDays);
    errBox.hidden = true; resultBox.hidden = false;
  }

  async function readWorkbook(file) {
    var wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    return { file: file, wb: wb, summary: JourAbs.readSummary(wb) };
  }

  function checkFiles(files) {
    if (!files.length) return "Veuillez choisir un fichier Excel au format .xlsx.";
    if (files.length > MAX_FILES) return "Déposez au plus deux fichiers : le mois à traiter et le mois précédent.";
    var bad = files.filter(function (f) { return !/\.xlsx$/i.test(f.name); });
    return bad.length ? "Veuillez choisir un fichier Excel au format .xlsx (" + bad[0].name + ")." : null;
  }

  /** One file = month to process; two files = the later one is processed, the earlier one gives last month's primes. */
  async function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var problem = checkFiles(files);
    if (problem) { showError(problem); return; }
    try {
      var books = await Promise.all(files.map(readWorkbook));
      books.sort(function (a, b) { return a.summary.period.first - b.summary.period.first; });
      if (books.length === 2 && books[0].summary.period.first === books[1].summary.period.first) {
        showError("Les deux fichiers couvrent le même mois : déposez le mois à traiter et le mois précédent.");
        return;
      }
      var latest = books[books.length - 1];
      var res = JourAbs.processWorkbook(latest.wb);
      var buffer = await latest.wb.xlsx.writeBuffer();
      output = {
        blob: new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        name: latest.file.name.replace(/\.xlsx$/i, "") + "_jour_abs.xlsx"
      };
      current = { period: res.period, primes: res.primes };
      $("saved").hidden = true; $("reveal").hidden = true;
      showResult(res);
      showPrimes(books.length === 2 ? books[0].summary : null);
    } catch (e) {
      showError("Échec du traitement : " + errorText(e, "impossible de lire ce fichier"));
    }
  }

  async function handlePrevious(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var problem = files.length === 1 ? checkFiles(files) : "Déposez un seul fichier : celui du mois précédent.";
    if (problem || !current) { $("prevError").textContent = problem || ""; $("prevError").hidden = !problem; return; }
    try {
      var prev = (await readWorkbook(files[0])).summary;
      if (prev.period.first >= current.period.first) {
        throw new Error("ce fichier n'est pas antérieur au mois traité (" + monthName(prev.period) + ").");
      }
      $("prevError").hidden = true;
      showPrimes(prev);
    } catch (e) {
      $("prevError").textContent = "Impossible de comparer : " + errorText(e, "fichier illisible");
      $("prevError").hidden = false;
    }
  }

  /** Click, keyboard and drag-and-drop for a drop zone bound to a hidden file input. */
  function bindDropZone(zone, input, onFiles) {
    zone.addEventListener("click", function () { input.click(); });
    zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", function () { onFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove("over"); });
    });
    zone.addEventListener("drop", function (e) { onFiles(e.dataTransfer.files); });
  }

  bindDropZone(drop, fileInput, handleFiles);
  bindDropZone(prevDrop, prevInput, handlePrevious);

  var tauri = window.__TAURI__ && window.__TAURI__.core;

  async function saveWithApp() {
    var btn = $("download"), note = $("saved");
    btn.disabled = true;
    try {
      var bytes = new Uint8Array(await output.blob.arrayBuffer());
      var path = await tauri.invoke("save_xlsx", bytes, { headers: { "x-file-name": encodeURIComponent(output.name) } });
      if (!path) return; // dialog cancelled
      note.textContent = "Enregistré : " + path;
      note.hidden = false;
      $("reveal").hidden = false;
      $("reveal").onclick = function () { tauri.invoke("reveal_file", { path: path }).catch(function () {}); };
    } catch (e) {
      showError("Échec de l'enregistrement : " + errorText(e, "erreur inconnue"));
    } finally {
      btn.disabled = false;
    }
  }

  $("download").addEventListener("click", function () {
    if (!output) return;
    if (tauri) { saveWithApp(); return; }
    var url = URL.createObjectURL(output.blob), a = document.createElement("a");
    a.href = url; a.download = output.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // For automated checks.
  window.__handleFiles = handleFiles;
  window.__handlePrevious = handlePrevious;
})();
