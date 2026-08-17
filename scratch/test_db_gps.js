const fs = require('fs');
const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));
const gps = JSON.parse(fs.readFileSync('store_gps.json', 'utf8'));
console.log('Total establishments in db.json:', db.establishments.length);
db.establishments.forEach(e => {
  console.log(`- [${e.name}] ID: ${e.id} -> lat: ${e.latitude}, lng: ${e.longitude}`);
});
