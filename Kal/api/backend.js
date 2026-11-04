export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`
    const getBase = () => {
      const loc = window.location;
      const path = loc.pathname.substring(0, loc.pathname.lastIndexOf('/') + 1);
      return loc.origin + path;
    };
    
    window.URLS = {
      base: getBase(),
      pkgRegistry: 'pkg.json',
      masterRegistry: 'master_key.json',
      pkg: new Proxy({}, { get: (t, p) => typeof p === 'string' ? 'PKG/' + p + '.js' : undefined }),
      master: new Proxy({}, { get: (t, p) => typeof p === 'string' ? 'MASTER_KEY/' + p + '.js' : undefined })
    };
  `);
}