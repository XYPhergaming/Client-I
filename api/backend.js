export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`
    window.URLS = {
      base: window.location.origin + '/',
      pkgRegistry: 'pkg.json',
      masterRegistry: 'master_key.json',
      pkg: new Proxy({}, { get: (t, p) => typeof p === 'string' ? 'PKG/' + p + '.js' : undefined }),
      master: new Proxy({}, { get: (t, p) => typeof p === 'string' ? 'MASTER_KEY/' + p + '.js' : undefined })
    };
  `);
}
