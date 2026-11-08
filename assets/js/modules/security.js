'use strict';

const SecurityScanner = {
  scan(filename, content) {
    const name = String(filename || '').toLowerCase();
    if (/\.\.[\/\\]/.test(name) || /^[\/\\]/.test(name)) return { safe: false, reason: 'PATH TRAVERSAL IN FILENAME' };
    if (!name || name.length > 255) return { safe: false, reason: 'INVALID FILENAME' };
    if (EXECUTABLE_EXT.test(name)) return { safe: false, reason: 'EXECUTABLE/BINARY FILE TYPE BLOCKED' };
    if (NATIVE_SCRIPT_EXT.test(name)) return { safe: false, reason: 'NATIVE SCRIPT FILE BLOCKED' };
    if (content == null || typeof content !== 'string') return { safe: true };
    const s = content;
    if (s.length > 2 * 1024 * 1024) return { safe: false, reason: 'FILE TOO LARGE (>2MB)' };
    if (s.indexOf('\0') !== -1) return { safe: false, reason: 'NULL BYTES DETECTED' };
    if (ACTIVE_HTML_EXT.test(name)) {
      if (/<script[\s>]/i.test(s)) return { safe: false, reason: 'INLINE <script> TAG' };
      if (/\son[a-z]+\s*=/i.test(s)) return { safe: false, reason: 'INLINE EVENT HANDLER' };
      if (/javascript\s*:/i.test(s)) return { safe: false, reason: 'JAVASCRIPT: URI' };
      if (/<iframe|<object|<embed|<frame|<frameset/i.test(s)) return { safe: false, reason: 'EMBEDDED FRAME/OBJECT' };
      if (/<meta[^>]*http-equiv\s*=\s*["']?refresh/i.test(s)) return { safe: false, reason: 'META REFRESH REDIRECT' };
      if (/data:text\/html;base64,/i.test(s)) return { safe: false, reason: 'DATA URI HTML PAYLOAD' };
    }
    const patterns = [
      /<svg[^>]*\sonload\s*=/i, /\bdocument\.cookie\s*=/i,
      /\bwindow\.location\s*=\s*['"]?javascript:/i,
      /require\s*\(\s*['"`]child_process['"`]\s*\)/i,
      /\bexec\s*\(\s*['"`](?:rm\s+-rf|del\s+\/[sq]|format\s+[a-z]:)/i,
      /\bpowershell(?:\.exe)?\s+-(?:e|enc|encodedcommand)\b/i,
      /\\\\[a-z]:\\[^\\]+\.(?:exe|dll|bat|cmd)/i,
      /\beval\s*\(\s*(?:atob\s*\(|unescape\s*\(|String\.fromCharCode)/i,
      /\.onreadystatechange\s*=\s*(?:document\.location|eval)/i
    ];
    for (const re of patterns) {
      if (re.test(s)) {
        if (!/\.(txt|md|log|json|yml|yaml|csv|py|sql)$/i.test(name)) {
          return { safe: false, reason: 'MALICIOUS PATTERN DETECTED' };
        }
      }
    }
    return { safe: true };
  }
};

window.SecurityScanner = SecurityScanner;