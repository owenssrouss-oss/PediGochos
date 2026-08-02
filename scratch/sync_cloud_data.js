const fs = require('fs');
const path = require('path');

const url = 'https://bvdwxgfixirisqaavskj.supabase.co/storage/v1/object/public/menu_images/uploads/db_backup.json';
const DB_FILE = path.join(__dirname, '..', 'db.json');

async function run() {
  try {
    console.log('Downloading cloud backup from Supabase...');
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch cloud backup: ${res.statusText}`);
    }
    const cloudData = await res.json();
    console.log('Successfully downloaded cloud data!');
    
    // Find and rename the "prueba" establishment
    const targetId = 'prueba-1-1784000392371';
    const est = cloudData.establishments.find(e => e.id === targetId);
    if (est) {
      console.log('Found target establishment:', est.name);
      
      // Let's change name to something like "Sabor Larense" or "Comercio Express" 
      // or "PediGochos 1" or we can just name it "Sabor Larense"
      // Wait, let's name it "Sabor Larense" and ID "sabor-larense-1784000392371".
      est.name = 'Sabor Larense';
      est.id = 'sabor-larense-1784000392371';
      console.log('Renamed to name:', est.name, 'and ID:', est.id);
      
      // Also update any orders referencing this establishment ID!
      if (cloudData.orders) {
        cloudData.orders.forEach(order => {
          if (order.establishmentId === targetId) {
            order.establishmentId = est.id;
            order.establishmentName = est.name;
            console.log(`Updated order ${order.id} referencing old ID.`);
          }
        });
      }
    } else {
      console.log('Warning: Target establishment not found in backup.');
    }
    
    // Update lastUpdated timestamp to be extremely new (e.g. today)
    cloudData.lastUpdated = new Date().toISOString();
    
    // Save to local db.json
    fs.writeFileSync(DB_FILE, JSON.stringify(cloudData, null, 2), 'utf8');
    console.log('Successfully updated local db.json with cloud data and renamed establishment!');
    
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
