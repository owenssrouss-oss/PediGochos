const { execSync } = require('child_process');
const commits = execSync('git log --format="%H|%ad|%s" --date=short -n 50 -- db.json', { encoding: 'utf8' }).trim().split('\n');

for (const line of commits) {
  const [hash, date, msg] = line.split('|');
  try {
    const raw = execSync(`git show ${hash}:db.json`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const parsed = JSON.parse(raw);
    const ests = parsed.establishments || [];
    const withGps = ests.filter(e => e.latitude || e.location_lat);
    console.log(`\n-----------------------------------------`);
    console.log(`Commit: ${hash.slice(0, 7)} | Date: ${date} | Msg: ${msg}`);
    console.log(`Total Ests: ${ests.length} | With GPS: ${withGps.length}`);
    if (withGps.length > 0) {
      withGps.slice(0, 5).forEach(e => {
        console.log(`  - [${e.name}] lat: ${e.latitude || e.location_lat}, lng: ${e.longitude || e.location_lng}`);
      });
    }
  } catch(e) {
    console.log(`Error reading commit ${hash.slice(0,7)}: ${e.message}`);
  }
}
