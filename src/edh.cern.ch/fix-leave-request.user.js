// ==UserScript==
// @name         EDH Absence Request - Calendar selection
// @namespace    edh-absence-calendar
// @version      1.2.0
// @description  Adds a big half-day calendar to the EDH Absence Request (LVRQ) form. Paint Annual Leave / Teleworking on half-days; the calendar is kept in two-way sync with the "Absence periods" rows.
// @author       Dariusz Zielinski
// @match        https://edh.cern.ch/Document/Claims/LeaveRequest
// @noframes
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * How it works
 * ------------
 * This EDH form posts the whole MainForm and RELOADS the page on almost every
 * change (doSubmit -> cmd('validate'), AddLine -> cmd('addItem'), month
 * navigation -> cmd('prevMonth'/'nextMonth'/'gotoToday')).
 *
 * Therefore:
 *  - The user's half-day selection is kept in sessionStorage (keyed by the
 *    page pathname) so it survives all those reloads.
 *  - Month navigation buttons of this calendar simply invoke the site's own
 *    prevMonth()/nextMonth()/gotoToday() -> both calendars always move together.
 *  - "Apply" runs a small state machine across page reloads:
 *      1. fill empty "Absence periods" rows with the computed periods
 *         (setting input/select .value does NOT fire onchange, so nothing is
 *         submitted prematurely),
 *      2. if more rows are needed, call cmd('addItem') - the POST carries the
 *         values filled in step 1 along with it and adds one empty row,
 *      3. repeat after the reload until all periods are placed, then submit
 *         once with doSubmit() (command 'validate') so EDH validates
 *         everything and computes durations.
 *    Progress is stored in sessionStorage; a step limit and a "cancel" link
 *    protect against endless reload loops.
 *
 * Two-way sync (v1.1)
 * -------------------
 * The calendar selection is an editable mirror of the Annual Leave /
 * Teleworking rows in "Absence periods":
 *  - On every load the rows are parsed back into half-day slots. A snapshot
 *    of the previous parse ('rowsel') allows a three-way merge, so pending
 *    calendar edits survive month navigation while manual row edits made in
 *    the form are picked up for untouched slots.
 *  - "Apply" reconciles: it creates missing rows, repairs times, and DELETES
 *    managed (AL/TW, valid dates) rows that no longer correspond to the
 *    selection - one deleteItem per reload. Rows of any other leave type are
 *    never touched.
 *  - If the changes include Teleworking, Apply first asks for a comment
 *    (default "Local teleworking") which is inserted into the
 *    "Phone/location during absence" Comments field.
 *
 * v1.2 notes
 * ----------
 *  - The editable-page trigger accepts the "AddLine" link as well, because
 *    EDH renders ZERO rows right after the last row is deleted; keying off
 *    LeaveType.0 alone made the extension (and a mid-flight Apply machine)
 *    disappear on that intermediate page.
 *  - Summary items are marked (new)/(changed), deleted rows are listed
 *    struck-through as (removed).
 *  - Slots cleared by the user (row exists, selection doesn't) are displayed
 *    as regular work with the selection outline, instead of letting the
 *    Balance base colour hide the pending change.
 *  - The teleworking comment prompt only appears while the Comments field is
 *    empty; no success banner/toast is shown after Apply.
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Configuration                                                     *
   * ------------------------------------------------------------------ */

  // Colours copied from the site's own Balance calendar (leaverequest.css).
  const COLORS = {
    noLeave: '#f2f2f2',
    holiday: '#9B9B9B',
    annualLeave: '#3399FF',
    teleworking: '#BFBFBF',
    compensation: '#FF8484',
    savedLeave: '#CCFFFF',
    shortTermSavedLeave: '#6EC5B8',
    longTermsavedLeave: '#336666',
    otherLeave: '#0000FF',
    travelLeave: '#0000FF',
    fullIllness: '#00FF00',
    fullReduced: '#FF99FF',
  };

  // Paintable absence types. "value" is the value of the LeaveType.N select.
  const TYPES = {
    AL: { name: 'Annual Leave', cls: 'annualLeave', value: '0', hover: 'rgba(51,153,255,0.45)' },
    TW: { name: 'Teleworking', cls: 'teleworking', value: '9', hover: 'rgba(110,110,110,0.35)' },
  };
  const CLEAR_HOVER = 'rgba(255,255,255,0.65)';
  const TODAY_OUTLINE = '#2e7d32';

  /* ------------------------------------------------------------------ *
   *  Module state                                                      *
   * ------------------------------------------------------------------ */

  let form = null;       // document.MainForm
  let NS = '';           // sessionStorage namespace (per page pathname)
  let cur = null;        // {y, m} - month currently displayed by the site
  let monthKey = '';     // "YYYY-MM" of the displayed month
  let sel = {};          // user selection: {"YYYY-MM-DD": {am:'AL'|'TW', pm:'AL'|'TW'}}
  let baseData = {};     // scraped base colouring: {"YYYY-MM": {day: [amCls, pmCls]}}
  let active = 'AL';     // active paint type: 'AL' | 'TW' | 'CLEAR'
  let applying = false;  // an Apply state machine is in progress
  let rowSelSnap = {};   // selection derived from the CURRENT rows ('rowsel'
                         // snapshot) - used to display "pending clear" slots

  /* ------------------------------------------------------------------ *
   *  Small helpers                                                     *
   * ------------------------------------------------------------------ */

  function loadJSON(key, fallback) {
    try {
      const v = sessionStorage.getItem(NS + ':' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try {
      sessionStorage.setItem(NS + ':' + key, JSON.stringify(value));
    } catch (e) { /* storage full/blocked - selection just won't persist */ }
  }
  function delKey(key) {
    try { sessionStorage.removeItem(NS + ':' + key); } catch (e) { /* ignore */ }
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function keyOf(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function fmtDMY(key) { const p = key.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function dateFromKey(key) {
    const p = key.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2], 12, 0, 0); // noon avoids DST edge cases
  }
  function keyFromDate(dt) { return keyOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
  function addDays(key, n) {
    const d = dateFromKey(key);
    d.setDate(d.getDate() + n);
    return keyFromDate(d);
  }
  function isWeekendKey(key) {
    const wd = dateFromKey(key).getDay();
    return wd === 0 || wd === 6;
  }
  function baseFor(key) {
    const p = key.split('-');
    const md = baseData[p[0] + '-' + p[1]];
    return md ? md[String(Number(p[2]))] : null;
  }
  // A whole day on which no leave can be taken (weekend or public holiday).
  function isNonWorking(key) {
    const b = baseFor(key);
    if (b) return b[0] === 'holiday' && b[1] === 'holiday';
    return isWeekendKey(key);
  }

  /* ------------------------------------------------------------------ *
   *  Scraping the site's Balance calendar                              *
   * ------------------------------------------------------------------ */

  // Returns {dayNumber: [morningClass, afternoonClass]} for the month
  // currently rendered in the site's #calendar table.
  function scrapeBase(calTable) {
    const out = {};
    const tds = calTable.querySelectorAll('td');
    for (let i = 0; i < tds.length; i++) {
      const td = tds[i];
      const span = td.querySelector('span');
      if (!span) continue;
      const m = span.textContent.match(/(\d+)/);
      if (!m) continue;
      const divs = [];
      for (let c = 0; c < td.children.length; c++) {
        if (td.children[c].tagName === 'DIV') divs.push(td.children[c]);
      }
      if (divs.length < 2) continue;
      const clsOf = function (d) {
        const c = (d.className || '').split(/\s+/)[0];
        return c || 'noLeave';
      };
      out[String(Number(m[1]))] = [clsOf(divs[0]), clsOf(divs[1])];
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   *  Selection model                                                   *
   * ------------------------------------------------------------------ */

  function halfSel(key, half) {
    return sel[key] ? sel[key][half] : undefined;
  }

  function setHalf(key, half, type) { // type: 'AL' | 'TW' | null (= remove)
    if (!sel[key]) sel[key] = {};
    if (type) sel[key][half] = type;
    else delete sel[key][half];
    if (!sel[key].am && !sel[key].pm) delete sel[key];
    saveJSON('sel', sel);
  }

  function onHalfClick(key, half) {
    if (applying) return; // don't touch the selection mid-apply
    const current = halfSel(key, half);
    if (active === 'CLEAR' || current === active) setHalf(key, half, null);
    else setHalf(key, half, active);
    renderCalendar();
    renderSummary();
  }

  /* ------------------------------------------------------------------ *
   *  Grouping the selection into absence periods                       *
   * ------------------------------------------------------------------ */

  // Does (slotDate, slotHalf) directly continue a period ending at
  // (endDate, endHalf)?  PM -> AM continues across the next WORKING day
  // (weekends and known full-day holidays are skipped).
  function isNextSlot(endDate, endHalf, slot) {
    if (endHalf === 'am') return slot.date === endDate && slot.half === 'pm';
    let k = addDays(endDate, 1);
    let guard = 0;
    while (isNonWorking(k) && guard < 120) { k = addDays(k, 1); guard++; }
    return slot.date === k && slot.half === 'am';
  }

  function computePeriods(selection) {
    const slots = [];
    const keys = Object.keys(selection).sort();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (selection[k].am) slots.push({ date: k, half: 'am', type: selection[k].am });
      if (selection[k].pm) slots.push({ date: k, half: 'pm', type: selection[k].pm });
    }
    const periods = [];
    let curP = null;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (curP && s.type === curP.type && isNextSlot(curP.endDate, curP.endHalf, s)) {
        curP.endDate = s.date;
        curP.endHalf = s.half;
        curP.halves++;
      } else {
        curP = { type: s.type, startDate: s.date, startHalf: s.half, endDate: s.date, endHalf: s.half, halves: 1 };
        periods.push(curP);
      }
    }
    return periods;
  }

  /* ------------------------------------------------------------------ *
   *  "Absence periods" form rows                                       *
   * ------------------------------------------------------------------ */

  function getRowIndices() {
    const out = [];
    for (let i = 0; i < form.elements.length; i++) {
      const el = form.elements[i];
      const m = el.name && el.name.match(/^LeaveType\.(\d+)$/);
      if (m) out.push(Number(m[1]));
    }
    return out.sort(function (a, b) { return a - b; });
  }

  function rowVals(i) {
    const names = ['LeaveType', 'StartDate', 'StartTime', 'EndDate', 'EndTime'];
    const els = {};
    for (let n = 0; n < names.length; n++) {
      const el = form.elements[names[n] + '.' + i];
      if (!el) return null; // row of an exotic leave type without time selects
      els[names[n]] = el;
    }
    return {
      type: els.LeaveType.value,
      sd: els.StartDate.value.trim(),
      st: els.StartTime.value,
      ed: els.EndDate.value.trim(),
      et: els.EndTime.value,
    };
  }

  function periodVals(p) {
    return {
      type: TYPES[p.type].value,
      sd: fmtDMY(p.startDate),
      st: p.startHalf === 'pm' ? '1' : '0',
      ed: fmtDMY(p.endDate),
      et: p.endHalf === 'am' ? '0' : '1',
    };
  }

  function normDate(s) {
    const m = (s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    return m ? (Number(m[1]) + '.' + Number(m[2]) + '.' + m[3]) : (s || '');
  }

  function rowMatches(r, p) {
    return !!r && r.type === p.type &&
      normDate(r.sd) === normDate(p.sd) && r.st === p.st &&
      normDate(r.ed) === normDate(p.ed) && r.et === p.et;
  }

  // Same type and dates, but (possibly) wrong times. EDH tends to reset the
  // time selects to the full-day defaults when a date changes (the "hour
  // jumps back to 08:30" bug) - such rows just need their times set again.
  function rowMatchesDates(r, p) {
    return !!r && r.type === p.type &&
      normDate(r.sd) === normDate(p.sd) && normDate(r.ed) === normDate(p.ed);
  }

  function fillRow(i, v) {
    form.elements['LeaveType.' + i].value = v.type;
    form.elements['StartDate.' + i].value = v.sd;
    form.elements['StartTime.' + i].value = v.st;
    form.elements['EndDate.' + i].value = v.ed;
    form.elements['EndTime.' + i].value = v.et;
  }

  /* ------------------------------------------------------------------ *
   *  Rows -> selection (two-way sync)                                  *
   * ------------------------------------------------------------------ */

  function parseDMY(s) {
    const m = (s || '').match(/^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return keyOf(y, mo, d);
  }

  function typeKeyOf(leaveTypeValue) {
    if (leaveTypeValue === TYPES.AL.value) return 'AL';
    if (leaveTypeValue === TYPES.TW.value) return 'TW';
    return null;
  }

  // Is this a row that the calendar manages (AL/TW with both dates parseable)?
  function isManagedRow(v) {
    return !!v && typeKeyOf(v.type) !== null &&
      parseDMY(v.sd) !== null && parseDMY(v.ed) !== null;
  }

  // Parse the current "Absence periods" rows back into half-day selection.
  function deriveRowSel() {
    const out = {};
    const rows = getRowIndices();
    for (let r = 0; r < rows.length; r++) {
      const v = rowVals(rows[r]);
      if (!isManagedRow(v)) continue;
      const type = typeKeyOf(v.type);
      const sdKey = parseDMY(v.sd);
      const edKey = parseDMY(v.ed);
      let k = sdKey;
      let guard = 0;
      while (k <= edKey && guard < 400) { // ISO keys compare correctly as strings
        if (!isNonWorking(k)) {
          const am = !(k === sdKey && v.st === '1'); // starts at 13:30 -> no morning
          const pm = !(k === edKey && v.et === '0'); // ends at 12:30 -> no afternoon
          if (am || pm) {
            if (!out[k]) out[k] = {};
            if (am) out[k].am = type;
            if (pm) out[k].pm = type;
          }
        }
        k = addDays(k, 1);
        guard++;
      }
    }
    return out;
  }

  // Per-half-slot three-way merge: slots the user did not touch follow the
  // rows; slots the user edited keep the user's pending value.
  function threeWayMerge(base, mine, theirs) {
    const out = {};
    const keySet = {};
    [base, mine, theirs].forEach(function (s) {
      Object.keys(s).forEach(function (k) { keySet[k] = true; });
    });
    Object.keys(keySet).forEach(function (k) {
      ['am', 'pm'].forEach(function (h) {
        const b = base[k] ? base[k][h] : undefined;
        const m = mine[k] ? mine[k][h] : undefined;
        const t = theirs[k] ? theirs[k][h] : undefined;
        const r = (m === b) ? t : m;
        if (r) {
          if (!out[k]) out[k] = {};
          out[k][h] = r;
        }
      });
    });
    return out;
  }

  // Drop selection slots that fall on known non-working half-days (they can
  // appear when a row spans a public holiday we only learn about later).
  function sanitizeSel(s) {
    Object.keys(s).forEach(function (k) {
      const b = baseFor(k);
      if (b) {
        if (b[0] === 'holiday') delete s[k].am;
        if (b[1] === 'holiday') delete s[k].pm;
      } else if (isWeekendKey(k)) {
        delete s[k];
      }
      if (s[k] && !s[k].am && !s[k].pm) delete s[k];
    });
    return s;
  }

  /* ------------------------------------------------------------------ *
   *  Reconciliation: desired periods vs existing rows                  *
   * ------------------------------------------------------------------ */

  // Pure computation, does not touch the form.
  //   toCreate: periods with no corresponding row
  //   toRepair: [{row, pv}] rows matching type+dates but with wrong times
  //   toDelete: managed row indices that match no desired period
  function computeReconciliation(periods) {
    const rows = getRowIndices();
    const matched = [];
    const toRepair = [];
    const toCreate = [];
    for (let pi = 0; pi < periods.length; pi++) {
      const pv = periodVals(periods[pi]);
      const full = rows.find(function (i) {
        return matched.indexOf(i) === -1 && rowMatches(rowVals(i), pv);
      });
      if (full !== undefined) { matched.push(full); continue; }
      const dateOnly = rows.find(function (i) {
        return matched.indexOf(i) === -1 && rowMatchesDates(rowVals(i), pv);
      });
      if (dateOnly !== undefined) {
        matched.push(dateOnly);
        toRepair.push({ row: dateOnly, pv: pv, period: periods[pi] });
        continue;
      }
      toCreate.push(periods[pi]);
    }
    const toDelete = rows.filter(function (i) {
      return matched.indexOf(i) === -1 && isManagedRow(rowVals(i));
    });
    return { toCreate: toCreate, toRepair: toRepair, toDelete: toDelete };
  }

  function reconciliationIsNoop(rec) {
    return rec.toCreate.length === 0 && rec.toRepair.length === 0 && rec.toDelete.length === 0;
  }

  // Insert the teleworking comment into the "Phone/location during absence"
  // field (idempotent - the value is posted with the next submit).
  function ensureComment(state) {
    if (!state.comment) return;
    const el = form.elements.Comments;
    if (!el) return;
    if (el.value.indexOf(state.comment) === -1) {
      el.value = el.value ? el.value + '\n' + state.comment : state.comment;
    }
  }

  function commentMissing(state) {
    if (!state.comment) return false;
    const el = form.elements.Comments;
    return !!el && el.value.indexOf(state.comment) === -1;
  }

  /* ------------------------------------------------------------------ *
   *  Apply state machine (runs across page reloads)                    *
   * ------------------------------------------------------------------ */

  function startApply() {
    if (applying) return;
    const periods = computePeriods(sel);
    const rec = computeReconciliation(periods);
    if (reconciliationIsNoop(rec)) return; // already in sync

    // Ask for the teleworking comment when the CHANGES involve teleworking
    // and the Comments field is still empty.
    let comment = null;
    const twInChanges =
      rec.toCreate.some(function (p) { return p.type === 'TW'; }) ||
      rec.toRepair.some(function (r) { return r.pv.type === TYPES.TW.value; });
    const commentsEl = form.elements.Comments;
    const commentsEmpty = !!commentsEl && commentsEl.value.trim() === '';
    if (twInChanges && commentsEmpty) {
      comment = window.prompt('Comment about teleworking', 'Local teleworking');
      if (comment === null) return; // cancelled -> abort the whole apply
      comment = comment.trim();
      if (!comment) comment = null; // empty -> no comment
    }

    const state = {
      periods: periods,
      phase: 'run',
      step: 0,
      comment: comment,
      maxSteps: periods.length + rec.toDelete.length + 10,
    };
    saveJSON('apply', state);
    applying = true;
    renderSummary();
    runApplyStep(state);
  }

  function runApplyStep(state) {
    if (!applying) return; // cancelled meanwhile
    state.step++;
    saveJSON('apply', state);

    const maxSteps = state.maxSteps || (state.periods.length + 10);
    if (state.step > maxSteps) {
      finishApply(false, 'Gave up after too many steps - EDH did not accept the changes as expected. ' +
        'Please review the "Absence periods" section manually.');
      return;
    }

    const rec = computeReconciliation(state.periods);

    if (reconciliationIsNoop(rec)) {
      // Rows are in sync. If the teleworking comment still has to be pushed,
      // do one more validate round-trip for it.
      if (commentMissing(state)) {
        ensureComment(state);
        state.phase = 'finalize';
        saveJSON('apply', state);
        showApplyBanner(state);
        window.doSubmit('');
        return;
      }
      finishApply(true);
      return;
    }

    ensureComment(state); // rides along with whatever is submitted below

    // Deletions first, one per reload (indices shift after each delete).
    // ITEMNO of deleteItem is 1-based (see DeleteLine(1) for row .0).
    if (rec.toDelete.length > 0) {
      state.phase = 'run';
      saveJSON('apply', state);
      showApplyBanner(state);
      window.cmd('deleteItem', '', rec.toDelete[0] + 1);
      return;
    }

    // In the finalize phase all rows already exist; if some period has no row
    // with matching dates at all, EDH refused it - stop instead of looping.
    if (state.phase === 'finalize' && rec.toCreate.length > 0) {
      finishApply(false, rec.toCreate.length + ' period(s) were not accepted by EDH - check the ' +
        '"Absence periods" section and any error message at the top of the page.');
      return;
    }

    // Repair times of rows whose dates already match (the "hour jumps back
    // to 08:30" server behaviour) - posted with the submit below.
    rec.toRepair.forEach(function (r) { fillRow(r.row, r.pv); });

    const empty = getRowIndices().filter(function (i) {
      const v = rowVals(i);
      return v && v.sd === '' && v.ed === '';
    });

    const n = Math.min(empty.length, rec.toCreate.length);
    for (let k = 0; k < n; k++) fillRow(empty[k], periodVals(rec.toCreate[k]));

    showApplyBanner(state);

    if (rec.toCreate.length > empty.length) {
      // Needs more rows: addItem posts the values filled above AND appends
      // one empty row. The page reloads and this machine continues.
      window.cmd('addItem', '', 0);
    } else {
      // Everything is filled - submit (command 'validate'). If the server
      // resets some times again, the repair branch above fixes them on the
      // next pass (bounded by the step limit).
      state.phase = 'finalize';
      saveJSON('apply', state);
      window.doSubmit('');
    }
  }

  function finishApply(ok, msg) {
    delKey('apply');
    applying = false;

    // Re-snapshot the rows. On success the selection becomes the exact
    // mirror of the rows (in sync, still editable). On failure the pending
    // selection is kept so the user can fix things and Apply again.
    rowSelSnap = deriveRowSel();
    saveJSON('rowsel', rowSelSnap);
    if (ok) {
      sel = sanitizeSel(JSON.parse(JSON.stringify(rowSelSnap)));
      saveJSON('sel', sel);
    }

    renderCalendar();
    renderSummary();
    if (ok) {
      hideBanner(); // done quietly - the updated rows below speak for themselves
    } else {
      showBanner('error', msg);
    }
  }

  /* ------------------------------------------------------------------ *
   *  UI                                                                *
   * ------------------------------------------------------------------ */

  function injectCSS() {
    const colorRules = Object.keys(COLORS).map(function (k) {
      return '#ec-root .ec-c-' + k + '{background:' + COLORS[k] + ';}';
    }).join('\n');

    const css = `
#ec-root { font-size: 13px; }
.ec-main { display: flex; gap: 18px; align-items: flex-start; }
.ec-types { display: flex; flex-direction: column; gap: 6px; min-width: 175px; }
.ec-types-title, .ec-nav-title { font-weight: bold; margin-bottom: 2px; }
.ec-typebtn {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border: 2px solid #bbb; border-radius: 4px; background: #fff;
  cursor: pointer; font-size: 13px; text-align: left; color: #333;
}
.ec-typebtn.ec-active { border-color: #1770DA; background: #eaf3ff; font-weight: bold; }
.ec-sw { width: 14px; height: 14px; display: inline-block; border: 1px solid #666; flex: none; }
.ec-calwrap { flex: 1 1 auto; min-width: 0; }
.ec-monthlabel { text-align: center; font-weight: bold; font-size: 14px; margin-bottom: 6px; }
.ec-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; max-width: 640px; margin: 0 auto; }
.ec-dow { text-align: center; font-weight: bold; font-size: 12px; padding: 2px 0; }
.ec-cell { position: relative; height: 46px; border: 1px solid #474747; background: #fff; }
.ec-cell.ec-empty { border-color: #e0e0e0; background: #fafafa; }
.ec-cell.ec-today { outline: 3px solid ${TODAY_OUTLINE}; outline-offset: 1px; z-index: 1; }
.ec-half { position: absolute; top: 0; bottom: 0; width: 50%; background: ${COLORS.noLeave}; }
.ec-half.ec-am { left: 0; }
.ec-half.ec-pm { right: 0; }
.ec-half.ec-clickable { cursor: pointer; }
.ec-half::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; }
#ec-root[data-active="AL"] .ec-half.ec-clickable:hover::after { background: ${TYPES.AL.hover}; }
#ec-root[data-active="TW"] .ec-half.ec-clickable:hover::after { background: ${TYPES.TW.hover}; }
#ec-root[data-active="CLEAR"] .ec-half.ec-clickable:hover::after { background: ${CLEAR_HOVER}; }
.ec-half.ec-user { box-shadow: inset 0 0 0 2px rgba(0,0,0,0.45); }
.ec-daynum {
  position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%);
  text-align: center; font-size: 12px; font-weight: bold; pointer-events: none;
  color: #000; text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff;
}
.ec-nav { display: flex; flex-direction: column; gap: 6px; min-width: 90px; }
.ec-btn {
  padding: 5px 12px; border: 1px solid #999; border-radius: 4px;
  background: #fff; cursor: pointer; font-size: 13px; color: #333;
}
.ec-btn:hover { background: #f0f0f0; }
.ec-apply-btn { background: #5cb85c; border-color: #4cae4c; color: #fff; font-weight: bold; }
.ec-apply-btn:hover { background: #449d44; }
.ec-summary { margin-top: 14px; border-top: 1px solid #ccc; padding-top: 10px; }
.ec-sum-title { font-weight: bold; margin-bottom: 4px; }
.ec-summary ul { margin: 4px 0 8px 20px; padding: 0; }
.ec-summary li { margin: 2px 0; }
.ec-totals { margin: 6px 0 10px 0; }
.ec-status { margin: 6px 0 10px 0; font-weight: bold; }
.ec-status-ok { color: #2e7d32; }
.ec-status-pending { color: #b26a00; }
.ec-diff { font-weight: bold; }
.ec-marker { color: #b26a00; }
.ec-strike { text-decoration: line-through; color: #8a2620; }
.ec-actions { display: flex; gap: 10px; }
.ec-banner { padding: 8px 12px; margin-bottom: 10px; border-radius: 4px; font-weight: bold; display: none; }
.ec-banner.ec-info { display: block; background: #e7f3fe; border: 1px solid #90bff0; color: #1b4c7a; }
.ec-banner.ec-error { display: block; background: #fdecea; border: 1px solid #f5b6ae; color: #8a2620; }
.ec-banner.ec-success { display: block; background: #e8f5e9; border: 1px solid #a5d6a7; color: #205723; }
.ec-banner a { color: inherit; text-decoration: underline; }
${colorRules}
`;
    const style = document.createElement('style');
    style.id = 'ec-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildSection(monthLabelText) {
    const tr = document.createElement('tr');
    tr.id = 'ec-section';
    tr.innerHTML =
      '<td colspan="2">' +
      '<table border="0" cellpadding="0" cellspacing="0" width="100%" class="ComponentGroup">' +
      '<tbody>' +
      '<tr><th class="tl"></th><th class="tm">Calendar selection</th><th class="tr"></th></tr>' +
      '<tr><td class="ml"></td><td class="mm">' +
      '<div id="ec-root" data-active="' + active + '">' +
      '<div class="ec-banner" id="ec-banner"></div>' +
      '<div class="ec-main">' +
      '<div class="ec-types">' +
      '<div class="ec-types-title">Paint with:</div>' +
      '<button type="button" class="ec-typebtn" data-ectype="AL"><span class="ec-sw" style="background:' + COLORS.annualLeave + '"></span>Annual leave</button>' +
      '<button type="button" class="ec-typebtn" data-ectype="TW"><span class="ec-sw" style="background:' + COLORS.teleworking + '"></span>Teleworking</button>' +
      '<button type="button" class="ec-typebtn" data-ectype="CLEAR"><span class="ec-sw" style="background:#ffffff"></span>Regular work (clear)</button>' +
      '</div>' +
      '<div class="ec-calwrap">' +
      '<div class="ec-monthlabel" id="ec-monthlabel"></div>' +
      '<div class="ec-grid" id="ec-grid"></div>' +
      '</div>' +
      '<div class="ec-nav">' +
      '<div class="ec-nav-title">Month:</div>' +
      '<button type="button" class="ec-btn" id="ec-prev" title="Previous month">&#9664; Prev</button>' +
      '<button type="button" class="ec-btn" id="ec-next" title="Next month">Next &#9654;</button>' +
      '<button type="button" class="ec-btn" id="ec-todaybtn" title="Go to today">Today</button>' +
      '</div>' +
      '</div>' +
      '<div class="ec-summary" id="ec-summary" style="display:none"></div>' +
      '</div>' +
      '</td><td class="mr"></td></tr>' +
      '<tr><td class="bl"></td><td class="bm"></td><td class="br"></td></tr>' +
      '</tbody></table>' +
      '</td>';

    const balanceRow = document.getElementById('LeftPane').closest('tr');
    balanceRow.after(tr);

    document.getElementById('ec-monthlabel').textContent = monthLabelText;

    // Type buttons
    const typeBtns = tr.querySelectorAll('.ec-typebtn');
    for (let i = 0; i < typeBtns.length; i++) {
      typeBtns[i].addEventListener('click', function () {
        setActiveType(this.getAttribute('data-ectype'));
      });
    }
    setActiveType(active); // highlight the restored choice

    // Month navigation - reuse the site's own functions so that BOTH
    // calendars move together (they trigger a page reload).
    document.getElementById('ec-prev').addEventListener('click', function () {
      if (window.prevMonth) window.prevMonth(); else window.cmd('prevMonth');
    });
    document.getElementById('ec-next').addEventListener('click', function () {
      if (window.nextMonth) window.nextMonth(); else window.cmd('nextMonth');
    });
    document.getElementById('ec-todaybtn').addEventListener('click', function () {
      if (window.gotoToday) window.gotoToday(); else window.cmd('gotoToday');
    });
  }

  function setActiveType(t) {
    active = t;
    saveJSON('active', active);
    const root = document.getElementById('ec-root');
    root.setAttribute('data-active', t);
    const btns = root.querySelectorAll('.ec-typebtn');
    for (let i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('ec-active', btns[i].getAttribute('data-ectype') === t);
    }
  }

  function emptyCell() {
    const d = document.createElement('div');
    d.className = 'ec-cell ec-empty';
    return d;
  }

  function renderCalendar() {
    const grid = document.getElementById('ec-grid');
    grid.textContent = '';
    const frag = document.createDocumentFragment();

    const dows = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    for (let i = 0; i < 7; i++) {
      const h = document.createElement('div');
      h.className = 'ec-dow';
      h.textContent = dows[i];
      frag.appendChild(h);
    }

    const y = cur.y, m = cur.m;
    const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday = 0
    const nDays = new Date(y, m, 0).getDate();
    const todayKey = keyFromDate(new Date());
    const monthBase = baseData[monthKey] || {};

    for (let i = 0; i < firstDow; i++) frag.appendChild(emptyCell());

    for (let day = 1; day <= nDays; day++) {
      const key = keyOf(y, m, day);
      const base = monthBase[String(day)] ||
        (isWeekendKey(key) ? ['holiday', 'holiday'] : ['noLeave', 'noLeave']);

      const cell = document.createElement('div');
      cell.className = 'ec-cell' + (key === todayKey ? ' ec-today' : '');

      const halves = [['am', base[0]], ['pm', base[1]]];
      for (let hI = 0; hI < 2; hI++) {
        const half = halves[hI][0];
        const baseCls = halves[hI][1];
        const userType = halfSel(key, half);
        const rowType = rowSelSnap[key] ? rowSelSnap[key][half] : undefined;
        const clickable = baseCls !== 'holiday';

        // Display precedence:
        //  1. user selection            -> its colour + marker
        //  2. row slot cleared by user  -> regular-work colour + marker
        //     (a pending change: without this, the Balance base colour would
        //     make the clear invisible)
        //  3. base colour from the Balance calendar
        let shownCls, marked;
        if (userType) { shownCls = TYPES[userType].cls; marked = true; }
        else if (rowType) { shownCls = 'noLeave'; marked = true; }
        else { shownCls = baseCls; marked = false; }

        const hEl = document.createElement('div');
        hEl.className = 'ec-half ec-' + half + ' ec-c-' + shownCls +
          (clickable ? ' ec-clickable' : '') + (marked ? ' ec-user' : '');
        if (clickable) {
          hEl.addEventListener('click', onHalfClick.bind(null, key, half));
        }
        cell.appendChild(hEl);
      }

      const num = document.createElement('span');
      num.className = 'ec-daynum';
      num.textContent = day;
      cell.appendChild(num);

      frag.appendChild(cell);
    }

    const total = firstDow + nDays;
    const trailing = (7 - (total % 7)) % 7;
    for (let i = 0; i < trailing; i++) frag.appendChild(emptyCell());

    grid.appendChild(frag);
  }

  function fmtDays(d) {
    return d + ' day' + (d === 1 ? '' : 's');
  }

  function describePeriod(p) {
    let range;
    if (p.startDate === p.endDate) {
      const part = (p.startHalf === 'am' && p.endHalf === 'pm') ? 'full day'
        : (p.startHalf === 'am' ? 'morning' : 'afternoon');
      range = fmtDMY(p.startDate) + ' (' + part + ')';
    } else {
      const from = p.startHalf === 'pm' ? ' (from 13:30)' : '';
      const until = p.endHalf === 'am' ? ' (until 12:30)' : '';
      range = fmtDMY(p.startDate) + from + ' → ' + fmtDMY(p.endDate) + until;
    }
    return TYPES[p.type].name + ': ' + range + ' — ' + fmtDays(p.halves / 2);
  }

  function renderSummary() {
    const box = document.getElementById('ec-summary');
    if (!box) return;
    const periods = computePeriods(sel);
    const rec = applying ? null : computeReconciliation(periods);
    const inSync = rec !== null && reconciliationIsNoop(rec);

    // Nothing selected and nothing out of sync -> nothing to show.
    if (!periods.length && (applying || inSync)) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    box.style.display = '';

    let html = '';

    // List items: every selected period, marked (new)/(changed) when it
    // differs from the existing rows, plus struck-through (removed) entries
    // for rows that Apply would delete.
    const items = periods.map(function (p) {
      let marker = '';
      if (rec) {
        if (rec.toCreate.indexOf(p) !== -1) marker = 'new';
        else if (rec.toRepair.some(function (r) { return r.period === p; })) marker = 'changed';
      }
      return '<li' + (marker ? ' class="ec-diff"' : '') + '>' + describePeriod(p) +
        (marker ? ' <span class="ec-marker">(' + marker + ')</span>' : '') + '</li>';
    });
    if (rec) {
      rec.toDelete.forEach(function (i) {
        const v = rowVals(i);
        if (!v) return;
        const tk = typeKeyOf(v.type);
        const name = tk ? TYPES[tk].name : 'Absence';
        let range = v.sd;
        if (normDate(v.sd) !== normDate(v.ed)) range += ' → ' + v.ed;
        items.push('<li class="ec-diff"><span class="ec-strike">' + name + ': ' + range + '</span>' +
          ' <span class="ec-marker">(removed)</span></li>');
      });
    }

    if (periods.length) {
      const totals = {};
      periods.forEach(function (p) { totals[p.type] = (totals[p.type] || 0) + p.halves / 2; });
      const totalStr = Object.keys(totals).map(function (t) {
        return TYPES[t].name + ': <b>' + fmtDays(totals[t]) + '</b>';
      }).join(' &nbsp;&bull;&nbsp; ');

      html +=
        '<div class="ec-sum-title">Selected absence periods</div>' +
        '<ul>' + items.join('') + '</ul>' +
        '<div class="ec-totals">Total — ' + totalStr + '</div>';
    } else {
      html += '<div class="ec-sum-title">No half-days selected</div>';
      if (items.length) html += '<ul>' + items.join('') + '</ul>';
    }

    if (applying) {
      box.innerHTML = html;
      return;
    }

    if (inSync) {
      html += '<div class="ec-status ec-status-ok">&#10003; In sync with the "Absence periods" rows below.</div>';
      box.innerHTML = html;
      return;
    }

    const parts = [];
    if (rec.toCreate.length) parts.push(rec.toCreate.length + ' new period(s)');
    if (rec.toRepair.length) parts.push(rec.toRepair.length + ' time fix(es)');
    if (rec.toDelete.length) parts.push(rec.toDelete.length + ' row deletion(s)');
    html +=
      '<div class="ec-status ec-status-pending">Pending changes: ' + parts.join(', ') + '</div>' +
      '<div class="ec-actions">' +
      '<button type="button" id="ec-apply" class="ec-btn ec-apply-btn">Apply to "Absence periods"</button>' +
      '<button type="button" id="ec-revert" class="ec-btn">Revert changes</button>' +
      '</div>';
    box.innerHTML = html;

    box.querySelector('#ec-apply').addEventListener('click', startApply);
    box.querySelector('#ec-revert').addEventListener('click', function () {
      rowSelSnap = deriveRowSel();
      saveJSON('rowsel', rowSelSnap);
      sel = sanitizeSel(JSON.parse(JSON.stringify(rowSelSnap)));
      saveJSON('sel', sel);
      renderCalendar();
      renderSummary();
    });
  }

  function showBanner(kind, html) {
    const b = document.getElementById('ec-banner');
    if (!b) return;
    b.className = 'ec-banner ec-' + kind;
    b.innerHTML = html;
  }

  function hideBanner() {
    const b = document.getElementById('ec-banner');
    if (!b) return;
    b.className = 'ec-banner'; // display:none via CSS
    b.innerHTML = '';
  }

  function showApplyBanner(state) {
    showBanner('info',
      'Applying calendar selection — step ' + state.step +
      ' (the page reloads after each step, please wait…) ' +
      '<a href="#" id="ec-cancel">cancel</a>');
    const c = document.getElementById('ec-cancel');
    if (c) {
      c.addEventListener('click', function (e) {
        e.preventDefault();
        delKey('apply');
        applying = false;
        rowSelSnap = deriveRowSel(); // snapshot whatever state the rows are in
        saveJSON('rowsel', rowSelSnap);
        showBanner('info', 'Apply cancelled. Changes already made to the rows remain.');
        renderCalendar();
        renderSummary();
      });
    }
  }

  /* ------------------------------------------------------------------ *
   *  Init                                                              *
   * ------------------------------------------------------------------ */

  function init() {
    if (window.self !== window.top) return; // never inside EDH modal iframes

    form = document.forms.MainForm;
    if (!form || !form.elements.command) return;
    if (typeof window.UIDType !== 'undefined' && window.UIDType !== 'LVRQ') return;
    if (typeof window.isPrintView !== 'undefined' && window.isPrintView === 'true') return;

    const monthSpan = document.getElementById('month');
    const srcCal = document.getElementById('calendar');
    const leftPane = document.getElementById('LeftPane');
    if (!monthSpan || !srcCal || !leftPane) return;

    // Editable-document check. IMPORTANT: EDH can render the form with ZERO
    // absence rows (right after the last row is deleted), so the presence of
    // LeaveType.0 alone is NOT a reliable trigger - also accept the
    // "add a new period" link, which exists in edit mode even with no rows.
    const canEdit = !!form.elements['LeaveType.0'] ||
      !!document.querySelector('a[href^="javascript:AddLine"]');
    if (!canEdit) return; // read-only / signed document

    if (document.getElementById('ec-section')) return; // already built

    const mm = monthSpan.textContent.match(/(\d{1,2})\.(\d{4})/);
    if (!mm) return;
    cur = { m: Number(mm[1]), y: Number(mm[2]) };
    monthKey = cur.y + '-' + pad2(cur.m);

    // Keyed by pathname, NOT by objid: the objid looks like a per-response
    // server handle and might change between the form's self-POST reloads,
    // which would wipe the selection (and break the Apply machine) on every
    // step. The pathname is stable across those reloads.
    NS = 'edhCalExt:' + location.pathname;

    baseData = loadJSON('base', {});
    active = loadJSON('active', 'AL');
    if (!TYPES[active] && active !== 'CLEAR') active = 'AL';

    // (Re-)scrape the displayed month's base colouring on every load
    // (must happen before deriveRowSel - it needs holiday knowledge).
    baseData[monthKey] = scrapeBase(srcCal);
    saveJSON('base', baseData);

    // Two-way sync: fold the current "Absence periods" rows into the
    // selection. Skipped while an Apply machine is mid-flight (the rows are
    // in a transient state then).
    const pendingApply = loadJSON('apply', null);
    if (pendingApply) {
      // Mid-apply: rows are transient, keep the last stable snapshot.
      sel = loadJSON('sel', {});
      rowSelSnap = loadJSON('rowsel', {});
    } else {
      const newRowSel = deriveRowSel();
      const oldRowSel = loadJSON('rowsel', null);
      const storedSel = loadJSON('sel', null);
      if (storedSel === null) {
        sel = JSON.parse(JSON.stringify(newRowSel)); // first visit: adopt the rows
      } else {
        sel = threeWayMerge(oldRowSel || {}, storedSel, newRowSel);
      }
      sanitizeSel(sel);
      rowSelSnap = newRowSel;
      saveJSON('rowsel', rowSelSnap);
      saveJSON('sel', sel);
    }

    injectCSS();
    buildSection(monthSpan.textContent.trim());
    renderCalendar();

    if (pendingApply) {
      applying = true;
      showApplyBanner(pendingApply);
    }
    renderSummary();
    if (pendingApply) {
      // Small delay so the banner is painted before we possibly navigate away.
      setTimeout(function () { runApplyStep(pendingApply); }, 250);
    }
  }

  try {
    init();
  } catch (e) {
    // Never break the underlying EDH page.
    if (window.console && console.error) console.error('[edh-absence-calendar]', e);
  }
})();
