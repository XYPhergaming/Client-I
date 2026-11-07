export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).send(`
(function() {
  var base = null;
  try {
    var s = document.currentScript;
    if (s && s.src) {
      var u = new URL(s.src);
      var path = u.pathname.substring(0, u.pathname.lastIndexOf('/') + 1);
      if (path.length >= 4 && path.slice(-4) === 'api/') path = path.slice(0, -4);
      if (path.charAt(path.length - 1) !== '/') path += '/';
      if (path === '') path = '/';
      base = u.origin + path;
    }
  } catch (e) {}
  if (!base) {
    try {
      var loc = window.location;
      var p = loc.pathname.substring(0, loc.pathname.lastIndexOf('/') + 1);
      base = loc.origin + p;
    } catch (e) {
      base = '/';
    }
  }
  window.URLS = {
    base: base,
    pkgRegistry: 'data/pkg.json',
    masterRegistry: 'data/master_key.json',
    pkg: new Proxy({}, { get: function(t, p) { return typeof p === 'string' ? 'PKG/' + p + '.js' : undefined; } }),
    master: new Proxy({}, { get: function(t, p) { return typeof p === 'string' ? 'MASTER_KEY/' + p + '.js' : undefined; } })
  };
})();
  `);
}