export default function handler(req, res) {
  // CORS হেডার
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`
    let scriptSrc = '';
    if (document.currentScript && document.currentScript.src) {
      scriptSrc = document.currentScript.src;
    } else {
      scriptSrc = window.location.href;
    }
    
    let basePath = window.location.origin + '/';
    try {
      const url = new URL(scriptSrc);
      // Regex নিশ্চিত করবে যে .js থাকুক বা না থাকুক সঠিক পাথ বের হবে
      let path = url.pathname.replace(/\\/api\\/backend(\\.js)?$/, '');
      if (!path.endsWith('/')) path += '/';
      
      if (url.protocol === 'file:') {
        basePath = 'file://' + path;
      } else {
        basePath = url.origin + path;
      }
    } catch (e) {
      // কোনো কারণে এরর হলে ফলব্যাক
      basePath = window.location.origin + '/';
    }
    
    window.URLS = {
      base: basePath,
      pkgRegistry: 'pkg.json',
      masterRegistry: 'master_key.json',
      pkg: new Proxy({}, { get: (t, prop) => typeof prop === 'string' ? 'PKG/' + prop + '.js' : undefined }),
      master: new Proxy({}, { get: (t, prop) => typeof prop === 'string' ? 'MASTER_KEY/' + prop + '.js' : undefined })
    };
  `);
}
