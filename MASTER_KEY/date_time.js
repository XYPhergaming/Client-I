(function () {
  'use strict';
  const T = Terminal;

  const TZ_MAP = {
    'kolkata': 'Asia/Kolkata', 'newyork': 'America/New_York', 'nyc': 'America/New_York',
    'london': 'Europe/London', 'tokyo': 'Asia/Tokyo', 'sydney': 'Australia/Sydney',
    'dhaka': 'Asia/Dhaka', 'paris': 'Europe/Paris', 'dubai': 'Asia/Dubai',
    'losangeles': 'America/Los_Angeles', 'chicago': 'America/Chicago',
    'toronto': 'America/Toronto', 'berlin': 'Europe/Berlin', 'moscow': 'Europe/Moscow',
    'beijing': 'Asia/Shanghai', 'singapore': 'Asia/Singapore'
  };

  function getTZ(loc) {
    if (!loc) return Intl.DateTimeFormat().resolvedOptions().timeZone;
    const key = loc.toLowerCase().replace(/\s+/g, '');
    return TZ_MAP[key] || loc;
  }
  
  async function fetchFromTimeApiIo(loc) {
    const tz = getTZ(loc);
    const res = await fetch(`https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(tz)}`);
    if (!res.ok) throw new Error('TimeAPI.io failed');
    const data = await res.json();
    return new Date(data.year, data.month - 1, data.day, data.hour, data.minute, data.seconds);
  }

  async function fetchFromWorldTimeApi(loc) {
    const tz = getTZ(loc);
    const res = await fetch(`http://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`);
    if (!res.ok) throw new Error('WorldTimeAPI failed');
    const data = await res.json();
    return new Date(data.datetime);
  }

  async function fetchFromWorldClockApi(loc) {
    const tz = getTZ(loc);
    const res = await fetch(`http://worldclockapi.com/api/json/${encodeURIComponent(tz)}/now`);
    if (!res.ok) throw new Error('WorldClockAPI failed');
    const data = await res.json();
    return new Date(data.currentDateTime);
  }

  async function getLocDate(session, loc) {
    if (!loc) return new Date();
    try { return await fetchFromTimeApiIo(loc); } catch (e) {}
    try { return await fetchFromWorldTimeApi(loc); } catch (e) {}
    try { return await fetchFromWorldClockApi(loc); } catch (e) {}
    if (session) session.printError(`WARNING: Could not fetch time for '${loc}'. Using local time.`);
    return new Date();
  }

  function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
  }

  let sw = { start: null, elapsed: 0 };

  async function handleDateTimeCmd(session, input) {
    let m;
    
    m = input.match(/^([0-9a-zA-Z\/\.\-]+)\s+vs\s+([0-9a-zA-Z\/\.\-]+)$/i);
    if (m) {
      const d1 = new Date(m[1]);
      const d2 = new Date(m[2]);
      if (isNaN(d1) || isNaN(d2)) { session.printError('INVALID DATE FORMAT'); return; }
      const diff = Math.abs(d1 - d2) / 86400000;
      session.printSystem('Difference: ' + Math.round(diff) + ' days');
      return;
    }

    m = input.match(/^(Date|Time)(?:\{([^}]+)\})?\s+vs\s+(Date|Time)(?:\{([^}]+)\})?$/i);
    if (m) {
      if (m[1].toLowerCase() !== m[3].toLowerCase()) { session.printError('INVALID COMPARISON'); return; }
      const isDate = m[1].toLowerCase() === 'date';
      const d1 = await getLocDate(session, m[2]);
      const d2 = await getLocDate(session, m[4]);
      const diffMs = Math.abs(d1 - d2);
      
      if (isDate) {
        const days = Math.floor(diffMs / 86400000);
        const hours = Math.floor((diffMs % 86400000) / 3600000);
        session.printSystem(`Date Difference: ${days} days, ${hours} hours`);
      } else {
        const h = Math.floor(diffMs / 3600000);
        const mi = Math.floor((diffMs % 3600000) / 60000);
        session.printSystem(`Time Difference: ${h} hours, ${mi} minutes`);
      }
      return;
    }

    m = input.match(/^(Time|Day)\{([^}]+)\}\s+(Add|Sub)\s*\{?([^}]+)\}?$/i);
    if (m) {
      const type = m[1].toLowerCase();
      const action = m[3].toLowerCase();
      const val = m[4].trim();
      const d = await getLocDate(session, m[2]);
      
      if (type === 'time') {
        const parts = val.split(':');
        const h = parseInt(parts[0], 10) || 0;
        const mi = parseInt(parts[1], 10) || 0;
        if (action === 'add') { d.setHours(d.getHours() + h); d.setMinutes(d.getMinutes() + mi); }
        else { d.setHours(d.getHours() - h); d.setMinutes(d.getMinutes() - mi); }
        session.printSystem(`Result: ${d.toLocaleTimeString()}`);
      } else {
        const days = parseInt(val, 10) || 0;
        if (action === 'add') d.setDate(d.getDate() + days);
        else d.setDate(d.getDate() - days);
        session.printSystem(`Result: ${d.toLocaleDateString()}`);
      }
      return;
    }

    m = input.match(/^(Date|Time|Day|Month|Year|TimeZone|UTC)(?:\{([^}]+)\})?$/i);
    if (m) {
      const cmd = m[1].toLowerCase();
      const loc = m[2];
      const d = await getLocDate(session, loc);
      
      if (cmd === 'date') session.printSystem(d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
      else if (cmd === 'time') session.printSystem(d.toLocaleTimeString());
      else if (cmd === 'day') session.printSystem('Day: ' + d.toLocaleDateString('en-US', { weekday: 'long' }));
      else if (cmd === 'month') session.printSystem('Month: ' + d.toLocaleDateString('en-US', { month: 'long' }));
      else if (cmd === 'year') session.printSystem('Year: ' + d.getFullYear());
      else if (cmd === 'timezone') session.printSystem('Timezone: ' + getTZ(loc));
      else if (cmd === 'utc') session.printSystem('UTC Time: ' + d.toUTCString());
      return;
    }

    if (/^WeekNumber$/i.test(input)) {
      session.printSystem('Week Number: ' + getWeekNumber(new Date()));
      return;
    }

    m = input.match(/^Stopwatch(?:\s+(Start|Stop|Reset))?$/i);
    if (m) {
      const action = (m[1] || '').toUpperCase();
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
  }

  const originalCommands = T.commands;
  T.commands = new Proxy(originalCommands, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      
      // Strip prefix (e.g., "DATE_TIME.TIME" becomes "TIME")
      const cleanProp = prop.replace(/^DATE_TIME\./i, '');

      if (/^(DATE|TIME|DAY|MONTH|YEAR|TIMEZONE|UTC|WEEKNUMBER|STOPWATCH|ALARM)/i.test(cleanProp)) {
        return function (arg) {
          return handleDateTimeCmd(this, cleanProp + (arg ? ' ' + arg : ''));
        };
      }

      if (/^\d{4}-\d{2}-\d{2}/.test(cleanProp) || /^\d{2}\/\d{2}\/\d{4}/.test(cleanProp)) {
        return function (arg) {
          if (arg && arg.toUpperCase().startsWith('VS ')) {
            return handleDateTimeCmd(this, cleanProp + ' ' + arg);
          }
          return Reflect.get(target, prop, receiver);
        };
      }

      return Reflect.get(target, prop, receiver);
    }
  });

  T.registerExtension({
    name: 'date_time',
    info: 'Date_Time Master Key imported successfully! Use date_time.Time or date_time.Date etc.'
  });
})();