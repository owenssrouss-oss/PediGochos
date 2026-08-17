const https = require('https');

function testEndpoint(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('Testing live Render endpoint...');
  try {
    const data = await testEndpoint('https://pedigochos.onrender.com/api/establishments');
    if (Array.isArray(data)) {
      console.log('Total live establishments returned:', data.length);
      data.forEach(e => {
        console.log(`- [${e.name}] id: ${e.id} | GPS: ${e.latitude}, ${e.longitude} | loc: ${e.location}`);
      });
    } else {
      console.log('Live response:', data);
    }
  } catch(e) {
    console.error('Error fetching live Render:', e.message);
  }
}

run();
