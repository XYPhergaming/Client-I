export default function handler(req, res) {
  // CORS হেডার সেট করা হচ্ছে যাতে যেকোনো ডোমেইন থেকে ডেটা লোড করা যায়
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`
    const scriptSrc = document.currentScript ? document.currentScript.src : window.location.href;
    const url = new URL(scriptSrc);
    
    // Regex এর পরিবর্তে সাধারণ স্ট্রিং রিপ্লেস ব্যবহার করা হলো (এরর দূর করার জন্য)
    let path = url.pathname.replace('/api/backend', '');
    if (!path.endsWith('/')) path += '/';
    const basePath = url.origin + path;
    
    window.URLS = {
      base: basePath,
      pkgRegistry: 'pkg.json',
      masterRegistry: 'master_key.json',
      pkg: new Proxy({}, { get: (t, prop) => typeof prop === 'string' ? 'PKG/' + prop + '.js' : undefined }),
      master: new Proxy({}, { get: (t, prop) => typeof prop === 'string' ? 'MASTER_KEY/' + prop + '.js' : undefined })
    };
  `);
}
