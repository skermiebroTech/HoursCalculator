(function () {
  'use strict';

  // ------------------------------------------------------------------ config

  var STORAGE_KEY = 'hoursCalculator.v1';
  var DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DEFAULT_BREAK_MIN = 30;
  var MINUTES_PER_DAY = 24 * 60;

  // Common one-tap times (24h internal values). Labels shown on the chips are
  // derived from these with formatCompactTime, so they always match the output.
  var START_PRESETS = ['07:00', '07:30', '08:00', '08:30'];
  var FINISH_PRESETS = ['15:00', '15:30', '16:00', '16:30'];

  // ------------------------------------------------------------------- state

  function defaultDay(index) {
    return { enabled: index < 5, start: '', finish: '', breakMin: DEFAULT_BREAK_MIN };
  }

  function defaultWeek() {
    return { days: DAY_NAMES.map(function (_, i) { return defaultDay(i); }) };
  }

  var DEFAULT_WEEK_JSON = JSON.stringify(defaultWeek());

  function sanitizeDay(raw, index) {
    var day = defaultDay(index);
    if (raw && typeof raw === 'object') {
      if (typeof raw.enabled === 'boolean') day.enabled = raw.enabled;
      if (typeof raw.start === 'string' && /^\d{2}:\d{2}$/.test(raw.start)) day.start = raw.start;
      if (typeof raw.finish === 'string' && /^\d{2}:\d{2}$/.test(raw.finish)) day.finish = raw.finish;
      if (raw.breakMin === '' || (typeof raw.breakMin === 'number' && isFinite(raw.breakMin))) {
        day.breakMin = raw.breakMin;
      }
    }
    return day;
  }

  function sanitizeWeek(raw) {
    var week = defaultWeek();
    if (raw && typeof raw === 'object' && Array.isArray(raw.days)) {
      week.days = week.days.map(function (fallback, i) { return sanitizeDay(raw.days[i], i); });
    }
    return week;
  }

  function loadState() {
    var state = { weeks: {}, selectedWeek: null, theme: null };
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && typeof raw === 'object') {
        if (raw.weeks && typeof raw.weeks === 'object') {
          Object.keys(raw.weeks).forEach(function (key) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(key)) state.weeks[key] = sanitizeWeek(raw.weeks[key]);
          });
        }
        if (typeof raw.selectedWeek === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.selectedWeek)) {
          state.selectedWeek = raw.selectedWeek;
        }
        if (raw.theme === 'light' || raw.theme === 'dark') state.theme = raw.theme;
      }
    } catch (e) { /* corrupt or unavailable storage — start fresh */ }
    return state;
  }

  // Only weeks the user has actually filled in — skips untouched default weeks.
  function savedWeeksObject() {
    var weeks = {};
    Object.keys(state.weeks).forEach(function (key) {
      if (JSON.stringify(state.weeks[key]) !== DEFAULT_WEEK_JSON) weeks[key] = state.weeks[key];
    });
    return weeks;
  }

  function saveState() {
    var out = { weeks: savedWeeksObject(), selectedWeek: state.selectedWeek, theme: state.theme };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch (e) { /* private mode / quota — app still works, just won't persist */ }
  }

  var state = loadState();

  // -------------------------------------------------------------- date utils

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function toISODate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseISODate(iso) {
    var parts = iso.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function addDays(d, n) {
    var copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
  }

  function mondayOf(d) {
    return addDays(d, -((d.getDay() + 6) % 7));
  }

  function formatWeekRange(iso) {
    var mon = parseISODate(iso);
    var sun = addDays(mon, 6);
    var opts = { weekday: 'short', day: 'numeric', month: 'short' };
    return mon.toLocaleDateString(undefined, opts) + ' – ' +
      sun.toLocaleDateString(undefined, opts) + ', ' + sun.getFullYear();
  }

  // ------------------------------------------------------------ calculations

  function timeToMinutes(hhmm) {
    var parts = hhmm.split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  // "HH:MM" (24h) -> compact 12h format with no colon or AM/PM: 08:00 -> "800",
  // 09:30 -> "930", 15:00 -> "300", 00:15 -> "1215".
  function formatCompactTime(hhmm) {
    var parts = hhmm.split(':');
    var hour = Number(parts[0]) % 12;
    if (hour === 0) hour = 12;
    return String(hour) + parts[1];
  }

  // "HH:MM" (24h) -> spoken 12h time for accessible labels: 07:30 -> "7:30 AM".
  function formatSpokenTime(hhmm) {
    var parts = hhmm.split(':');
    var h = Number(parts[0]);
    var suffix = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ':' + parts[1] + ' ' + suffix;
  }

  // Minutes -> "7h", "6.5h", "6.25h" (up to 2 decimals, trailing zeros trimmed).
  function formatHours(minutes) {
    return String(parseFloat((minutes / 60).toFixed(2))) + 'h';
  }

  // Evaluate one day. status: 'disabled' | 'empty' | 'error' | 'ok'
  function computeDay(day) {
    if (!day.enabled) return { status: 'disabled' };
    if (!day.start && !day.finish) return { status: 'empty' };
    if (!day.start || !day.finish) {
      return { status: 'error', error: 'Enter both a start and a finish time.' };
    }

    var start = timeToMinutes(day.start);
    var finish = timeToMinutes(day.finish);
    if (start === finish) {
      return { status: 'error', error: 'Start and finish times are the same.' };
    }
    var shift = finish - start;
    if (shift < 0) shift += MINUTES_PER_DAY; // shift runs past midnight

    var breakMin = day.breakMin === '' ? 0 : Number(day.breakMin);
    if (!isFinite(breakMin) || breakMin < 0) {
      return { status: 'error', error: 'Break must be 0 or more minutes.' };
    }
    if (breakMin >= shift) {
      return {
        status: 'error',
        error: 'Break (' + breakMin + ' min) leaves no paid time in this shift.'
      };
    }

    return { status: 'ok', paidMinutes: shift - breakMin };
  }

  // Build the copyable output for the selected week.
  function buildOutput(week) {
    var lines = [];
    var totalMinutes = 0;
    var errorCount = 0;

    week.days.forEach(function (day, i) {
      var result = computeDay(day);
      if (result.status === 'ok') {
        lines.push(DAY_NAMES[i] + ' ' + formatCompactTime(day.start) + '-' +
          formatCompactTime(day.finish) + ' ' + formatHours(result.paidMinutes));
        totalMinutes += result.paidMinutes;
      } else if (result.status === 'error') {
        errorCount += 1;
      }
    });

    var text = lines.length ? lines.join('\n') + '\ntotal ' + formatHours(totalMinutes) : '';
    return { text: text, lineCount: lines.length, errorCount: errorCount };
  }

  // ---------------------------------------------------------------- elements

  var daysList = document.getElementById('daysList');
  var weekPicker = document.getElementById('weekPicker');
  var weekLabel = document.getElementById('weekLabel');
  var prevWeekBtn = document.getElementById('prevWeekBtn');
  var nextWeekBtn = document.getElementById('nextWeekBtn');
  var previewEl = document.getElementById('preview');
  var previewNote = document.getElementById('previewNote');
  var copyBtn = document.getElementById('copyBtn');
  var clearBtn = document.getElementById('clearBtn');
  var duplicateBtn = document.getElementById('duplicateBtn');
  var restoreBtn = document.getElementById('restoreBtn');
  var exportBtn = document.getElementById('exportBtn');
  var importBtn = document.getElementById('importBtn');
  var importInput = document.getElementById('importInput');
  var themeToggle = document.getElementById('themeToggle');
  var toastEl = document.getElementById('toast');
  var themeColorMeta = document.querySelector('meta[name="theme-color"]');

  var rows = []; // per-day element refs, built once in buildRows()

  // ---------------------------------------------------------------- week ops

  function currentWeek() {
    if (!state.weeks[state.selectedWeek]) state.weeks[state.selectedWeek] = defaultWeek();
    return state.weeks[state.selectedWeek];
  }

  function weekHasEntries(week) {
    return week.days.some(function (d) { return d.start !== '' || d.finish !== ''; });
  }

  // ------------------------------------------------------------------- toast

  var toastTimer = null;
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  // ------------------------------------------------------------------- theme

  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function activeTheme() {
    return state.theme || (darkQuery.matches ? 'dark' : 'light');
  }

  function applyTheme() {
    var theme = activeTheme();
    document.documentElement.dataset.theme = theme;
    themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    themeToggle.setAttribute('aria-label',
      theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    if (themeColorMeta) themeColorMeta.content = theme === 'dark' ? '#0e1320' : '#2563eb';
  }

  // --------------------------------------------------------------- rendering

  // Fill a chip container with one-tap preset buttons for a start/finish field.
  function buildChips(container, presets, target, dayIndex, dayName, row) {
    presets.forEach(function (value) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = formatCompactTime(value);
      btn.dataset.value = value;
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label',
        'Set ' + dayName + ' ' + target + ' to ' + formatSpokenTime(value));
      btn.addEventListener('click', function () {
        var day = currentWeek().days[dayIndex];
        day[target] = value;
        row[target].value = value;
        refresh();
      });
      container.appendChild(btn);
      row.chips[target].push(btn);
    });
  }

  function buildRows() {
    DAY_NAMES.forEach(function (name, i) {
      var li = document.createElement('li');
      li.className = 'day-card';
      li.innerHTML =
        '<div class="day-head">' +
          '<label class="day-toggle">' +
            '<input type="checkbox" aria-label="Include ' + name + '">' +
            '<span><span class="day-name">' + name + '</span> ' +
            '<span class="day-date"></span></span>' +
          '</label>' +
          '<span class="day-hours">—</span>' +
        '</div>' +
        '<div class="day-fields">' +
          '<label class="field"><span>Start</span>' +
            '<input type="time" autocomplete="off"></label>' +
          '<label class="field"><span>Finish</span>' +
            '<input type="time" autocomplete="off"></label>' +
          '<label class="field"><span>Break min</span>' +
            '<input type="number" inputmode="numeric" min="0" step="5" autocomplete="off"></label>' +
        '</div>' +
        '<div class="quick-picks">' +
          '<div class="quick-row"><span class="quick-label" aria-hidden="true">Start</span>' +
            '<div class="chips" data-chips="start" role="group" ' +
              'aria-label="Quick start times for ' + name + '"></div></div>' +
          '<div class="quick-row"><span class="quick-label" aria-hidden="true">Finish</span>' +
            '<div class="chips" data-chips="finish" role="group" ' +
              'aria-label="Quick finish times for ' + name + '"></div></div>' +
        '</div>' +
        '<p class="day-error" id="dayError' + i + '" hidden></p>';
      daysList.appendChild(li);

      var inputs = li.querySelectorAll('input');
      var row = {
        card: li,
        enabled: inputs[0],
        start: inputs[1],
        finish: inputs[2],
        breakMin: inputs[3],
        date: li.querySelector('.day-date'),
        hours: li.querySelector('.day-hours'),
        error: li.querySelector('.day-error'),
        chips: { start: [], finish: [] }
      };
      row.start.setAttribute('aria-label', name + ' start time');
      row.finish.setAttribute('aria-label', name + ' finish time');
      row.breakMin.setAttribute('aria-label', name + ' unpaid break in minutes');
      [row.start, row.finish, row.breakMin].forEach(function (input) {
        input.setAttribute('aria-describedby', 'dayError' + i);
      });
      buildChips(li.querySelector('[data-chips="start"]'), START_PRESETS, 'start', i, name, row);
      buildChips(li.querySelector('[data-chips="finish"]'), FINISH_PRESETS, 'finish', i, name, row);
      rows.push(row);

      row.enabled.addEventListener('change', function () {
        currentWeek().days[i].enabled = row.enabled.checked;
        refresh();
      });
      row.start.addEventListener('input', function () {
        currentWeek().days[i].start = row.start.value;
        refresh();
      });
      row.finish.addEventListener('input', function () {
        currentWeek().days[i].finish = row.finish.value;
        refresh();
      });
      row.breakMin.addEventListener('input', function () {
        var value = row.breakMin.value;
        currentWeek().days[i].breakMin = value === '' ? '' : Number(value);
        refresh();
      });
    });
  }

  // Push state values into the inputs (used on load and week switch).
  function fillRowsFromState() {
    var week = currentWeek();
    var monday = parseISODate(state.selectedWeek);
    var dateOpts = { day: 'numeric', month: 'short' };
    rows.forEach(function (row, i) {
      var day = week.days[i];
      row.enabled.checked = day.enabled;
      row.start.value = day.start;
      row.finish.value = day.finish;
      row.breakMin.value = day.breakMin === '' ? '' : String(day.breakMin);
      row.date.textContent = addDays(monday, i).toLocaleDateString(undefined, dateOpts);
    });
  }

  // Recompute chips, per-day errors, preview and copy button from state.
  function refresh() {
    var week = currentWeek();

    week.days.forEach(function (day, i) {
      var row = rows[i];
      var result = computeDay(day);
      var isError = result.status === 'error';

      row.card.classList.toggle('is-disabled', !day.enabled);
      [row.start, row.finish, row.breakMin].forEach(function (input) {
        input.disabled = !day.enabled;
        input.classList.toggle('invalid', isError);
        if (isError) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      });

      ['start', 'finish'].forEach(function (target) {
        row.chips[target].forEach(function (chip) {
          var selected = day[target] === chip.dataset.value;
          chip.classList.toggle('active', selected);
          chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
          chip.disabled = !day.enabled;
        });
      });

      row.error.hidden = !isError;
      row.error.textContent = isError ? result.error : '';

      row.hours.classList.toggle('is-error', isError);
      row.hours.classList.toggle('is-off', result.status !== 'ok' && !isError);
      if (result.status === 'ok') row.hours.textContent = formatHours(result.paidMinutes);
      else if (result.status === 'disabled') row.hours.textContent = 'Off';
      else if (isError) row.hours.textContent = '!';
      else row.hours.textContent = '—';
    });

    var output = buildOutput(week);
    if (output.text) {
      previewEl.textContent = output.text;
      previewEl.classList.remove('is-empty');
    } else {
      previewEl.textContent = 'Enter start and finish times above and your formatted week will appear here.';
      previewEl.classList.add('is-empty');
    }

    previewNote.hidden = output.errorCount === 0;
    previewNote.textContent = output.errorCount === 0 ? '' :
      output.errorCount + (output.errorCount === 1 ? ' day has a problem' : ' days have problems') +
      ' and won’t be included until fixed.';

    copyBtn.disabled = output.lineCount === 0;
    saveState();
  }

  function setWeek(iso) {
    state.selectedWeek = iso;
    weekPicker.value = iso;
    weekLabel.textContent = formatWeekRange(iso);
    fillRowsFromState();
    refresh();
  }

  // ----------------------------------------------------------------- actions

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (e) {
        reject(e);
      } finally {
        ta.remove();
      }
    });
  }

  copyBtn.addEventListener('click', function () {
    var output = buildOutput(currentWeek());
    if (!output.text) return;
    copyText(output.text).then(function () {
      showToast('Copied ✓ ready to paste');
      copyBtn.textContent = 'Copied ✓';
      setTimeout(function () { copyBtn.textContent = 'Copy Hours'; }, 1800);
    }).catch(function () {
      showToast('Couldn’t copy automatically — long-press the preview to copy.');
    });
  });

  clearBtn.addEventListener('click', function () {
    if (weekHasEntries(currentWeek()) &&
        !window.confirm('Clear all times for this week?')) return;
    state.weeks[state.selectedWeek] = defaultWeek();
    fillRowsFromState();
    refresh();
    showToast('Week cleared');
  });

  duplicateBtn.addEventListener('click', function () {
    var prevISO = toISODate(addDays(parseISODate(state.selectedWeek), -7));
    var prevWeek = state.weeks[prevISO];
    if (!prevWeek || !weekHasEntries(prevWeek)) {
      showToast('No hours saved for last week');
      return;
    }
    if (weekHasEntries(currentWeek()) &&
        !window.confirm('Replace this week’s times with last week’s?')) return;
    state.weeks[state.selectedWeek] = JSON.parse(JSON.stringify(prevWeek));
    fillRowsFromState();
    refresh();
    showToast('Copied last week’s times');
  });

  restoreBtn.addEventListener('click', function () {
    currentWeek().days.forEach(function (day, i) { day.enabled = i < 5; });
    fillRowsFromState();
    refresh();
    showToast('Mon–Fri schedule restored');
  });

  function pluralWeeks(n) { return n + (n === 1 ? ' week' : ' weeks'); }

  // Download every saved week as a JSON file for backup or transfer.
  function exportBackup() {
    var weeks = savedWeeksObject();
    var count = Object.keys(weeks).length;
    if (!count) {
      showToast('No hours saved yet to export');
      return;
    }
    var payload = {
      app: 'weekly-hours',
      version: 1,
      exportedAt: new Date().toISOString(),
      weeks: weeks
    };
    var url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'weekly-hours-backup-' + toISODate(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('Exported ' + pluralWeeks(count));
  }

  // Read a previously exported file and merge its weeks into the current data.
  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var raw;
      try { raw = JSON.parse(reader.result); }
      catch (e) { showToast('That file isn’t a valid backup'); return; }
      if (!raw || typeof raw !== 'object' || !raw.weeks || typeof raw.weeks !== 'object') {
        showToast('That file isn’t a valid backup');
        return;
      }

      var incoming = {};
      Object.keys(raw.weeks).forEach(function (key) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
        var week = sanitizeWeek(raw.weeks[key]);
        if (weekHasEntries(week)) incoming[key] = week;
      });

      var keys = Object.keys(incoming).sort();
      if (!keys.length) {
        showToast('No hours found in that file');
        return;
      }
      if (!window.confirm('Import ' + pluralWeeks(keys.length) +
          ' from this backup? Weeks with the same dates will be replaced.')) return;

      keys.forEach(function (key) { state.weeks[key] = incoming[key]; });
      setWeek(keys[keys.length - 1]); // jump to the latest imported week so it's visible
      showToast('Imported ' + pluralWeeks(keys.length));
    };
    reader.onerror = function () { showToast('Couldn’t read that file'); };
    reader.readAsText(file);
  }

  exportBtn.addEventListener('click', exportBackup);
  importBtn.addEventListener('click', function () { importInput.click(); });
  importInput.addEventListener('change', function () {
    if (importInput.files && importInput.files[0]) importBackup(importInput.files[0]);
    importInput.value = ''; // let the same file be chosen again later
  });

  prevWeekBtn.addEventListener('click', function () {
    setWeek(toISODate(addDays(parseISODate(state.selectedWeek), -7)));
  });

  nextWeekBtn.addEventListener('click', function () {
    setWeek(toISODate(addDays(parseISODate(state.selectedWeek), 7)));
  });

  weekPicker.addEventListener('change', function () {
    if (!weekPicker.value) {
      weekPicker.value = state.selectedWeek; // ignore cleared picker
      return;
    }
    setWeek(toISODate(mondayOf(parseISODate(weekPicker.value))));
  });

  themeToggle.addEventListener('click', function () {
    state.theme = activeTheme() === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveState();
  });

  if (darkQuery.addEventListener) {
    darkQuery.addEventListener('change', function () {
      if (!state.theme) applyTheme(); // follow the system until user picks one
    });
  }

  // -------------------------------------------------------------------- init

  buildRows();
  applyTheme();
  setWeek(state.selectedWeek || toISODate(mondayOf(new Date())));

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () {
        /* e.g. running from file:// — the app works fine without offline support */
      });
    });
  }
})();
