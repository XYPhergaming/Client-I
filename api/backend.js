export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  const host = req.headers.host ? `https://${req.headers.host}` : '';
  
  res.status(200).send(`
    window.URLS = {
      base: '${host}/',
      pkgRegistry: 'pkg.json',
      masterRegistry: 'master_key.json',
      pkg: new Proxy({}, { get: (t, p) => typeof p === 'string' ? 'PKG/' + p + '.js' : undefined }),
      master: new Proxy({}, { get: (t, p) => typeof p === 'string' ? 'MASTER_KEY/' + p + '.js' : undefined })
    };
  `);
}
