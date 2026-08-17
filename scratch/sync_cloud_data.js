const fs = require('fs');
const dotenv = require('dotenv');

if (fs.existsSync('.env')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env'));
  for (const k in envConfig) process.env[k] = envConfig[k];
}

async function syncAndCleanAll() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  
  console.log('Connecting to Supabase:', supabaseUrl);
  
  // 1. Fetch current Storage & Postgres
  const storageRes = await fetch(supabaseUrl + '/storage/v1/object/public/menu_images/db_backup.json');
  const storageData = await storageRes.json();
  const pgRes = await fetch(supabaseUrl + '/rest/v1/establishments', {
    headers: { 'Authorization': 'Bearer ' + anonKey, 'apikey': anonKey }
  });
  const pgData = await pgRes.json();

  const allPool = [...pgData, ...storageData.establishments];

  const GPS_BY_NAME = {
    'lacasadelosbatidos': { lat: 7.8140, lng: -72.4430 },
    'pataconfire': { lat: 7.8152, lng: -72.4428 },
    'tanosrestobar': { lat: 7.8145, lng: -72.4435 },
    'thanosrestobar': { lat: 7.8145, lng: -72.4435 },
    'mistercachapa': { lat: 7.8148, lng: -72.4455 },
    'latinosburguer': { lat: 7.8160, lng: -72.4450 },
    'gemapop': { lat: 7.8122, lng: -72.4435 },
    'frutyheladosgourmet': { lat: 7.8130, lng: -72.4425 },
    'makpizza': { lat: 7.8138, lng: -72.4420 },
    'karritosdemanuel': { lat: 7.8128, lng: -72.4451 },
    'carritosdemanuel': { lat: 7.8128, lng: -72.4451 },
    'saborvenezolanoarepas': { lat: 7.8135, lng: -72.4432 },
    'shawarmadunes': { lat: 7.8150, lng: -72.4438 },
    'bobyburgers': { lat: 7.8142, lng: -72.4445 },
    'zeusburger': { lat: 7.8158, lng: -72.4430 },
    'bokiarepas': { lat: 7.8155, lng: -72.4440 },
    'burgergrillpuentesucre': { lat: 7.8172, lng: -72.4425 },
    'muchosburguer': { lat: 7.8125, lng: -72.4440 },
    'luchosburguer': { lat: 7.8125, lng: -72.4440 },
    'luchosburger': { lat: 7.8125, lng: -72.4440 }
  };

  function norm(n) {
    return (n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  }

  const byNormName = new Map();

  allPool.forEach(est => {
    if (!est || !est.name) return;
    const n = norm(est.name);
    const existing = byNormName.get(n);
    const estProds = Array.isArray(est.products) ? est.products.length : 0;
    const existProds = (existing && Array.isArray(existing.products)) ? existing.products.length : -1;

    if (!existing || estProds > existProds) {
      byNormName.set(n, est);
    }
  });

  const finalEsts = [];
  const storeGpsObj = {};

  byNormName.forEach((est, n) => {
    if (n === 'muchosburguer' || n === 'luchosburger') {
      est.name = 'Luchos Burguer';
      est.linkKey = 'LUCHOS';
      est.id = 'luchos-burguer-1784912818841';
    }
    const coords = GPS_BY_NAME[n] || { lat: 7.8131, lng: -72.4439 };
    est.latitude = (est.latitude && !isNaN(est.latitude)) ? parseFloat(est.latitude) : coords.lat;
    est.longitude = (est.longitude && !isNaN(est.longitude)) ? parseFloat(est.longitude) : coords.lng;
    est.location_lat = est.latitude;
    est.location_lng = est.longitude;
    est.location = est.location || 'San Antonio';
    est.open_time = est.open_time || '17:00';
    est.close_time = est.close_time || '00:00';
    storeGpsObj[est.id] = { latitude: est.latitude, longitude: est.longitude };
    finalEsts.push(est);
    console.log(`✅ [${est.name}] | ID: ${est.id} | Key: ${est.linkKey} | Products: ${(est.products||[]).length} | GPS: ${est.latitude}, ${est.longitude}`);
  });

  // Preserve orders, drivers, reviews
  const localDb = JSON.parse(fs.readFileSync('db.json', 'utf8'));
  const fullCleanDb = {
    establishments: finalEsts,
    orders: localDb.orders || storageData.orders || [],
    drivers: localDb.drivers || storageData.drivers || [],
    reviews: localDb.reviews || storageData.reviews || [],
    promotions: localDb.promotions || storageData.promotions || [],
    lastUpdated: new Date().toISOString()
  };

  // Write local files
  fs.writeFileSync('db.json', JSON.stringify(fullCleanDb, null, 2), 'utf8');
  fs.writeFileSync('store_gps.json', JSON.stringify(storeGpsObj, null, 2), 'utf8');
  console.log('✅ Local db.json and store_gps.json updated successfully!');

  // 3. Upload to Supabase Storage
  const fileContent = JSON.stringify(fullCleanDb, null, 2);
  const upRootRes = await fetch(supabaseUrl + '/storage/v1/object/menu_images/db_backup.json', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + anonKey, 'apikey': anonKey, 'Content-Type': 'application/json', 'x-upsert': 'true' },
    body: fileContent
  });
  console.log('Storage upload root status:', upRootRes.status);

  const upUploadsRes = await fetch(supabaseUrl + '/storage/v1/object/menu_images/uploads/db_backup.json', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + anonKey, 'apikey': anonKey, 'Content-Type': 'application/json', 'x-upsert': 'true' },
    body: fileContent
  });
  console.log('Storage upload uploads status:', upUploadsRes.status);

  // 4. Update Postgres: Clear old stubs & upsert clean establishments
  const validIds = finalEsts.map(e => e.id);

  // Upsert all valid establishments to Postgres with only supported columns
  const PG_COLS = ['id', 'name', 'category', 'description', 'logo', 'bannerType', 'banner', 'linkKey', 'delivery_fee', 'themeColor', 'logoImage', 'tables', 'layout', 'products', 'prep_time', 'delivery_time', 'location'];
  const normalizedEsts = finalEsts.map(est => {
    const obj = {};
    PG_COLS.forEach(col => {
      if (est[col] !== undefined) obj[col] = est[col];
    });
    return obj;
  });

  const pgUpsertRes = await fetch(supabaseUrl + '/rest/v1/establishments', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + anonKey, 'apikey': anonKey, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(normalizedEsts)
  });
  console.log('Postgres upsert status:', pgUpsertRes.status);

  // Remove any obsolete stub records from Postgres
  const currentPgRes = await fetch(supabaseUrl + '/rest/v1/establishments?select=id', {
    headers: { 'Authorization': 'Bearer ' + anonKey, 'apikey': anonKey }
  });
  if (currentPgRes.ok) {
    const currentList = await currentPgRes.json();
    const toDelete = currentList.filter(e => !validIds.includes(e.id)).map(e => e.id);
    if (toDelete.length > 0) {
      console.log('Deleting obsolete stubs from Postgres:', toDelete);
      for (const id of toDelete) {
        await fetch(`${supabaseUrl}/rest/v1/establishments?id=eq.${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + anonKey, 'apikey': anonKey }
        });
      }
    }
  }

  console.log('🎉 Full Cloud Sync & Cleanup Completed successfully!');
}

syncAndCleanAll().catch(console.error);
