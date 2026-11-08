(function () {
  'use strict';
  const T = Terminal;

  async function getLocDate(session, loc) {
    if (!loc) return { date: new Date(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1&language=en&format=json`);
      if (!res.ok) throw new Error('Network error');
      const data = await res.json();
      if (!data.results || !data.results.length) throw new Error('Location not found');
      const tz = data.results[0].timezone;
      const str = new Date().toLocaleString('en-US', { timeZone: tz });
      return { date: new Date(str), tz };
    } catch (e) {
      if (session) session.printError(`Could not fetch time for '${loc}': ${e.message}`);
      return { date: new Date(), tz: 'UNKNOWN' };
    }
  }

  function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  let sw = { start: null, elapsed: 0 };

  async function show(session, cmd, loc) {
    const r = await getLocDate(session, loc);
    const d = r.date;
    switch (cmd) {
      case 'date': session.printSystem(d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })); break;
      case 'time': session.printSystem(d.toLocaleTimeString()); break;
      case 'day': session.printSystem('Day: ' + d.toLocaleDateString('en-US', { weekday: 'long' })); break;
      case 'month': session.printSystem('Month: ' + d.toLocaleDateString('en-US', { month: 'long' })); break;
      case 'year': session.printSystem('Year: ' + d.getFullYear()); break;
      case 'timezone': session.printSystem('Timezone: ' + r.tz); break;
      case 'utc': session.printSystem('UTC Time: ' + d.toUTCString()); break;
      case 'weeknumber': session.printSystem('Week Number: ' + getWeekNumber(d)); break;
    }
  }

  async function cmdCompare(session, captures) {
    if (!Array.isArray(captures) || captures.length < 3) throw new Error('INVALID COMPARE');
    const [type, a, b] = captures;
    const t = String(type).toLowerCase();
    if (t !== 'date' && t !== 'time') throw new Error('INVALID COMPARE TYPE');
    const r1 = await getLocDate(session, a);
    const r2 = await getLocDate(session, b);
    const diffMs = Math.abs(r1.date - r2.date);
    if (t === 'date') session.printSystem(`Date Difference: ${Math.floor(diffMs / 86400000)} days`);
    else {
      const h = Math.floor(diffMs / 3600000);
      const mi = Math.floor((diffMs % 3600000) / 60000);
      session.printSystem(`Time Difference: ${h} hours, ${mi} minutes`);
    }
  }

  async function cmdShift(session, captures) {
    if (!Array.isArray(captures) || captures.length < 3) throw new Error('INVALID SHIFT');
    const [type, action, loc, val] = captures;
    const t = String(type).toLowerCase();
    const act = String(action).toLowerCase();
    const r = await getLocDate(session, loc);
    const d = r.date;
    if (t === 'time') {
      const parts = String(val).split(':');
      const h = parseInt(parts[0], 10) || 0;
      const mi = parseInt(parts[1], 10) || 0;
      if (act === 'add') { d.setHours(d.getHours() + h); d.setMinutes(d.getMinutes() + mi); }
      else { d.setHours(d.getHours() - h); d.setMinutes(d.getMinutes() - mi); }
      session.printSystem(`Result: ${d.toLocaleTimeString()}`);
    } else if (t === 'day') {
      const days = parseInt(val, 10) || 0;
      if (act === 'add') d.setDate(d.getDate() + days);
      else d.setDate(d.getDate() - days);
      session.printSystem(`Result: ${d.toLocaleDateString()}`);
    }
  }

  function cmdAlarm(session, arg) {
    const m = String(arg || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error('Usage: alarm{HH:MM}');
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    const now = new Date();
    const alarmTime = new Date();
    alarmTime.setHours(h, mi, 0, 0);
    if (alarmTime <= now) alarmTime.setDate(alarmTime.getDate() + 1);
    const diff = alarmTime - now;
    session.printSuccess('Alarm set for ' + alarmTime.toLocaleTimeString());
    setTimeout(() => { T.printSuccess('ALARM RINGING! ' + new Date().toLocaleTimeString()); }, diff);
  }

  function cmdStopwatch(session, arg) {
    const action = String(arg || 'show').trim().toUpperCase() || 'SHOW';
    if (action === 'START') {
      if (!sw.start) sw.start = Date.now();
      session.printSuccess('Stopwatch started.');
    } else if (action === 'STOP') {
      if (sw.start) { sw.elapsed += Date.now() - sw.start; sw.start = null; }
      session.printSuccess('Stopwatch stopped.');
    } else if (action === 'RESET') {
      sw.start = null; sw.elapsed = 0;
      session.printSuccess('Stopwatch reset.');
    } else {
      const total = sw.elapsed + (sw.start ? Date.now() - sw.start : 0);
      const h = Math.floor(total / 3600000);
      const mi = Math.floor((total % 3600000) / 60000);
      const s = Math.floor((total % 60000) / 1000);
      const ms = total % 1000;
      session.printSystem(`Elapsed: ${h}h ${mi}m ${s}s ${ms}ms`);
    }
  }

  T.registerExtension({
    name: 'date_time',
    info: 'Date_Time master key loaded.',
    descriptions: {
      DATE: 'Current/local date (date or date{loc})',
      TIME: 'Current/local time (time or time{loc})',
      DAY: 'Day name (day or day{loc})',
      MONTH: 'Month name',
      YEAR: 'Year',
      TIMEZONE: 'Timezone (timezone or timezone{loc})',
      UTC: 'UTC time',
      WEEKNUMBER: 'ISO week number',
      ALARM: 'Alarm (alarm{HH:MM})',
      STOPWATCH: 'Stopwatch (start|stop|reset|show)',
      COMPARE: 'Compare locations (compare{date|london}{paris})',
      SHIFT: 'Shift by hours/days (shift{time|london}{add}{1:30})'
    },
    routes: [
      { pattern: /^compare\{(date|time)\}\{([^}]+)\}\{([^}]+)\}$/i, handler: 'COMPARE' },
      { pattern: /^shift\{(date|day|time)\}\{([^}]+)\}\{(add|sub)\}\{([^}]+)\}$/i, handler: 'SHIFT' }
    ],
    commands: {
      DATE: function(arg) { return show(this, 'date', arg && arg.trim()); },
      TIME: function(arg) { return show(this, 'time', arg && arg.trim()); },
      DAY: function(arg) { return show(this, 'day', arg && arg.trim()); },
      MONTH: function(arg) { return show(this, 'month', arg && arg.trim()); },
      YEAR: function(arg) { return show(this, 'year', arg && arg.trim()); },
      TIMEZONE: function(arg) { return show(this, 'timezone', arg && arg.trim()); },
      UTC: function(arg) { return show(this, 'utc', arg && arg.trim()); },
      WEEKNUMBER: function() { return show(this, 'weeknumber'); },
      ALARM: function(arg) { return cmdAlarm(this, arg); },
      STOPWATCH: function(arg) { return cmdStopwatch(this, arg); },
      COMPARE: function(captures) { return cmdCompare(this, captures); },
      SHIFT: function(captures) { return cmdShift(this, captures); }
    }
  });
})();