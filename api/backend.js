export default function handler(req, res) {
  // ১. CORS হেডার সেট করা হচ্ছে যাতে অন্য ডোমেইন থেকে অ্যাক্সেস করা যায়
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // OPTIONS প্রি-ফ্লাইট রিকোয়েস্ট হ্যান্ডেল করা
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.setHeader('Content-Type', 'application/javascript');
  res.status(200).send(`
    // ২. স্ক্রিপ্টটি যেখান থেকে লোড হচ্ছে সেই অরিজিন এবং পাথ বের করা হচ্ছে
    const scriptSrc = document.currentScript ? document.currentScript.src : window.location.href;
    const url = new URL(scriptSrc);
    // api/backend.js থেকে api/ ফোল্ডার বাদ দিয়ে রুট পাথ তৈরি
    const basePath = url.origin + url.pathname.replace(/\/api\/backend$/, '/');
    
    window.URLS = {
      base: basePath,
      pkgRegistry: 'pkg.json',
      masterRegistry: 'master_key.json',
      pkg: new Proxy({}, { get: (t, p) => typeof p === 'string' ? 'PKG/' + p + '.js' : undefined }),
      master: new Proxy({}, { get: (t, p) => typeof p === 'string' ? 'MASTER_KEY/' + p + '.js' : undefined })
    };
  `);
}
