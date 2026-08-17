const fs = require('fs');
const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));
db.establishments.forEach((e, idx) => {
  console.log(`${idx + 1}. [${e.name}]`);
  console.log(`   ID: ${e.id}`);
  console.log(`   Key: ${e.linkKey}`);
  console.log(`   Category: ${e.category}`);
  console.log(`   Location: ${e.location}`);
  console.log(`   GPS: ${e.latitude}, ${e.longitude}`);
  console.log(`   Disabled: ${e.disabled}`);
  console.log(`   Products Count: ${(e.products || []).length}`);
  console.log(`   Logo: ${e.logo}`);
});
