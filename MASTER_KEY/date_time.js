(function () {
  'use strict';
  const T = Terminal;

  async function getLocDate(session, loc) {
    if (!loc) {
      return { date: new Date(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
    }
    
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1&language=en&format=json`);
      if (!res.ok) throw new Error('Network error');
      
      const data = await res.json();
      if (!data.results || data.results.length === 0) throw new Error('Location not found');
      
      const tz = data.results[0].timezone;
      const str = new Date().toLocaleString('en-US', { timeZone: tz });
      return { date: new Date(str), tz: tz };
    } catch (e) {
      if (session) session.printError(`Could not fetch time for '${loc}': ${e.message}`);
      return { date: new Date(), tz: 'UNKNOWN' };
    }
  }

  function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
  }

  let sw = { start: null, elapsed: 0 };

  async function handleDateTimeCmd(session, input) {
    // স্পেস নরমালাইজ করা হচ্ছে (যেমন: "Date { Kolkata }" কে "Date{Kolkata}" করা হচ্ছে)
    input = input.replace(/\s*\{\s*/g, '{').replace(/\s*\}\s*/g, '}').replace(/\s+/g, ' ').trim();
    let m;
    
    m = input.match(/^\{([^}]+)\}\s+vs\s+\{([^}]+)\}$/i);
    if (m) {
      const d1 = new Date(m[1]);
      const d2 = new Date(m[2]);
      if (isNaN(d1) || isNaN(d2)) { session.printError('INVALID DATE FORMAT'); return; }
      const diff = Math.abs(d1 - d2) / 86400000;
      session.printSystem('Difference: ' + Math.round(diff) + ' days');
      return;
    }

    m = input.match(/^(Date|Time)\{([^}]+)\}\s+vs\s+(Date|Time)\{([^}]+)\}$/i);
    if (m) {
      if (m[1].toLowerCase() !== m[3].toLowerCase()) { session.printError('INVALID COMPARISON'); return; }
      const isDate = m[1].toLowerCase() === 'date';
      const r1 = await getLocDate(session, m[2]);
      const r2 = await getLocDate(session, m[4]);
      const diffMs = Math.abs(r1.date - r2.date);
      
      if (isDate) session.printSystem(`Date Difference: ${Math.floor(diffMs / 86400000)} days`);
      else {
        const h = Math.floor(diffMs / 3600000);
        const mi = Math.floor((diffMs % 3600000) / 60000);
        session.printSystem(`Time Difference: ${h} hours, ${mi} minutes`);
      }
      return;
    }

    m = input.match(/^(Date|Time)\s+vs\s+(Date|Time)\{([^}]+)\}$/i);
    if (m) {
      if (m[1].toLowerCase() !== m[2].toLowerCase()) { session.printError('INVALID COMPARISON'); return; }
      const isDate = m[1].toLowerCase() === 'date';
      const d1 = new Date();
      const r2 = await getLocDate(session, m[3]);
      const diffMs = Math.abs(d1 - r2.date);
      
      if (isDate) session.printSystem(`Date Difference: ${Math.floor(diffMs / 86400000)} days`);
      else {
        const h = Math.floor(diffMs / 3600000);
        const mi = Math.floor((diffMs % 3600000) / 60000);
        session.printSystem(`Time Difference: ${h} hours, ${mi} minutes`);
      }
      return;
    }

    m = input.match(/^Time\{([^}]+)\}\s+(Add|Sub)\{([^}]+)\}$/i);
    if (m) {
      const action = m[2].toLowerCase();
      const val = m[3].trim();
      const r = await getLocDate(session, m[1]);
      const d = r.date;
      
      const parts = val.split(':');
      const h = parseInt(parts[0], 10) || 0;
      const mi = parseInt(parts[1], 10) || 0;
      if (action === 'add') { d.setHours(d.getHours() + h); d.setMinutes(d.getMinutes() + mi); }
      else { d.setHours(d.getHours() - h); d.setMinutes(d.getMinutes() - mi); }
      
      session.printSystem(`Result: ${d.toLocaleTimeString()}`);
      return;
    }

    m = input.match(/^Day\{([^}]+)\}\s+(Add|Sub)\{([^}]+)\}$/i);
    if (m) {
      const action = m[2].toLowerCase();
      const val = m[3].trim();
      const r = await getLocDate(session, m[1]);
      const d = r.date;
      
      const days = parseInt(val, 10) || 0;
      if (action === 'add') d.setDate(d.getDate() + days);
      else d.setDate(d.getDate() - days);
      
      session.printSystem(`Result: ${d.toLocaleDateString()}`);
      return;
    }

    m = input.match(/^Alarm\s*\{(\d{1,2}):(\d{2})\}$/i);
    if (m) {
      const h = parseInt(m[1], 10);
      const mi = parseInt(m[2], 10);
      const now = new Date();
      const alarmTime = new Date();
      alarmTime.setHours(h, mi, 0, 0);
      if (alarmTime <= now) alarmTime.setDate(alarmTime.getDate() + 1);
      const diff = alarmTime - now;
      
      session.printSuccess('Alarm set for ' + alarmTime.toLocaleTimeString());
      setTimeout(() => {
        T.printSuccess('ALARM RINGING! ' + new Date().toLocaleTimeString());
      }, diff);
      return;
    }

    m = input.match(/^Stopwatch(?:\s+(Start|Stop|Reset|Show))?$/i);
    if (m) {
      const action = (m[1] || 'SHOW').toUpperCase();
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
      return;
    }

    m = input.match(/^(Date|Time|Day|Month|Year|TimeZone|UTC)\{([^}]+)\}$/i);
    if (m) {
      const cmd = m[1].toLowerCase();
      const r = await getLocDate(session, m[2]);
      const d = r.date;
      
      if (cmd === 'date') session.printSystem(d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
      else if (cmd === 'time') session.printSystem(d.toLocaleTimeString());
      else if (cmd === 'day') session.printSystem('Day: ' + d.toLocaleDateString('en-US', { weekday: 'long' }));
      else if (cmd === 'month') session.printSystem('Month: ' + d.toLocaleDateString('en-US', { month: 'long' }));
      else if (cmd === 'year') session.printSystem('Year: ' + d.getFullYear());
      else if (cmd === 'timezone') session.printSystem('Timezone: ' + r.tz);
      else if (cmd === 'utc') session.printSystem('UTC Time: ' + d.toUTCString());
      return;
    }

    m = input.match(/^(Date|Time|Day|Month|Year|UTC|WeekNumber)$/i);
    if (m) {
      const cmd = m[1].toLowerCase();
      const d = new Date();
      
      if (cmd === 'date') session.printSystem(d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
      else if (cmd === 'time') session.printSystem(d.toLocaleTimeString());
      else if (cmd === 'day') session.printSystem('Day: ' + d.toLocaleDateString('en-US', { weekday: 'long' }));
      else if (cmd === 'month') session.printSystem('Month: ' + d.toLocaleDateString('en-US', { month: 'long' }));
      else if (cmd === 'year') session.printSystem('Year: ' + d.getFullYear());
      else if (cmd === 'utc') session.printSystem('UTC Time: ' + d.toUTCString());
      else if (cmd === 'weeknumber') session.printSystem('Week Number: ' + getWeekNumber(d));
      return;
    }
  }

  const originalCommands = T.commands;
  T.commands = new Proxy(originalCommands, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      const cleanProp = prop.replace(/^DATE_TIME\./i, '');

      if (/^(DATE|TIME|DAY|MONTH|YEAR|TIMEZONE|UTC|WEEKNUMBER|STOPWATCH|ALARM|\{|\d)/i.test(cleanProp)) {
        return function (arg) {
          return handleDateTimeCmd(this, cleanProp + (arg ? ' ' + arg : ''));
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  });

  T.registerExtension({
    name: 'date_time',
    info: 'Date_Time Master Key imported successfully!',
    commands: {
      DATE: function(arg) { return handleDateTimeCmd(this, arg ? 'Date ' + arg : 'Date'); },
      TIME: function(arg) { return handleDateTimeCmd(this, arg ? 'Time ' + arg : 'Time'); },
      DAY: function(arg) { return handleDateTimeCmd(this, arg ? 'Day ' + arg : 'Day'); },
      MONTH: function(arg) { return handleDateTimeCmd(this, arg ? 'Month ' + arg : 'Month'); },
      YEAR: function(arg) { return handleDateTimeCmd(this, arg ? 'Year ' + arg : 'Year'); },
      TIMEZONE: function(arg) { return handleDateTimeCmd(this, arg ? 'TimeZone ' + arg : 'TimeZone'); },
      UTC: function(arg) { return handleDateTimeCmd(this, arg ? 'UTC ' + arg : 'UTC'); },
      WEEKNUMBER: function() { return handleDateTimeCmd(this, 'WeekNumber'); },
      STOPWATCH: function(arg) { return handleDateTimeCmd(this, arg ? 'Stopwatch ' + arg : 'Stopwatch'); },
      ALARM: function(arg) { return handleDateTimeCmd(this, arg ? 'Alarm ' + arg : 'Alarm'); }
    }
  });
})();