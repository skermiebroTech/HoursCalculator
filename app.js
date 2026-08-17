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

  var AU_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

  // ------------------------------------------------------------------- state

  function defaultDay(index) {
    return { enabled: index < 5, start: '', finish: '', breakMin: DEFAULT_BREAK_MIN };
  }

  function defaultWeek() {
    return { days: DAY_NAMES.map(function (_, i) { return defaultDay(i); }) };
  }

  var DEFAULT_WEEK_JSON = JSON.stringify(defaultWeek().days);

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
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.days)) {
        week.days = week.days.map(function (fallback, i) { return sanitizeDay(raw.days[i], i); });
      }
      // "mod" is a last-modified timestamp used by sync to pick the newer copy.
      if (typeof raw.mod === 'number' && isFinite(raw.mod)) week.mod = raw.mod;
    }
    return week;
  }

  function sanitizeCar(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.plate !== 'string' || !raw.plate.trim()) return null;
    var car = { plate: raw.plate.trim().toUpperCase(), type: '', state: 'QLD', economy: null, tank: null };
    if (typeof raw.type === 'string') car.type = raw.type.trim();
    if (AU_STATES.indexOf(raw.state) !== -1) car.state = raw.state;
    if (typeof raw.economy === 'number' && isFinite(raw.economy) && raw.economy > 0) {
      car.economy = raw.economy;
    }
    if (typeof raw.tank === 'number' && isFinite(raw.tank) && raw.tank > 0) {
      car.tank = raw.tank;
    }
    if (typeof raw.mod === 'number' && isFinite(raw.mod)) car.mod = raw.mod;
    return car;
  }

  function sanitizeFill(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.car !== 'string' || !raw.car) return null;
    if (typeof raw.odo !== 'number' || !isFinite(raw.odo) || raw.odo < 0) return null;
    if (typeof raw.litres !== 'number' || !isFinite(raw.litres) || raw.litres <= 0) return null;
    var mod = (typeof raw.mod === 'number' && isFinite(raw.mod)) ? raw.mod : undefined;
    return {
      mod: mod,
      id: typeof raw.id === 'string' ? raw.id : String(Math.random()).slice(2),
      car: raw.car.trim().toUpperCase(),
      date: (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) ? raw.date : '',
      odo: raw.odo,
      litres: raw.litres,
      cost: (typeof raw.cost === 'number' && isFinite(raw.cost) && raw.cost >= 0) ? raw.cost : 0,
      fromEmpty: raw.fromEmpty === true,
      toFull: raw.toFull === true
    };
  }

  function sanitizeFuel(raw) {
    var fuel = { cars: [], fills: [], selectedCar: null, lookups: {} };
    if (raw && typeof raw === 'object' && raw.lookups && typeof raw.lookups === 'object') {
      Object.keys(raw.lookups).forEach(function (key) {
        if (typeof raw.lookups[key] === 'string') fuel.lookups[key] = raw.lookups[key];
      });
    }
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.cars)) {
        raw.cars.forEach(function (c) {
          var car = sanitizeCar(c);
          if (car && !fuel.cars.some(function (x) { return x.plate === car.plate; })) {
            fuel.cars.push(car);
          }
        });
      }
      if (Array.isArray(raw.fills)) {
        raw.fills.forEach(function (f) {
          var fill = sanitizeFill(f);
          if (fill) fuel.fills.push(fill);
        });
      }
      if (typeof raw.selectedCar === 'string') fuel.selectedCar = raw.selectedCar;
    }
    if (!fuel.cars.some(function (c) { return c.plate === fuel.selectedCar; })) {
      fuel.selectedCar = fuel.cars.length ? fuel.cars[0].plate : null;
    }
    return fuel;
  }

  // Tombstones: timestamps of deletions, so sync removes entities on other
  // devices instead of resurrecting them. An entity edited after its
  // tombstone (mod > timestamp) survives.
  function sanitizeDeleted(raw) {
    var out = { weeks: {}, cars: {}, fills: {} };
    if (raw && typeof raw === 'object') {
      Object.keys(out).forEach(function (kind) {
        if (raw[kind] && typeof raw[kind] === 'object') {
          Object.keys(raw[kind]).forEach(function (key) {
            if (typeof raw[kind][key] === 'number' && isFinite(raw[kind][key])) {
              out[kind][key] = raw[kind][key];
            }
          });
        }
      });
    }
    return out;
  }

  function loadState() {
    var state = {
      weeks: {}, selectedWeek: null, theme: null, activeTab: 'hours',
      fuel: sanitizeFuel(null), syncCode: null, lastSyncAt: null,
      deleted: sanitizeDeleted(null)
    };
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
        if (raw.activeTab === 'fuel' || raw.activeTab === 'backup') state.activeTab = raw.activeTab;
        state.fuel = sanitizeFuel(raw.fuel);
        if (typeof raw.syncCode === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(raw.syncCode)) {
          state.syncCode = raw.syncCode;
        }
        if (typeof raw.lastSyncAt === 'number' && isFinite(raw.lastSyncAt)) {
          state.lastSyncAt = raw.lastSyncAt;
        }
        state.deleted = sanitizeDeleted(raw.deleted);
      }
    } catch (e) { /* corrupt or unavailable storage — start fresh */ }
    return state;
  }

  // Only weeks the user has actually filled in — skips untouched default weeks.
  function savedWeeksObject() {
    var weeks = {};
    Object.keys(state.weeks).forEach(function (key) {
      if (JSON.stringify(state.weeks[key].days) !== DEFAULT_WEEK_JSON) weeks[key] = state.weeks[key];
    });
    return weeks;
  }

  // Stamp a week's "mod" whenever its day data changes between saves, so sync
  // can tell which device edited it most recently.
  var lastSavedDays = {};

  function stampChangedWeeks() {
    Object.keys(state.weeks).forEach(function (key) {
      var daysJson = JSON.stringify(state.weeks[key].days);
      var prev = lastSavedDays[key];
      if (prev === undefined ? daysJson !== DEFAULT_WEEK_JSON : prev !== daysJson) {
        state.weeks[key].mod = Date.now();
      }
      lastSavedDays[key] = daysJson;
    });
  }

  function saveState() {
    stampChangedWeeks();
    var out = {
      weeks: savedWeeksObject(),
      selectedWeek: state.selectedWeek,
      theme: state.theme,
      activeTab: state.activeTab,
      fuel: state.fuel,
      syncCode: state.syncCode,
      lastSyncAt: state.lastSyncAt,
      deleted: state.deleted
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch (e) { /* private mode / quota — app still works, just won't persist */ }
  }

  var state = loadState();
  Object.keys(state.weeks).forEach(function (key) {
    lastSavedDays[key] = JSON.stringify(state.weeks[key].days);
  });

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
  var exportHoursBtn = document.getElementById('exportHoursBtn');
  var exportFuelBtn = document.getElementById('exportFuelBtn');
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
    state.deleted.weeks[state.selectedWeek] = Date.now();
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

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function pluralWeeks(n) { return plural(n, 'week'); }

  // "3 weeks of hours, 2 cars, 12 fill-ups" — empty when there is nothing at all.
  function describeData(weekCount, carCount, fillCount) {
    var parts = [];
    if (weekCount) parts.push(pluralWeeks(weekCount) + ' of hours');
    if (carCount) parts.push(plural(carCount, 'car'));
    if (fillCount) parts.push(plural(fillCount, 'fill-up'));
    return parts.join(', ');
  }

  var NOTHING_TO_EXPORT = {
    hours: 'No hours saved yet to export',
    fuel: 'No fuel data saved yet to export',
    all: 'Nothing saved yet to export'
  };

  // Download saved data as a JSON file for backup or transfer. The scope picks
  // hours only, fuel only, or everything; import accepts any of the three.
  function exportData(scope) {
    var weeks = scope === 'fuel' ? {} : savedWeeksObject();
    var cars = scope === 'hours' ? [] : state.fuel.cars;
    var fills = scope === 'hours' ? [] : state.fuel.fills;
    var summary = describeData(Object.keys(weeks).length, cars.length, fills.length);
    if (!summary) {
      showToast(NOTHING_TO_EXPORT[scope]);
      return;
    }
    var payload = {
      app: 'weekly-hours',
      version: 2,
      scope: scope,
      exportedAt: new Date().toISOString(),
      weeks: weeks,
      fuel: { cars: cars, fills: fills }
    };
    var url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'weekly-hours-' + (scope === 'all' ? 'backup' : scope) + '-' +
      toISODate(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('Exported ' + summary);
  }

  // Read a previously exported file and merge its weeks into the current data.
  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var raw;
      try { raw = JSON.parse(reader.result); }
      catch (e) { showToast('That file isn’t a valid backup'); return; }
      var hasWeeks = raw && raw.weeks && typeof raw.weeks === 'object';
      var hasFuel = raw && raw.fuel && typeof raw.fuel === 'object';
      if (!raw || typeof raw !== 'object' || (!hasWeeks && !hasFuel)) {
        showToast('That file isn’t a valid backup');
        return;
      }

      var incoming = {};
      Object.keys(hasWeeks ? raw.weeks : {}).forEach(function (key) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
        var week = sanitizeWeek(raw.weeks[key]);
        if (weekHasEntries(week)) incoming[key] = week;
      });

      var incomingFuel = sanitizeFuel(raw.fuel);

      var keys = Object.keys(incoming).sort();
      if (!keys.length && !incomingFuel.cars.length && !incomingFuel.fills.length) {
        showToast('No hours or fuel data found in that file');
        return;
      }
      var summary = describeData(keys.length, incomingFuel.cars.length, incomingFuel.fills.length);
      if (!window.confirm('Import ' + summary +
          ' from this backup? Matching weeks and cars will be replaced.')) return;

      keys.forEach(function (key) { state.weeks[key] = incoming[key]; });

      incomingFuel.cars.forEach(function (car) {
        state.fuel.cars = state.fuel.cars.filter(function (c) { return c.plate !== car.plate; });
        state.fuel.cars.push(car);
      });
      incomingFuel.fills.forEach(function (fill) {
        var dupe = state.fuel.fills.some(function (f) {
          return f.car === fill.car && f.odo === fill.odo && f.litres === fill.litres;
        });
        if (!dupe) state.fuel.fills.push(fill);
      });
      if (!state.fuel.selectedCar && state.fuel.cars.length) {
        state.fuel.selectedCar = state.fuel.cars[0].plate;
      }

      if (keys.length) setWeek(keys[keys.length - 1]); // jump to the latest imported week
      else renderFuel();
      showToast('Imported backup');
    };
    reader.onerror = function () { showToast('Couldn’t read that file'); };
    reader.readAsText(file);
  }

  exportBtn.addEventListener('click', function () { exportData('all'); });
  exportHoursBtn.addEventListener('click', function () { exportData('hours'); });
  exportFuelBtn.addEventListener('click', function () { exportData('fuel'); });
  importBtn.addEventListener('click', function () { importInput.click(); });
  importInput.addEventListener('change', function () {
    if (importInput.files && importInput.files[0]) importBackup(importInput.files[0]);
    importInput.value = ''; // let the same file be chosen again later
  });

  // -------------------------------------------------------------------- sync

  var createSyncBtn = document.getElementById('createSyncBtn');
  var enterSyncBtn = document.getElementById('enterSyncBtn');
  var syncCodeForm = document.getElementById('syncCodeForm');
  var syncCodeInput = document.getElementById('syncCodeInput');
  var syncSetup = document.getElementById('syncSetup');
  var syncActive = document.getElementById('syncActive');
  var syncCodeShow = document.getElementById('syncCodeShow');
  var syncNowBtn = document.getElementById('syncNowBtn');
  var stopSyncBtn = document.getElementById('stopSyncBtn');
  var syncStatus = document.getElementById('syncStatus');

  var SYNC_CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;

  function generateSyncCode() {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    var bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    var code = '';
    for (var i = 0; i < bytes.length; i++) code += alphabet[bytes[i] % 64];
    return code;
  }

  function renderSync() {
    syncSetup.hidden = !!state.syncCode;
    syncActive.hidden = !state.syncCode;
    if (state.syncCode) {
      syncCodeShow.textContent = state.syncCode;
      syncStatus.textContent = state.lastSyncAt
        ? 'Last synced ' + new Date(state.lastSyncAt).toLocaleString()
        : 'Not synced yet — tap “Sync now”.';
    }
  }

  function syncPayload() {
    return {
      app: 'weekly-hours',
      version: 3,
      syncedAt: new Date().toISOString(),
      weeks: savedWeeksObject(),
      fuel: { cars: state.fuel.cars, fills: state.fuel.fills, lookups: state.fuel.lookups },
      deleted: state.deleted
    };
  }

  // Merge a remote sync payload into local state. Per entity (week, car,
  // fill) the copy with the newer "mod" timestamp wins; tombstones delete
  // entities unless they were edited after the deletion.
  function mergeRemote(raw) {
    if (!raw || typeof raw !== 'object') return;

    var remoteDeleted = sanitizeDeleted(raw.deleted);
    Object.keys(remoteDeleted).forEach(function (kind) {
      Object.keys(remoteDeleted[kind]).forEach(function (key) {
        if (!state.deleted[kind][key] || remoteDeleted[kind][key] > state.deleted[kind][key]) {
          state.deleted[kind][key] = remoteDeleted[kind][key];
        }
      });
    });

    if (raw.weeks && typeof raw.weeks === 'object') {
      Object.keys(raw.weeks).forEach(function (key) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
        var remote = sanitizeWeek(raw.weeks[key]);
        if ((remote.mod || 0) <= (state.deleted.weeks[key] || 0)) return;
        var local = state.weeks[key];
        if (!local || (remote.mod || 0) > (local.mod || 0)) {
          state.weeks[key] = remote;
          lastSavedDays[key] = JSON.stringify(remote.days); // merged, not edited here
        }
      });
    }
    Object.keys(state.deleted.weeks).forEach(function (key) {
      var local = state.weeks[key];
      if (local && (local.mod || 0) <= state.deleted.weeks[key]) delete state.weeks[key];
    });

    var remoteFuel = sanitizeFuel(raw.fuel);

    remoteFuel.cars.forEach(function (remote) {
      if ((remote.mod || 0) <= (state.deleted.cars[remote.plate] || 0)) return;
      var local = null;
      state.fuel.cars.forEach(function (c) { if (c.plate === remote.plate) local = c; });
      if (!local) {
        state.fuel.cars.push(remote);
      } else if ((remote.mod || 0) > (local.mod || 0)) {
        state.fuel.cars = state.fuel.cars.map(function (c) {
          return c.plate === remote.plate ? remote : c;
        });
      }
    });
    state.fuel.cars = state.fuel.cars.filter(function (c) {
      var tomb = state.deleted.cars[c.plate];
      return !tomb || (c.mod || 0) > tomb;
    });

    var fillsById = {};
    state.fuel.fills.forEach(function (f) { fillsById[f.id] = f; });
    remoteFuel.fills.forEach(function (remote) {
      if ((remote.mod || 0) <= (state.deleted.fills[remote.id] || 0)) return;
      var local = fillsById[remote.id];
      if (!local) {
        state.fuel.fills.push(remote);
        fillsById[remote.id] = remote;
      } else if ((remote.mod || 0) > (local.mod || 0)) {
        state.fuel.fills = state.fuel.fills.map(function (f) {
          return f.id === remote.id ? remote : f;
        });
        fillsById[remote.id] = remote;
      }
    });
    state.fuel.fills = state.fuel.fills.filter(function (f) {
      var tomb = state.deleted.fills[f.id];
      return !tomb || (f.mod || 0) > tomb;
    });

    Object.keys(remoteFuel.lookups).forEach(function (key) {
      if (!state.fuel.lookups[key]) state.fuel.lookups[key] = remoteFuel.lookups[key];
    });

    if (!state.fuel.cars.some(function (c) { return c.plate === state.fuel.selectedCar; })) {
      state.fuel.selectedCar = state.fuel.cars.length ? state.fuel.cars[0].plate : null;
    }
  }

  // Pull the remote copy, merge it in, push the merged result back.
  function syncNow() {
    if (!state.syncCode) return;
    var url = LOOKUP_WORKER_URL + '/sync/' + state.syncCode;
    syncNowBtn.disabled = true;
    syncNowBtn.textContent = 'Syncing…';
    fetch(url)
      .then(function (res) {
        if (res.status === 404) return null; // first sync under this code
        if (!res.ok) throw new Error('pull failed');
        return res.json();
      })
      .then(function (remote) {
        if (remote) mergeRemote(remote);
        return fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(syncPayload())
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error('push failed');
        state.lastSyncAt = Date.now();
        setWeek(state.selectedWeek); // re-render both tabs from merged state
        renderFuel();
        showToast('Synced ✓');
      })
      .catch(function () {
        showToast('Sync failed — check your connection and try again');
      })
      .then(function () {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync now';
        renderSync();
      });
  }

  createSyncBtn.addEventListener('click', function () {
    state.syncCode = generateSyncCode();
    saveState();
    renderSync();
    syncNow();
  });

  enterSyncBtn.addEventListener('click', function () {
    syncCodeForm.hidden = false;
    syncCodeInput.focus();
  });

  syncCodeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = syncCodeInput.value.trim();
    if (!SYNC_CODE_RE.test(code)) {
      showToast('That doesn’t look like a sync code');
      return;
    }
    state.syncCode = code;
    syncCodeInput.value = '';
    syncCodeForm.hidden = true;
    saveState();
    renderSync();
    syncNow();
  });

  syncCodeShow.addEventListener('click', function () {
    copyText(state.syncCode).then(function () {
      showToast('Sync code copied — paste it on your other device');
    }).catch(function () {
      showToast('Couldn’t copy — long-press the code to copy it');
    });
  });

  stopSyncBtn.addEventListener('click', function () {
    if (!window.confirm('Stop syncing on this device? Your data stays here ' +
        'and on Cloudflare, and other devices keep syncing.')) return;
    state.syncCode = null;
    state.lastSyncAt = null;
    saveState();
    renderSync();
  });

  syncNowBtn.addEventListener('click', syncNow);

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

  // -------------------------------------------------------------------- tabs

  var appTitle = document.getElementById('appTitle');

  var TABS = {
    hours: {
      btn: document.getElementById('tabHours'),
      view: document.getElementById('hoursView'),
      title: 'Weekly Hours'
    },
    fuel: {
      btn: document.getElementById('tabFuel'),
      view: document.getElementById('fuelView'),
      title: 'Fuel Tracker'
    },
    backup: {
      btn: document.getElementById('tabBackup'),
      view: document.getElementById('backupView'),
      title: 'Backup'
    }
  };

  function setTab(tab) {
    if (!TABS[tab]) tab = 'hours';
    state.activeTab = tab;
    Object.keys(TABS).forEach(function (key) {
      var active = key === tab;
      TABS[key].view.hidden = !active;
      TABS[key].btn.classList.toggle('active', active);
      TABS[key].btn.setAttribute('aria-selected', String(active));
    });
    appTitle.textContent = TABS[tab].title;
    if (tab === 'fuel') renderFuel();
    if (tab === 'backup') renderSync();
    saveState();
  }

  Object.keys(TABS).forEach(function (key) {
    TABS[key].btn.addEventListener('click', function () { setTab(key); });
  });

  // -------------------------------------------------------------------- fuel

  var carSelect = document.getElementById('carSelect');
  var addCarBtn = document.getElementById('addCarBtn');
  var carForm = document.getElementById('carForm');
  // Plate lookups go through a Cloudflare Worker (see worker/) so the
  // plateapi.com.au API key never ships in this file.
  var LOOKUP_WORKER_URL = 'https://plate-lookup.skermiebro.workers.dev';

  var carPlateInput = document.getElementById('carPlate');
  var carTypeInput = document.getElementById('carType');
  var carStateSelect = document.getElementById('carState');
  var carTankInput = document.getElementById('carTank');
  var carEconomyInput = document.getElementById('carEconomy');
  var editCarBtn = document.getElementById('editCarBtn');
  var lookupPlateBtn = document.getElementById('lookupPlateBtn');
  var cancelCarBtn = document.getElementById('cancelCarBtn');
  var carInfo = document.getElementById('carInfo');
  var deleteCarBtn = document.getElementById('deleteCarBtn');
  var fillCard = document.getElementById('fillCard');
  var fillForm = document.getElementById('fillForm');
  var fillDate = document.getElementById('fillDate');
  var fillOdo = document.getElementById('fillOdo');
  var fillLitres = document.getElementById('fillLitres');
  var fillCost = document.getElementById('fillCost');
  var economyField = document.getElementById('economyField');
  var fillEconomy = document.getElementById('fillEconomy');
  var fillFromEmpty = document.getElementById('fillFromEmpty');
  var fillToFull = document.getElementById('fillToFull');
  var fillSubmitBtn = document.getElementById('fillSubmitBtn');
  var cancelFillEditBtn = document.getElementById('cancelFillEditBtn');
  var fuelStatsCard = document.getElementById('fuelStatsCard');
  var statGrid = document.getElementById('statGrid');
  var statNote = document.getElementById('statNote');
  var fillHistoryCard = document.getElementById('fillHistoryCard');
  var fillList = document.getElementById('fillList');

  var editingCarPlate = null; // plate of the car being edited, null when adding
  var editingFillId = null;   // id of the fill being edited, null when adding

  function selectedCar() {
    var plate = state.fuel.selectedCar;
    for (var i = 0; i < state.fuel.cars.length; i++) {
      if (state.fuel.cars[i].plate === plate) return state.fuel.cars[i];
    }
    return null;
  }

  // Fills for one car, oldest first by odometer reading.
  function carFills(plate) {
    return state.fuel.fills
      .filter(function (f) { return f.car === plate; })
      .sort(function (a, b) { return a.odo - b.odo; });
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /*
   * Work out economy and range for a car.
   *
   * Real-world economy is measured between two "filled to full" fills (the
   * standard trip method: everything added after full fill A up to and
   * including full fill B was burned over that distance), or failing that
   * between two "tank was empty" fills. With neither, we fall back to the
   * user's estimated L/100km.
   *
   * Estimated range = fuel believed to be in the tank right now divided by
   * economy. After a "filled to full" fill with a known tank size that's a
   * full tank; otherwise it's litres added since the last empty fill minus
   * what the distance driven since then should have used.
   */
  function fuelStats(car) {
    var fills = carFills(car.plate);
    var stats = {
      fills: fills,
      totalCost: 0,
      totalLitres: 0,
      measuredEconomy: null,
      measuredKm: 0,
      economy: car.economy,
      range: null,
      rangeApprox: false,
      fullRange: null
    };
    fills.forEach(function (f) {
      stats.totalCost += f.cost;
      stats.totalLitres += f.litres;
    });

    var emptyIdx = [];
    var fullIdx = [];
    fills.forEach(function (f, i) {
      if (f.fromEmpty) emptyIdx.push(i);
      if (f.toFull) fullIdx.push(i);
    });

    // Sum litres burned over the distance covered by a list of marker fills.
    // Full-to-full intervals burn the fuel added after A up to and including
    // B; empty-to-empty intervals burn the fuel added from A up to but not
    // including B.
    function measureIntervals(idx, includeEnd) {
      var out = { litres: 0, km: 0 };
      for (var p = 1; p < idx.length; p++) {
        var a = idx[p - 1];
        var b = idx[p];
        var dist = fills[b].odo - fills[a].odo;
        if (dist <= 0) continue;
        for (var j = a; j < b; j++) {
          out.litres += fills[includeEnd ? j + 1 : j].litres;
        }
        out.km += dist;
      }
      return out;
    }

    var measured = measureIntervals(fullIdx, true);
    stats.method = 'full';
    if (!measured.km) {
      measured = measureIntervals(emptyIdx, false);
      stats.method = 'empty';
    }
    if (measured.km > 0) {
      stats.measuredEconomy = measured.litres / measured.km * 100;
      stats.measuredKm = measured.km;
      stats.economy = stats.measuredEconomy;
    } else {
      stats.method = null;
    }

    if (fills.length && stats.economy > 0) {
      var last = fills[fills.length - 1];
      var inTank;
      if (last.toFull && car.tank) {
        inTank = car.tank;
      } else if (emptyIdx.length) {
        var lastEmpty = emptyIdx[emptyIdx.length - 1];
        inTank = 0;
        for (var k = lastEmpty; k < fills.length; k++) inTank += fills[k].litres;
        inTank -= (last.odo - fills[lastEmpty].odo) / 100 * stats.economy;
      } else {
        // Never filled from empty: we only know about the last top-up.
        inTank = last.litres;
        stats.rangeApprox = true;
      }
      if (car.tank) inTank = Math.min(inTank, car.tank);
      stats.range = Math.max(0, inTank) / stats.economy * 100;
    }
    if (car.tank && stats.economy > 0) {
      stats.fullRange = car.tank / stats.economy * 100;
    }
    return stats;
  }

  function renderCarSelect() {
    carSelect.innerHTML = '';
    if (!state.fuel.cars.length) {
      var opt = document.createElement('option');
      opt.textContent = 'No cars yet — add one';
      opt.value = '';
      carSelect.appendChild(opt);
      carSelect.disabled = true;
      return;
    }
    carSelect.disabled = false;
    state.fuel.cars.forEach(function (car) {
      var opt = document.createElement('option');
      opt.value = car.plate;
      opt.textContent = car.plate + (car.type ? ' — ' + car.type : '');
      carSelect.appendChild(opt);
    });
    carSelect.value = state.fuel.selectedCar;
  }

  function addStat(label, value) {
    var div = document.createElement('div');
    div.className = 'stat';
    var v = document.createElement('strong');
    v.textContent = value;
    var l = document.createElement('span');
    l.textContent = label;
    div.appendChild(v);
    div.appendChild(l);
    statGrid.appendChild(div);
  }

  function renderFuel() {
    renderCarSelect();
    var car = selectedCar();
    var addingCar = !carForm.hidden;

    carInfo.hidden = !car || addingCar;
    deleteCarBtn.hidden = !car || addingCar;
    editCarBtn.hidden = !car || addingCar;
    fillCard.hidden = !car || addingCar;
    if (!car) {
      fuelStatsCard.hidden = true;
      fillHistoryCard.hidden = true;
      saveState();
      return;
    }

    var stats = fuelStats(car);
    carInfo.textContent = car.plate + (car.type ? ' · ' + car.type : '') +
      (car.economy ? ' · est. ' + round1(car.economy) + ' L/100km' : '') +
      (car.tank ? ' · ' + round1(car.tank) + ' L tank' : '');

    // First fill on this vehicle asks for an estimated economy figure.
    economyField.hidden = car.economy !== null;
    fillEconomy.required = !economyField.hidden;
    if (!fillDate.value) fillDate.value = toISODate(new Date());

    fuelStatsCard.hidden = !stats.fills.length;
    fillHistoryCard.hidden = !stats.fills.length;
    if (stats.fills.length) {
      statGrid.innerHTML = '';
      if (stats.range !== null) {
        addStat('est. range' + (stats.rangeApprox ? ' *' : ''), Math.round(stats.range) + ' km');
      }
      if (stats.economy) {
        addStat(stats.measuredEconomy ? 'measured economy' : 'estimated economy',
          round1(stats.economy) + ' L/100km');
      }
      if (stats.fullRange) {
        addStat('full-tank range', Math.round(stats.fullRange) + ' km');
      }
      addStat('total spent', '$' + stats.totalCost.toFixed(2));
      addStat('total fuel', round1(stats.totalLitres) + ' L');
      if (stats.totalLitres > 0) {
        addStat('avg price', '$' + (stats.totalCost / stats.totalLitres).toFixed(2) + '/L');
      }
      if (stats.economy && stats.totalLitres > 0) {
        addStat('cost per 100km',
          '$' + (stats.totalCost / stats.totalLitres * stats.economy).toFixed(2));
      }

      if (stats.measuredEconomy) {
        statNote.hidden = false;
        statNote.textContent = 'Economy measured over ' + Math.round(stats.measuredKm) +
          ' km of ' + (stats.method === 'full' ? 'full-to-full' : 'empty-to-empty') + ' fills.';
      } else if (stats.rangeApprox) {
        statNote.hidden = false;
        statNote.textContent = '* Based on the last fill only — tick “filled up to full” or ' +
          '“tank was empty” on your fill-ups to get accurate range and measured economy.';
      } else {
        statNote.hidden = true;
      }

      fillList.innerHTML = '';
      stats.fills.slice().reverse().forEach(function (f) {
        var li = document.createElement('li');
        li.className = 'fill-item';
        var main = document.createElement('div');
        main.className = 'fill-main';
        var top = document.createElement('strong');
        top.textContent = round1(f.litres) + ' L · $' + f.cost.toFixed(2) +
          (f.fromEmpty ? ' · from empty' : '') + (f.toFull ? ' · to full' : '');
        var sub = document.createElement('span');
        sub.textContent = (f.date ? formatFillDate(f.date) + ' · ' : '') +
          Math.round(f.odo).toLocaleString() + ' km';
        main.appendChild(top);
        main.appendChild(sub);
        var edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn icon-btn fill-edit';
        edit.textContent = '✎';
        edit.setAttribute('aria-label', 'Edit fill-up on ' + (f.date || 'unknown date'));
        edit.addEventListener('click', function () { startFillEdit(f); });
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn icon-btn fill-delete';
        del.textContent = '✕';
        del.setAttribute('aria-label', 'Delete fill-up on ' + (f.date || 'unknown date'));
        del.addEventListener('click', function () {
          if (!window.confirm('Delete this fill-up?')) return;
          state.deleted.fills[f.id] = Date.now();
          state.fuel.fills = state.fuel.fills.filter(function (x) { return x.id !== f.id; });
          if (editingFillId === f.id) resetFillForm();
          renderFuel();
          showToast('Fill-up deleted');
        });
        li.appendChild(main);
        li.appendChild(edit);
        li.appendChild(del);
        fillList.appendChild(li);
      });
    }
    saveState();
  }

  function formatFillDate(iso) {
    return parseISODate(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function resetFillForm() {
    editingFillId = null;
    fillForm.reset();
    fillDate.value = toISODate(new Date());
    fillSubmitBtn.textContent = 'Add fill-up';
    cancelFillEditBtn.hidden = true;
  }

  function startFillEdit(fill) {
    editingFillId = fill.id;
    fillDate.value = fill.date || toISODate(new Date());
    fillOdo.value = String(fill.odo);
    fillLitres.value = String(fill.litres);
    fillCost.value = String(fill.cost);
    fillFromEmpty.checked = fill.fromEmpty;
    fillToFull.checked = fill.toFull;
    fillSubmitBtn.textContent = 'Save changes';
    cancelFillEditBtn.hidden = false;
    fillCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fillOdo.focus();
  }

  cancelFillEditBtn.addEventListener('click', function () {
    resetFillForm();
    showToast('Edit cancelled');
  });

  carSelect.addEventListener('change', function () {
    state.fuel.selectedCar = carSelect.value;
    resetFillForm();
    renderFuel();
  });

  addCarBtn.addEventListener('click', function () {
    editingCarPlate = null;
    carForm.hidden = false;
    carPlateInput.value = '';
    carTypeInput.value = '';
    carStateSelect.value = 'QLD';
    carTankInput.value = '';
    carEconomyInput.value = '';
    renderFuel();
    carPlateInput.focus();
  });

  editCarBtn.addEventListener('click', function () {
    var car = selectedCar();
    if (!car) return;
    editingCarPlate = car.plate;
    carForm.hidden = false;
    carPlateInput.value = car.plate;
    carTypeInput.value = car.type;
    carStateSelect.value = car.state || 'QLD';
    carTankInput.value = car.tank === null ? '' : String(car.tank);
    carEconomyInput.value = car.economy === null ? '' : String(car.economy);
    renderFuel();
    carPlateInput.focus();
  });

  cancelCarBtn.addEventListener('click', function () {
    editingCarPlate = null;
    carForm.hidden = true;
    renderFuel();
  });

  function titleCase(s) {
    return s.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }

  function describeVehicle(v) {
    var parts = [];
    if (v.make) parts.push(titleCase(v.make));
    if (v.model) parts.push(String(v.model).toUpperCase());
    if (v.engine) parts.push(v.engine);
    if (v.year_range) parts.push(v.year_range);
    return parts.join(' ');
  }

  // Look the plate up via the Cloudflare Worker proxy (worker/), which holds
  // the plateapi.com.au key. Results are cached per plate+state in saved
  // state, so repeat lookups never touch the monthly quota.
  lookupPlateBtn.addEventListener('click', function () {
    var plate = carPlateInput.value.trim().toUpperCase();
    var carState = carStateSelect.value;
    if (!plate) {
      showToast('Type the number plate first');
      carPlateInput.focus();
      return;
    }
    var cacheKey = carState + ':' + plate;
    if (state.fuel.lookups[cacheKey]) {
      carTypeInput.value = state.fuel.lookups[cacheKey];
      showToast('Found (cached): ' + state.fuel.lookups[cacheKey]);
      return;
    }
    if (!LOOKUP_WORKER_URL) {
      showToast('Plate lookup isn’t set up yet — deploy the worker first');
      return;
    }
    lookupPlateBtn.disabled = true;
    lookupPlateBtn.textContent = 'Finding…';
    fetch(LOOKUP_WORKER_URL + '?plate=' + encodeURIComponent(plate) +
        '&state=' + encodeURIComponent(carState))
      .then(function (res) {
        var remaining = res.headers.get('X-RateLimit-Remaining');
        if (res.status === 429) {
          showToast('Lookup limit reached — wait a minute and try again');
          return;
        }
        return res.json().then(function (data) {
          if (!data.success || !data.vehicle) {
            showToast('No match for ' + plate + ' (' + carState + ') — enter the model manually');
            return;
          }
          var desc = describeVehicle(data.vehicle);
          carTypeInput.value = desc;
          state.fuel.lookups[cacheKey] = desc;
          saveState();
          showToast('Found: ' + desc +
            (remaining !== null ? ' · ' + remaining + ' lookups left' : ''));
        });
      })
      .catch(function () {
        showToast('Lookup failed — check your connection or enter the model manually');
      })
      .then(function () {
        lookupPlateBtn.disabled = false;
        lookupPlateBtn.textContent = 'Find model';
      });
  });

  carForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var plate = carPlateInput.value.trim().toUpperCase();
    if (!plate) return;

    var tank = carTankInput.value === '' ? null : Number(carTankInput.value);
    if (tank !== null && (!isFinite(tank) || tank <= 0)) tank = null;
    var economy = carEconomyInput.value === '' ? null : Number(carEconomyInput.value);
    if (economy !== null && (!isFinite(economy) || economy <= 0)) economy = null;

    var taken = state.fuel.cars.some(function (c) {
      return c.plate === plate && c.plate !== editingCarPlate;
    });
    if (taken) {
      showToast(plate + ' is already saved');
      return;
    }

    if (editingCarPlate) {
      var car = null;
      for (var i = 0; i < state.fuel.cars.length; i++) {
        if (state.fuel.cars[i].plate === editingCarPlate) car = state.fuel.cars[i];
      }
      if (!car) return;
      car.type = carTypeInput.value.trim();
      car.state = carStateSelect.value;
      car.tank = tank;
      car.economy = economy;
      car.mod = Date.now();
      if (plate !== car.plate) {
        state.fuel.fills.forEach(function (f) {
          if (f.car === car.plate) {
            f.car = plate;
            f.mod = Date.now();
          }
        });
        state.deleted.cars[car.plate] = Date.now(); // old plate is gone
        car.plate = plate;
      }
      state.fuel.selectedCar = plate;
      showToast('Updated ' + plate);
    } else {
      state.fuel.cars.push({
        plate: plate, type: carTypeInput.value.trim(), state: carStateSelect.value,
        economy: economy, tank: tank, mod: Date.now()
      });
      state.fuel.selectedCar = plate;
      showToast('Added ' + plate);
    }
    editingCarPlate = null;
    carForm.hidden = true;
    resetFillForm();
    renderFuel();
  });

  deleteCarBtn.addEventListener('click', function () {
    var car = selectedCar();
    if (!car) return;
    var count = carFills(car.plate).length;
    if (!window.confirm('Remove ' + car.plate +
        (count ? ' and its ' + count + ' fill-up' + (count === 1 ? '' : 's') : '') + '?')) return;
    state.deleted.cars[car.plate] = Date.now();
    state.fuel.fills.forEach(function (f) {
      if (f.car === car.plate) state.deleted.fills[f.id] = Date.now();
    });
    state.fuel.cars = state.fuel.cars.filter(function (c) { return c.plate !== car.plate; });
    state.fuel.fills = state.fuel.fills.filter(function (f) { return f.car !== car.plate; });
    state.fuel.selectedCar = state.fuel.cars.length ? state.fuel.cars[0].plate : null;
    resetFillForm();
    renderFuel();
    showToast('Removed ' + car.plate);
  });

  fillForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var car = selectedCar();
    if (!car) return;

    var odo = Number(fillOdo.value);
    var litres = Number(fillLitres.value);
    var cost = Number(fillCost.value);
    if (!isFinite(odo) || odo < 0 || !isFinite(litres) || litres <= 0 ||
        !isFinite(cost) || cost < 0) {
      showToast('Check the odometer, litres and cost values');
      return;
    }

    var fills = carFills(car.plate).filter(function (f) { return f.id !== editingFillId; });
    var last = fills[fills.length - 1];
    if (!editingFillId && last && odo <= last.odo &&
        !window.confirm('Odometer (' + odo + ' km) isn’t higher than the last fill (' +
          last.odo + ' km). Add anyway?')) {
      return;
    }

    if (car.economy === null) {
      var economy = Number(fillEconomy.value);
      if (!isFinite(economy) || economy <= 0) {
        showToast('Enter an estimated fuel economy for ' + car.plate);
        fillEconomy.focus();
        return;
      }
      car.economy = economy;
      car.mod = Date.now();
    }

    if (editingFillId) {
      state.fuel.fills.forEach(function (f) {
        if (f.id !== editingFillId) return;
        f.date = fillDate.value || f.date;
        f.odo = odo;
        f.litres = litres;
        f.cost = cost;
        f.fromEmpty = fillFromEmpty.checked;
        f.toFull = fillToFull.checked;
        f.mod = Date.now();
      });
      showToast('Fill-up updated');
    } else {
      state.fuel.fills.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        car: car.plate,
        date: fillDate.value || toISODate(new Date()),
        odo: odo,
        litres: litres,
        cost: cost,
        fromEmpty: fillFromEmpty.checked,
        toFull: fillToFull.checked,
        mod: Date.now()
      });
      showToast('Fill-up saved');
    }
    resetFillForm();
    renderFuel();
  });

  // -------------------------------------------------------------------- init

  buildRows();
  applyTheme();
  setWeek(state.selectedWeek || toISODate(mondayOf(new Date())));
  setTab(state.activeTab);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function () {
        /* e.g. running from file:// — the app works fine without offline support */
      });
    });
  }
})();
