require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// Write uncaught errors to debug_logs.txt
process.on('uncaughtException', (err) => {
  const time = new Date().toISOString();
  fs.appendFileSync(path.join(__dirname, 'debug_logs.txt'), `[${time}] [UNCAUGHT EXCEPTION] ${err.stack || err}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  const time = new Date().toISOString();
  fs.appendFileSync(path.join(__dirname, 'debug_logs.txt'), `[${time}] [UNHANDLED REJECTION] ${reason.stack || reason}\n`);
});

// Helper function to log application errors
function logAppError(context, err) {
  const time = new Date().toISOString();
  fs.appendFileSync(path.join(__dirname, 'debug_logs.txt'), `[${time}] [${context}] ${err.stack || err}\n`);
}

// Endpoint to view server logs
app.get('/api/debug/logs', (req, res) => {
  const logFile = path.join(__dirname, 'debug_logs.txt');
  if (fs.existsSync(logFile)) {
    res.type('text/plain').send(fs.readFileSync(logFile, 'utf8'));
  } else {
    res.send('No logs yet.');
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Helper functions for Database read/write
const DISABLED_STORES_FILE = path.join(__dirname, 'disabled_stores.json');

function readDisabledStores() {
  try {
    if (fs.existsSync(DISABLED_STORES_FILE)) {
      return JSON.parse(fs.readFileSync(DISABLED_STORES_FILE, 'utf8')) || {};
    }
  } catch (e) {
    console.error('Error reading disabled_stores.json:', e);
  }
  return {};
}

function writeDisabledStores(map) {
  try {
    fs.writeFileSync(DISABLED_STORES_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing disabled_stores.json:', e);
  }
}

const STORE_GPS_FILE = path.join(__dirname, 'store_gps.json');

function readStoreGps() {
  try {
    if (fs.existsSync(STORE_GPS_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_GPS_FILE, 'utf8')) || {};
    }
  } catch (e) {
    console.error('Error reading store_gps.json:', e);
  }
  return {};
}

function writeStoreGps(map) {
  try {
    fs.writeFileSync(STORE_GPS_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing store_gps.json:', e);
  }
}

// GPS Deleted Blacklist: tracks establishments whose GPS was explicitly removed
const GPS_DELETED_FILE = path.join(__dirname, 'gps_deleted.json');

function readGpsDeleted() {
  try {
    if (fs.existsSync(GPS_DELETED_FILE)) {
      return JSON.parse(fs.readFileSync(GPS_DELETED_FILE, 'utf8')) || {};
    }
  } catch (e) {
    console.error('Error reading gps_deleted.json:', e);
  }
  return {};
}

function writeGpsDeleted(map) {
  try {
    fs.writeFileSync(GPS_DELETED_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing gps_deleted.json:', e);
  }
}

const DRIVERS_FILE = path.join(__dirname, 'drivers.json');

function readDrivers() {
  try {
    if (fs.existsSync(DRIVERS_FILE)) {
      return JSON.parse(fs.readFileSync(DRIVERS_FILE, 'utf8')) || [];
    }
  } catch (e) {
    console.error('Error reading drivers.json:', e);
  }
  return [];
}

function writeDrivers(drivers) {
  try {
    if (Array.isArray(drivers)) {
      fs.writeFileSync(DRIVERS_FILE, JSON.stringify(drivers, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('Error writing drivers.json:', e);
  }
}

async function syncFromSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.log('Supabase env vars missing. Skipping cloud DB sync.');
    return;
  }
  try {
    const rootUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/menu_images/db_backup.json`;
    const uploadsUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/menu_images/uploads/db_backup.json`;
    console.log('Syncing database state from Supabase:', rootUrl);
    let res = await fetch(rootUrl);
    if (!res.ok) {
      console.log('Trying uploads path fallback:', uploadsUrl);
      res = await fetch(uploadsUrl);
    }
    if (res.ok) {
      const text = await res.text();
      const cloudData = JSON.parse(text);
      if (cloudData && Array.isArray(cloudData.establishments) && cloudData.establishments.length > 0) {
        const localData = readDB();
        const localEsts = (localData && Array.isArray(localData.establishments)) ? localData.establishments : [];
        const cloudEstIds = new Set(cloudData.establishments.map(e => String(e.id).trim()));
        localEsts.forEach(localEst => {
          if (localEst && localEst.id && !cloudEstIds.has(String(localEst.id).trim())) {
            console.log(`📌 Preserving local establishment [${localEst.id}] (${localEst.name}) during Storage sync!`);
            cloudData.establishments.push(localEst);
          }
        });
        // Deduplicate before saving
        const seenIds = new Set();
        cloudData.establishments = cloudData.establishments.filter(e => {
          if (!e || !e.id) return false;
          const sid = String(e.id).trim();
          if (seenIds.has(sid)) return false;
          seenIds.add(sid);
          return true;
        });
        fs.writeFileSync(DB_FILE, JSON.stringify(cloudData, null, 2), 'utf8');
        console.log('🎉 Database synced successfully from Supabase Storage!');
      }
    } else {
      console.log('No backup db.json found in Supabase Storage or request failed. Status:', res.status);
    }

    try {
      const disabledUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/menu_images/disabled_stores.json`;
      const disRes = await fetch(disabledUrl);
      if (disRes.ok) {
        try {
          const cloudDisabled = await disRes.json();
          const localDisabled = readDisabledStores();
          const mergedDisabled = { ...cloudDisabled, ...localDisabled };
          writeDisabledStores(mergedDisabled);
          console.log('🎉 disabled_stores.json restored and merged from Supabase Storage!');
        } catch(e) {}
      }

      const gpsUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/menu_images/store_gps.json`;
      const gpsRes = await fetch(gpsUrl);
      if (gpsRes.ok) {
        try {
          const cloudGps = await gpsRes.json();
          const localGps = readStoreGps();
          const mergedGps = { ...cloudGps, ...localGps };
          writeStoreGps(mergedGps);
          console.log('🎉 store_gps.json restored and merged from Supabase Storage!');
        } catch(e) {}
      }

      const drvUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/menu_images/drivers.json`;
      const drvRes = await fetch(drvUrl);
      if (drvRes.ok) {
        const drvText = await drvRes.text();
        const cloudDrivers = JSON.parse(drvText);
        if (Array.isArray(cloudDrivers) && cloudDrivers.length > 0) {
          const localDrivers = readDrivers();
          const cloudPhones = new Set(cloudDrivers.map(d => d.phone));
          localDrivers.forEach(ld => {
            if (ld && ld.phone && !cloudPhones.has(ld.phone)) {
              cloudDrivers.push(ld);
            }
          });
          writeDrivers(cloudDrivers);
          console.log('🎉 drivers.json restored from Supabase Storage!');
        }
      }

      const gpsDeletedUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/menu_images/gps_deleted.json`;
      const gpsDelRes = await fetch(gpsDeletedUrl);
      if (gpsDelRes.ok) {
        try {
          const cloudGpsDel = await gpsDelRes.json();
          const localGpsDel = readGpsDeleted();
          // Merge: local entries win (local deletions stay), cloud deletions also respected
          const mergedGpsDel = { ...cloudGpsDel, ...localGpsDel };
          writeGpsDeleted(mergedGpsDel);
          // Remove any entries in storeGpsMap that are in the deleted blacklist
          const storeGpsMap = readStoreGps();
          let gpsDirty = false;
          Object.keys(mergedGpsDel).forEach(delId => {
            if (storeGpsMap[delId]) {
              delete storeGpsMap[delId];
              gpsDirty = true;
            }
          });
          if (gpsDirty) writeStoreGps(storeGpsMap);
          console.log('🎉 gps_deleted.json restored and merged from Supabase Storage!');
        } catch(e) {}
      }
    } catch(e) {}
  } catch (err) {
    console.error('Error syncing database from Supabase:', err);
  }
}

async function uploadToSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return;
  try {
    const fileContent = fs.readFileSync(DB_FILE, 'utf8');
    const headers = {
      'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      'apikey': process.env.SUPABASE_ANON_KEY,
      'x-upsert': 'true',
      'Content-Type': 'application/json'
    };
    const promises = [
      fetch(`${process.env.SUPABASE_URL}/storage/v1/object/menu_images/db_backup.json`, { method: 'POST', headers, body: fileContent }),
      fetch(`${process.env.SUPABASE_URL}/storage/v1/object/menu_images/uploads/db_backup.json`, { method: 'POST', headers, body: fileContent })
    ];

    if (fs.existsSync(DISABLED_STORES_FILE)) {
      const disabledContent = fs.readFileSync(DISABLED_STORES_FILE, 'utf8');
      promises.push(fetch(`${process.env.SUPABASE_URL}/storage/v1/object/menu_images/disabled_stores.json`, { method: 'POST', headers, body: disabledContent }));
    }

    if (fs.existsSync(STORE_GPS_FILE)) {
      const gpsContent = fs.readFileSync(STORE_GPS_FILE, 'utf8');
      promises.push(fetch(`${process.env.SUPABASE_URL}/storage/v1/object/menu_images/store_gps.json`, { method: 'POST', headers, body: gpsContent }));
    }

    if (fs.existsSync(DRIVERS_FILE)) {
      const driversContent = fs.readFileSync(DRIVERS_FILE, 'utf8');
      promises.push(fetch(`${process.env.SUPABASE_URL}/storage/v1/object/menu_images/drivers.json`, { method: 'POST', headers, body: driversContent }));
    }

    if (fs.existsSync(GPS_DELETED_FILE)) {
      const gpsDeletedContent = fs.readFileSync(GPS_DELETED_FILE, 'utf8');
      promises.push(fetch(`${process.env.SUPABASE_URL}/storage/v1/object/menu_images/gps_deleted.json`, { method: 'POST', headers, body: gpsDeletedContent }));
    }

    await Promise.all(promises);
    console.log('☁️ Database state, disabled stores, GPS & Drivers backup updated successfully in Supabase Storage!');
  } catch (err) {
    console.error('Error backing up database to Supabase:', err);
    logAppError('uploadToSupabase', err);
  }
}

// Sync database state from Supabase PostgreSQL tables
async function syncFromPostgres() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.log('Supabase env vars missing. Skipping Postgres sync.');
    return false;
  }
  try {
    const estUrl = `${process.env.SUPABASE_URL}/rest/v1/establishments`;
    const ordUrl = `${process.env.SUPABASE_URL}/rest/v1/orders`;
    const headers = {
      'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      'apikey': process.env.SUPABASE_ANON_KEY
    };

    console.log('Syncing database state from Supabase PostgreSQL...');
    const [estRes, ordRes] = await Promise.all([
      fetch(estUrl, { headers }),
      fetch(ordUrl, { headers })
    ]);

    if (estRes.ok && ordRes.ok) {
      const establishments = await estRes.json();
      const orders = await ordRes.json();

      if (establishments && Array.isArray(establishments) && establishments.length > 0) {
        const localData = readDB();
        const localEsts = (localData && Array.isArray(localData.establishments)) ? localData.establishments : [];

        const disabledMap = readDisabledStores();
        const storeGpsMap = readStoreGps();
        // Preserve local disabled state and exact GPS coordinates
        establishments.forEach(est => {
          const localMatch = localEsts.find(l => l.id === est.id);
          // Bulletproof Disabled State Preservation: Never un-disable a locally disabled store
          const isLocallyDisabled = disabledMap[est.id] === true || (localMatch && localMatch.disabled === true);
          if (isLocallyDisabled) {
            est.disabled = true;
            disabledMap[est.id] = true;
          } else if (est.disabled !== undefined) {
            est.disabled = Boolean(est.disabled);
            disabledMap[est.id] = est.disabled;
          }

          // GPS Deletion Blacklist: if GPS was explicitly deleted by admin, never restore it
          const gpsDeletedMap = readGpsDeleted();
          if (gpsDeletedMap[est.id]) {
            est.latitude = null;
            est.longitude = null;
            est.location_lat = null;
            est.location_lng = null;
            delete storeGpsMap[est.id];
          } else {
            // Bulletproof GPS Preservation: Never overwrite valid GPS with null or 0
            const hasGpsMap = storeGpsMap[est.id] && storeGpsMap[est.id].latitude && storeGpsMap[est.id].longitude;
            const hasLocalMatchGps = localMatch && localMatch.latitude && localMatch.longitude;
            if (hasGpsMap) {
              est.latitude = parseFloat(storeGpsMap[est.id].latitude);
              est.longitude = parseFloat(storeGpsMap[est.id].longitude);
              est.location_lat = est.latitude;
              est.location_lng = est.longitude;
            } else if (hasLocalMatchGps) {
              est.latitude = parseFloat(localMatch.latitude);
              est.longitude = parseFloat(localMatch.longitude);
              est.location_lat = est.latitude;
              est.location_lng = est.longitude;
              storeGpsMap[est.id] = { latitude: est.latitude, longitude: est.longitude };
            } else if (est.latitude && est.longitude) {
              est.latitude = parseFloat(est.latitude);
              est.longitude = parseFloat(est.longitude);
              est.location_lat = est.latitude;
              est.location_lng = est.longitude;
              storeGpsMap[est.id] = { latitude: est.latitude, longitude: est.longitude };
            }
          }
        });
        // Preserve local establishments that are not yet in Supabase/Postgres
        const cloudEstIds = new Set(establishments.map(e => String(e.id).trim()));
        localEsts.forEach(localEst => {
          if (localEst && localEst.id && !cloudEstIds.has(String(localEst.id).trim())) {
            console.log(`📌 Preserving local establishment [${localEst.id}] (${localEst.name}) during Postgres sync!`);
            establishments.push(localEst);
          }
        });

        writeDisabledStores(disabledMap);
        writeStoreGps(storeGpsMap);

        const existingDrivers = (localData && Array.isArray(localData.drivers) && localData.drivers.length > 0)
          ? localData.drivers
          : readDrivers();
        const existingReviews = (localData && Array.isArray(localData.reviews)) ? localData.reviews : [];
        const existingPromos = (localData && Array.isArray(localData.promotions)) ? localData.promotions : [];

        const dbState = {
          establishments: establishments,
          orders: orders || [],
          drivers: existingDrivers,
          reviews: existingReviews,
          promotions: existingPromos,
          lastUpdated: new Date().toISOString()
        };
        // Deduplicate establishments before writing to disk
        const seenPgIds = new Set();
        dbState.establishments = establishments.filter(e => {
          if (!e || !e.id) return false;
          const sid = String(e.id).trim();
          if (seenPgIds.has(sid)) return false;
          seenPgIds.add(sid);
          return true;
        });
        fs.writeFileSync(DB_FILE, JSON.stringify(dbState, null, 2), 'utf8');
        writeDrivers(existingDrivers);
        console.log('🎉 Database synced successfully from Supabase PostgreSQL tables!');
      }
      return true;
    } else {
      console.log(`Supabase PostgreSQL tables might not be created yet. Status: ${estRes.status} / ${ordRes.status}`);
      console.log('Please run the database script "supabase_setup_tables.sql" in your Supabase SQL Editor.');
      return false;
    }
  } catch (err) {
    console.error('Error syncing database from Supabase PostgreSQL:', err);
    logAppError('syncFromPostgres', err);
    return false;
  }
}

// Backup database state to Supabase PostgreSQL tables
async function saveToPostgres() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return;
  try {
    const localData = readDB();
    const headers = {
      'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      'apikey': process.env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    };

    // 1. Bulk Upsert Establishments
    if (localData.establishments && localData.establishments.length > 0) {
      const normalizedEsts = localData.establishments.map(est => ({
        id: est.id,
        name: est.name || '',
        category: est.category || '',
        description: est.description || null,
        logo: est.logo || null,
        bannerType: est.bannerType || null,
        banner: est.banner || null,
        linkKey: est.linkKey || null,
        delivery_fee: est.delivery_fee !== undefined ? parseFloat(est.delivery_fee) : 0,
        themeColor: est.themeColor || null,
        logoImage: est.logoImage || null,
        disabled: Boolean(est.disabled),
        tables: est.tables || [],
        layout: est.layout || [],
        products: est.products || [],
        prep_time: est.prep_time !== undefined ? est.prep_time : null,
        delivery_time: est.delivery_time !== undefined ? est.delivery_time : null,
        location: est.location || 'San Antonio',
        latitude: est.latitude || null,
        longitude: est.longitude || null,
        location_lat: est.location_lat || null,
        location_lng: est.location_lng || null,
        open_time: est.open_time || '17:00',
        close_time: est.close_time || '00:00',
        isHighTraffic: Boolean(est.isHighTraffic),
        extraPrepTime: est.extraPrepTime || 20
      }));

      const estRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/establishments`, {
        method: 'POST',
        headers,
        body: JSON.stringify(normalizedEsts)
      });
      if (!estRes.ok) {
        const errText = await estRes.text();
        console.error('Failed to upsert establishments to Postgres:', estRes.status, errText);
        logAppError('saveToPostgres_establishments_http_error', new Error(`Status: ${estRes.status}, Body: ${errText}`));
      }
    }



    // 2. Bulk Upsert Orders
    if (localData.orders && localData.orders.length > 0) {
      const normalizedOrders = localData.orders.map(ord => ({
        id: ord.id,
        establishmentId: ord.establishmentId || null,
        establishmentName: ord.establishmentName || null,
        items: ord.items || [],
        total: ord.total !== undefined ? parseFloat(ord.total) : 0,
        orderType: ord.orderType || null,
        customerName: ord.customerName || null,
        tableNumber: ord.tableNumber || null,
        deliveryDetails: ord.deliveryDetails || {},
        status: ord.status || 'Pendiente',
        cancelReason: ord.cancelReason || null,
        paymentStatus: ord.paymentStatus || 'Pendiente',
        createdAt: ord.createdAt || new Date().toISOString(),
        updatedAt: ord.updatedAt || new Date().toISOString()
      }));

      const ordRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify(normalizedOrders)
      });
      if (!ordRes.ok) {
        const errText = await ordRes.text();
        console.error('Failed to upsert orders to Postgres:', ordRes.status, errText);
        logAppError('saveToPostgres_orders_http_error', new Error(`Status: ${ordRes.status}, Body: ${errText}`));
      }
    }

    // 3. Delete removed orders from PostgreSQL
    const cloudOrdRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?select=id`, {
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'apikey': process.env.SUPABASE_ANON_KEY
      }
    });
    if (cloudOrdRes.ok) {
      const cloudOrds = await cloudOrdRes.json();
      const localOrderIds = new Set((localData.orders || []).map(o => o.id));
      const deletedOrderIds = cloudOrds.map(o => o.id).filter(id => !localOrderIds.has(id));
      if (deletedOrderIds.length > 0) {
        console.log('Deleting removed orders from Postgres:', deletedOrderIds);
        const delUrl = `${process.env.SUPABASE_URL}/rest/v1/orders?id=in.(${deletedOrderIds.map(id => `"${id}"`).join(',')})`;
        await fetch(delUrl, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'apikey': process.env.SUPABASE_ANON_KEY
          }
        });
      }
    }

    console.log('☁️ Database state backup updated successfully in Supabase PostgreSQL tables!');
  } catch (err) {
    console.error('Error backing up database to Supabase PostgreSQL:', err);
    logAppError('saveToPostgres', err);
  }
}

// Permanently delete an establishment from Supabase PostgreSQL tables
async function deleteEstablishmentFromPostgres(id) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !id) return;
  try {
    const url = `${process.env.SUPABASE_URL}/rest/v1/establishments?id=eq.${encodeURIComponent(id)}`;
    const headers = {
      'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      'apikey': process.env.SUPABASE_ANON_KEY
    };
    const res = await fetch(url, { method: 'DELETE', headers });
    if (res.ok) {
      console.log(`🗑️ Successfully deleted establishment [${id}] from Supabase PostgreSQL!`);
    } else {
      console.error(`Failed to delete establishment [${id}] from Postgres:`, res.status, await res.text());
    }
  } catch (err) {
    console.error('Error in deleteEstablishmentFromPostgres:', err);
    logAppError('deleteEstablishmentFromPostgres', err);
  }
}

function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { establishments: [], orders: [], reviews: [], drivers: [] };
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(data);
    if (!db.reviews) db.reviews = [];
    if (!db.drivers || db.drivers.length === 0) {
      db.drivers = readDrivers();
    } else {
      writeDrivers(db.drivers);
    }
    if (!db.promotions) db.promotions = [];

    // Filter out promotions older than 24h
    const nowMs = Date.now();
    db.promotions = db.promotions.filter(p => {
      const createdAtMs = new Date(p.createdAt || p.created_at || nowMs).getTime();
      return (nowMs - createdAtMs) < (24 * 60 * 60 * 1000);
    });

    const disabledMap = readDisabledStores();
    const storeGpsMap = readStoreGps();

    if (db && Array.isArray(db.establishments)) {
      const seenIds = new Set();
      const uniqueEsts = [];
      db.establishments.forEach(est => {
        if (!est || !est.id) return;
        const estIdStr = String(est.id).trim();
        if (!seenIds.has(estIdStr)) {
          seenIds.add(estIdStr);
          uniqueEsts.push(est);
        } else {
          // If a duplicate exists in db.json, keep the one with more products/data
          const existingIdx = uniqueEsts.findIndex(u => String(u.id).trim() === estIdStr);
          if (existingIdx !== -1) {
            const existing = uniqueEsts[existingIdx];
            const existingProdCount = Array.isArray(existing.products) ? existing.products.length : 0;
            const newProdCount = Array.isArray(est.products) ? est.products.length : 0;
            if (newProdCount > existingProdCount) {
              uniqueEsts[existingIdx] = est;
            }
          }
        }
      });
        const hadDuplicates = db.establishments.length !== uniqueEsts.length;
      db.establishments = uniqueEsts;

      db.establishments.forEach(est => {
        if (disabledMap[est.id] !== undefined) {
          est.disabled = Boolean(disabledMap[est.id]);
        } else {
          est.disabled = Boolean(est.disabled);
        }
        // Respect GPS deleted blacklist - never restore GPS for explicitly deleted entries
        const gpsDeletedMap = readGpsDeleted();
        if (gpsDeletedMap[est.id]) {
          est.latitude = null;
          est.longitude = null;
          est.location_lat = null;
          est.location_lng = null;
        } else if (storeGpsMap[est.id] && storeGpsMap[est.id].latitude && storeGpsMap[est.id].longitude) {
          est.latitude = parseFloat(storeGpsMap[est.id].latitude);
          est.longitude = parseFloat(storeGpsMap[est.id].longitude);
          est.location_lat = est.latitude;
          est.location_lng = est.longitude;
        }
        if (!est.open_time || est.open_time === '11:00') {
          est.open_time = '17:00';
        }
        if (!est.close_time || est.close_time === '23:00') {
          est.close_time = '00:00';
        }
      });

      // Auto-heal: if we found duplicates, save the clean version back to disk immediately
      if (hadDuplicates) {
        console.log(`🧹 readDB: Found and removed ${db.establishments.length} duplicates from db.json — auto-healing file.`);
        try {
          fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
        } catch(e) {
          console.error('Failed to auto-heal db.json duplicates:', e);
        }
      }
    }
    return db;
  } catch (err) {
    console.error('Error reading DB:', err);
    logAppError('readDB', err);
    return { establishments: [], orders: [], reviews: [], drivers: readDrivers() };
  }
}

function writeDB(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    if (data) {
      if (Array.isArray(data.drivers) && data.drivers.length > 0) {
        writeDrivers(data.drivers);
      } else {
        data.drivers = readDrivers();
      }

      if (Array.isArray(data.establishments)) {
        const disabledMap = readDisabledStores();
        const storeGpsMap = readStoreGps();
        data.establishments.forEach(est => {
          if (disabledMap[est.id] !== undefined) {
            est.disabled = Boolean(disabledMap[est.id]);
          } else if (est.disabled !== undefined) {
            disabledMap[est.id] = Boolean(est.disabled);
          }

          // If est has GPS explicitly cleared (null), remove from storeGpsMap too
          if (est.latitude === null && est.longitude === null) {
            delete storeGpsMap[est.id];
          } else if (storeGpsMap[est.id] && storeGpsMap[est.id].latitude && storeGpsMap[est.id].longitude) {
            est.latitude = parseFloat(storeGpsMap[est.id].latitude);
            est.longitude = parseFloat(storeGpsMap[est.id].longitude);
            est.location_lat = est.latitude;
            est.location_lng = est.longitude;
          } else if (est.latitude && est.longitude) {
            storeGpsMap[est.id] = {
              latitude: parseFloat(est.latitude),
              longitude: parseFloat(est.longitude)
            };
          }
        });
        writeDisabledStores(disabledMap);
        writeStoreGps(storeGpsMap);

        // Deduplicate establishments before writing to disk
        const seenWriteIds = new Set();
        const dedupedEsts = [];
        data.establishments.forEach(est => {
          if (!est || !est.id) return;
          const sid = String(est.id).trim();
          if (!seenWriteIds.has(sid)) {
            seenWriteIds.add(sid);
            dedupedEsts.push(est);
          }
        });
        if (dedupedEsts.length !== data.establishments.length) {
          console.log(`🧹 writeDB: Removed ${data.establishments.length - dedupedEsts.length} duplicate establishments before saving.`);
        }
        data.establishments = dedupedEsts;
      }
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    // NOTE: Cloud backup (uploadToSupabase + saveToPostgres) is now MANUAL ONLY
    // Triggered via POST /api/cloud/save endpoint, not automatically on every write
  } catch (err) {
    console.error('Error writing DB:', err);
    logAppError('writeDB', err);
  }
}

// Owner Master Key Configuration
const OWNER_PASSWORDS = ['0424', 'DUEÑO123', 'DUENO123', 'OWNER123'];

// REST API Endpoints
// Verify Owner login and return complete establishments list with keys
app.post('/api/owner/login', (req, res) => {
  const { password } = req.body;
  const normalizedInput = password ? password.trim().toUpperCase() : '';
  
  console.log(`Intento de login de dueño: "${password}" (normalizado: "${normalizedInput}")`);

  if (OWNER_PASSWORDS.includes(normalizedInput)) {
    const db = readDB();
    res.json({ success: true, establishments: db.establishments });
  } else {
    res.status(401).json({ success: false, error: 'Clave de Dueño incorrecta' });
  }
});

// Manual Cloud Save - Only called when admin clicks "💾 Guardar Cambios" button
app.post('/api/cloud/save', async (req, res) => {
  try {
    console.log('☁️ Manual cloud save triggered by admin...');
    await Promise.all([uploadToSupabase(), saveToPostgres()]);
    console.log('☁️ Manual cloud save completed successfully.');
    res.json({ success: true, message: 'Datos guardados en la nube exitosamente.' });
  } catch (err) {
    console.error('Error during manual cloud save:', err);
    logAppError('manual_cloud_save', err);
    res.status(500).json({ success: false, error: 'Error al guardar en la nube.' });
  }
});

// Verify Merchant login by linkKey and return establishment info
app.post('/api/merchant/login', (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, error: 'La clave de vinculación es requerida' });
  }
  const normalizedKey = key.trim().toUpperCase();
  const db = readDB();
  const est = db.establishments.find(e => e.linkKey === normalizedKey);
  
  if (est) {
    res.json({ success: true, establishment: est });
  } else {
    res.status(401).json({ success: false, error: 'Clave de vinculación incorrecta' });
  }
});

// Get system settings (including central delivery headquarters)
app.get('/api/settings', (req, res) => {
  const db = readDB();
  db.settings = db.settings || {
    central_delivery_lat: null,
    central_delivery_lng: null,
    central_delivery_name: 'Sede Central'
  };
  res.json(db.settings);
});

// Update system settings (App Owner / Admin)
app.put('/api/settings', (req, res) => {
  const { central_delivery_lat, central_delivery_lng, central_delivery_name } = req.body;
  const db = readDB();
  db.settings = db.settings || {};

  if (central_delivery_lat !== undefined) db.settings.central_delivery_lat = (central_delivery_lat !== null && central_delivery_lat !== '') ? parseFloat(central_delivery_lat) : null;
  if (central_delivery_lng !== undefined) db.settings.central_delivery_lng = (central_delivery_lng !== null && central_delivery_lng !== '') ? parseFloat(central_delivery_lng) : null;
  if (central_delivery_name) db.settings.central_delivery_name = central_delivery_name;

  writeDB(db);
  res.json({ success: true, settings: db.settings });
});

// Get all establishments (Sanitized for habitual users)
app.get('/api/establishments', (req, res) => {
  const db = readDB();
  // Strip linkKey before sending to client for security
  const sanitized = db.establishments.map(({ linkKey, ...rest }) => rest);
  res.json(sanitized);
});

// Get all establishments with linkKeys (For Platform Owner only)
app.get('/api/owner/establishments', (req, res) => {
  const db = readDB();
  res.json(db.establishments);
});

// Register a new establishment
app.post('/api/establishments', (req, res) => {
  const db = readDB();
  const newEstablishment = req.body;

  // Simple validation
  if (!newEstablishment.name || !newEstablishment.category) {
    return res.status(400).json({ error: 'Name and category are required' });
  }

  // Generate unique ID
  const id = newEstablishment.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
  newEstablishment.id = id;
  
  // Set default products if none provided
  if (!newEstablishment.products || newEstablishment.products.length === 0) {
    newEstablishment.products = [];
  }

  // Save/generate the administration key
  newEstablishment.linkKey = newEstablishment.linkKey || Math.random().toString(36).substring(2, 8).toUpperCase();
  newEstablishment.location = newEstablishment.location || 'San Antonio';
  newEstablishment.open_time = newEstablishment.open_time || '17:00';
  newEstablishment.close_time = newEstablishment.close_time || '00:00';

  if (newEstablishment.latitude && newEstablishment.longitude) {
    const storeGpsMap = readStoreGps();
    storeGpsMap[id] = { latitude: parseFloat(newEstablishment.latitude), longitude: parseFloat(newEstablishment.longitude) };
    writeStoreGps(storeGpsMap);
  }

  db.establishments.push(newEstablishment);
  writeDB(db);

  // Return the establishment including linkKey on initial creation so the registrar knows it
  res.status(201).json(newEstablishment);
});

// Get all orders
app.get('/api/orders', (req, res) => {
  const db = readDB();
  res.json(db.orders);
});

// WebSocket connection handling
// We store active merchant connections grouped by establishment ID
// Map: establishmentId -> Set of WS Client connections
const merchantConnections = new Map();

wss.on('connection', (ws) => {
  let registeredId = null;

  console.log('New WebSocket connection established');

  ws.on('message', (messageStr) => {
    try {
      const message = JSON.parse(messageStr);
      console.log('WS Message Received:', message);

      if (message.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
        return;
      }

      if (message.type === 'REGISTER_MERCHANT') {
        const { establishmentId, key } = message;
        
        // Authenticate merchant using their linking key
        const db = readDB();
        const est = db.establishments.find(e => e.id === establishmentId);
        
        if (!est || est.linkKey !== key) {
          ws.send(JSON.stringify({ 
            type: 'AUTH_ERROR', 
            message: 'Clave de administración incorrecta. No tienes permisos para gestionar este comercio.' 
          }));
          return;
        }

        registeredId = establishmentId;
        
        if (!merchantConnections.has(establishmentId)) {
          merchantConnections.set(establishmentId, new Set());
        }
        merchantConnections.get(establishmentId).add(ws);
        console.log(`Merchant registered and authorized for establishment: ${establishmentId}`);
        
        // Send initial orders to the registered merchant
        const merchantOrders = db.orders.filter(order => order.establishmentId === establishmentId);
        ws.send(JSON.stringify({ type: 'INITIAL_ORDERS', orders: merchantOrders }));
      }

      if (message.type === 'UPDATE_STATUS') {
        const { orderId, status, reason, paymentStatus } = message;
        const db = readDB();
        const order = db.orders.find(o => o.id === orderId);
        
        if (order) {
          if (status) order.status = status;
          if (reason) order.cancelReason = reason;
          if (paymentStatus) order.paymentStatus = paymentStatus;
          order.updatedAt = new Date().toISOString();
          writeDB(db);
          console.log(`Order ${orderId} updated: status=${status || 'unchanged'}, reason=${reason || 'none'}, paymentStatus=${paymentStatus || 'unchanged'}`);

          // Broadcast status update to all connected clients for this establishment
          const estId = order.establishmentId;
          broadcastToMerchant(estId, {
            type: 'ORDER_UPDATED',
            orderId,
            status: order.status,
            order
          });
        }
      }
    } catch (err) {
      console.error('Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    console.log('WS Connection closed');
    if (registeredId && merchantConnections.has(registeredId)) {
      const connections = merchantConnections.get(registeredId);
      connections.delete(ws);
      if (connections.size === 0) {
        merchantConnections.delete(registeredId);
      }
      console.log(`Deregistered connection for merchant: ${registeredId}`);
    }
  });
});

// Helper function to broadcast message to all connected Ws clients of a specific merchant
function broadcastToMerchant(establishmentId, data) {
  if (merchantConnections.has(establishmentId)) {
    const clients = merchantConnections.get(establishmentId);
    const messageStr = JSON.stringify(data);
    clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }
// HTTP endpoint to update order status (fallback for WebSocket)
app.put('/api/orders/:id/status', (req, res) => {
  const orderId = req.params.id;
  const { status, reason, paymentStatus } = req.body;
  const db = readDB();
  const order = db.orders.find(o => o.id === orderId);

  if (!order) {
    return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
  }

  if (status) order.status = status;
  if (reason) order.cancelReason = reason;
  if (paymentStatus) order.paymentStatus = paymentStatus;
  order.updatedAt = new Date().toISOString();
  writeDB(db);

  broadcastToMerchant(order.establishmentId, {
    type: 'ORDER_UPDATED',
    orderId,
    status: order.status,
    order
  });

  res.json({ success: true, order });
});

// API configuration endpoint for Supabase
app.get('/api/config/supabase', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

// REST API for placing orders (also triggers WebSocket broadcast)
app.post('/api/orders', (req, res) => {
  const db = readDB();
  const orderDetails = req.body;

  if (!orderDetails.establishmentId || !orderDetails.items || orderDetails.items.length === 0) {
    return res.status(400).json({ error: 'EstablishmentId and items are required' });
  }

  // Create new order object
  const order = {
    id: 'ord-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    establishmentId: orderDetails.establishmentId,
    establishmentName: orderDetails.establishmentName || '',
    items: orderDetails.items,
    total: orderDetails.total,
    orderType: orderDetails.orderType, // 'mesa' or 'delivery'
    customerName: orderDetails.customerName,
    tableNumber: orderDetails.tableNumber || null,
    deliveryDetails: orderDetails.deliveryDetails || null,
    status: 'Pendiente', // 'Pendiente', 'Preparando', 'Listo', 'Entregado'
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.orders.push(order);
  writeDB(db);

  console.log(`New order created: ${order.id} for establishment: ${order.establishmentId}`);

  // Broadcast to all connected clients of this establishment in real-time
  broadcastToMerchant(order.establishmentId, {
    type: 'NEW_ORDER',
    order: order
  });

  // Broadcast to all connected clients (Admin/Owner dashboard)
  const globalPayload = JSON.stringify({
    type: 'GLOBAL_NEW_ORDER',
    order: order
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(globalPayload);
    }
  });

  res.status(201).json(order);
});

// PUT to update establishment details (authorized by linkKey or isOwner flag)
app.put('/api/establishments/:id', (req, res) => {
  const { id } = req.params;
  const { linkKey, products, name, description, logo, bannerType, banner, delivery_fee, themeColor, isOwner, logoImage, tables } = req.body;
  
  const db = readDB();
  const estIndex = db.establishments.findIndex(e => e.id === id);
  if (estIndex === -1) {
    return res.status(404).json({ error: 'Establecimiento no encontrado' });
  }
  
  const est = db.establishments[estIndex];
  if (!isOwner && est.linkKey !== linkKey) {
    return res.status(401).json({ error: 'Clave de vinculación incorrecta' });
  }
  
  if (products) {
    est.products = products;
  }
  if (name) {
    est.name = name;
  }
  if (description) {
    est.description = description;
  }
  if (logo) {
    est.logo = logo;
  }
  if (bannerType) {
    est.bannerType = bannerType;
  }
  if (banner) {
    est.banner = banner;
  }
  if (delivery_fee !== undefined) {
    est.delivery_fee = parseFloat(delivery_fee);
  }
  if (themeColor) {
    est.themeColor = themeColor;
  }
  if (logoImage !== undefined) {
    est.logoImage = logoImage;
  }
  if (tables !== undefined) {
    est.tables = tables;
  }
  if (req.body.prep_time !== undefined) {
    est.prep_time = req.body.prep_time ? parseInt(req.body.prep_time) : null;
  }
  if (req.body.delivery_time !== undefined) {
    est.delivery_time = req.body.delivery_time ? parseInt(req.body.delivery_time) : null;
  }
  if (req.body.location) {
    est.location = req.body.location;
  }
  if (req.body.latitude !== undefined || req.body.location_lat !== undefined) {
    const latVal = req.body.latitude !== undefined ? req.body.latitude : req.body.location_lat;
    const parsedLat = (latVal !== null && latVal !== '') ? parseFloat(latVal) : null;
    est.latitude = parsedLat;
    est.location_lat = parsedLat;
  }
  if (req.body.longitude !== undefined || req.body.location_lng !== undefined) {
    const lngVal = req.body.longitude !== undefined ? req.body.longitude : req.body.location_lng;
    const parsedLng = (lngVal !== null && lngVal !== '') ? parseFloat(lngVal) : null;
    est.longitude = parsedLng;
    est.location_lng = parsedLng;
  }
  const storeGpsMap = readStoreGps();
  const gpsDeletedMap = readGpsDeleted();
  if (est.latitude && est.longitude) {
    storeGpsMap[id] = { latitude: est.latitude, longitude: est.longitude };
    writeStoreGps(storeGpsMap);
    // If GPS is being re-added, remove from deleted blacklist
    delete gpsDeletedMap[id];
    writeGpsDeleted(gpsDeletedMap);
    console.log(`📍 Establishment [${id}] (${est.name}) GPS locked to: ${est.latitude}, ${est.longitude}`);
  } else if (req.body.latitude === null || req.body.location_lat === null) {
    delete storeGpsMap[id];
    writeStoreGps(storeGpsMap);
    // Add to deleted blacklist so Postgres/Supabase syncs never restore GPS
    gpsDeletedMap[id] = true;
    writeGpsDeleted(gpsDeletedMap);
    console.log(`🗑️ Establishment [${id}] (${est.name}) GPS cleared and blacklisted from restore.`);
  }
  if (req.body.working_days !== undefined) {
    est.working_days = Array.isArray(req.body.working_days) ? req.body.working_days : [];
  }
  if (req.body.open_time !== undefined) {
    est.open_time = req.body.open_time;
  }
  if (req.body.close_time !== undefined) {
    est.close_time = req.body.close_time;
  }
  if (req.body.isHighTraffic !== undefined) {
    est.isHighTraffic = Boolean(req.body.isHighTraffic);
  }
  if (req.body.disabled !== undefined) {
    const isDisabled = Boolean(req.body.disabled);
    est.disabled = isDisabled;
    const disabledMap = readDisabledStores();
    disabledMap[id] = isDisabled;
    writeDisabledStores(disabledMap);
    console.log(`🔒 Establishment [${id}] (${est.name}) disabled state updated to: ${isDisabled}`);
  }
  if (req.body.extraPrepTime !== undefined) {
    est.extraPrepTime = req.body.extraPrepTime ? parseInt(req.body.extraPrepTime) : 20;
  }
  if (req.body.newLinkKey) {
    est.linkKey = req.body.newLinkKey;
  }
  
  writeDB(db);

  // Broadcast WebSocket update if connected clients exist
  const updatePayload = JSON.stringify({
    type: 'ESTABLISHMENT_UPDATED',
    establishment: est
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(updatePayload);
    }
  });

  res.json({ success: true, establishment: est });
});

// DELETE to remove an establishment (authorized by code 0424)
app.delete('/api/establishments/:id', async (req, res) => {
  const { id } = req.params;
  const { code } = req.query;
  
  if (code !== '0424') {
    return res.status(403).json({ error: 'Código maestro incorrecto' });
  }
  
  const db = readDB();
  const estIndex = db.establishments.findIndex(e => e.id === id);
  if (estIndex === -1) {
    return res.status(404).json({ error: 'Establecimiento no encontrado' });
  }
  
  db.establishments.splice(estIndex, 1);
  writeDB(db);

  // Permanently delete from Supabase PostgreSQL cloud table
  await deleteEstablishmentFromPostgres(id);

  res.json({ success: true });
});

// POST to reset orders/billing history for an establishment (authorized by code 0424)
app.post('/api/establishments/:id/orders/reset', (req, res) => {
  const { id } = req.params;
  const { code } = req.query;

  if (code !== '0424') {
    return res.status(403).json({ error: 'Código maestro incorrecto' });
  }

  const db = readDB();
  const estExists = db.establishments.some(e => e.id === id);
  if (!estExists) {
    return res.status(404).json({ error: 'Establecimiento no encontrado' });
  }

  // Filter out any orders belonging to this establishment
  db.orders = db.orders.filter(o => o.establishmentId !== id);
  writeDB(db);
  res.json({ success: true });
});

// ==========================================
// REVIEWS & RATINGS (5-STAR SYSTEM) ENDPOINTS
// ==========================================

// GET reviews and average rating for an establishment
app.get('/api/establishments/:id/reviews', (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const reviews = (db.reviews || []).filter(r => r.establishmentId === id);
  
  let avgRating = 5.0;
  if (reviews.length > 0) {
    const sum = reviews.reduce((acc, r) => acc + (parseFloat(r.rating) || 5), 0);
    avgRating = parseFloat((sum / reviews.length).toFixed(1));
  }

  res.json({
    establishmentId: id,
    avgRating: avgRating,
    totalReviews: reviews.length,
    reviews: reviews
  });
});

// POST submit a new review
app.post('/api/reviews', (req, res) => {
  const { orderId, establishmentId, customerName, rating, comment } = req.body;
  if (!establishmentId || !rating) {
    return res.status(400).json({ error: 'EstablishmentId and rating are required' });
  }

  const db = readDB();
  if (!db.reviews) db.reviews = [];

  // Prevent duplicate reviews for same order
  if (orderId && db.reviews.some(r => r.orderId === orderId)) {
    return res.status(400).json({ error: 'Ya has calificado este pedido.' });
  }

  const newReview = {
    id: 'rev-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    orderId: orderId || null,
    establishmentId,
    customerName: customerName || 'Cliente de Rapi Gochos',
    rating: Math.min(5, Math.max(1, parseFloat(rating))),
    comment: comment || '',
    createdAt: new Date().toISOString()
  };

  db.reviews.push(newReview);

  // Update establishment rating cache if establishment exists
  const est = db.establishments.find(e => e.id === establishmentId);
  if (est) {
    const estReviews = db.reviews.filter(r => r.establishmentId === establishmentId);
    const sum = estReviews.reduce((acc, r) => acc + r.rating, 0);
    est.avgRating = parseFloat((sum / estReviews.length).toFixed(1));
    est.totalReviews = estReviews.length;
  }

  writeDB(db);
  console.log(`⭐ New review added for establishment ${establishmentId}: ${newReview.rating} stars`);

  res.status(201).json(newReview);
});

// ==========================================
// DRIVER APP (REPARTIDORES) ENDPOINTS
// ==========================================

// GET all drivers (admin view)
app.get('/api/drivers', (req, res) => {
  const db = readDB();
  res.json(db.drivers || []);
});

// GET next available driver with fair round-robin rotation
app.get('/api/drivers/next-available', (req, res) => {
  const db = readDB();
  const drivers = db.drivers || [];

  if (drivers.length === 0) {
    return res.json({
      success: true,
      driver: {
        id: 'default-central',
        name: 'Central Gocho',
        phone: '573227949751',
        totalDeliveries: 0
      }
    });
  }

  // Prefer drivers with status 'Disponible', otherwise all registered drivers
  let available = drivers.filter(d => d.status === 'Disponible');
  if (available.length === 0) {
    available = drivers; // fallback to all drivers for fair rotation
  }

  // Sort by lastDispatchedAt ascending (oldest timestamp first = round robin fair turn)
  available.sort((a, b) => {
    const timeA = a.lastDispatchedAt ? new Date(a.lastDispatchedAt).getTime() : 0;
    const timeB = b.lastDispatchedAt ? new Date(b.lastDispatchedAt).getTime() : 0;
    return timeA - timeB;
  });

  const nextDriver = available[0];
  nextDriver.lastDispatchedAt = new Date().toISOString();
  nextDriver.totalDeliveries = (nextDriver.totalDeliveries || 0) + 1;
  writeDB(db);

  console.log(`🚴 Rotated next driver: ${nextDriver.name} (${nextDriver.phone}) - Total Deliveries: ${nextDriver.totalDeliveries}`);
  res.json({ success: true, driver: nextDriver });
});

// POST register or update driver (admin view)
app.post('/api/drivers/register', (req, res) => {
  const { name, phone, linkKey, vehicleType } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Nombre y teléfono son obligatorios' });
  }

  const db = readDB();
  if (!db.drivers) db.drivers = [];

  const existingIndex = db.drivers.findIndex(d => d.phone === phone || d.linkKey === linkKey);
  const driverData = {
    id: existingIndex !== -1 ? db.drivers[existingIndex].id : 'drv-' + Date.now(),
    name,
    phone,
    linkKey: linkKey || 'GOCHO-' + Math.floor(1000 + Math.random() * 9000),
    vehicleType: vehicleType || 'Moto 🛵',
    status: 'Disponible', // 'Disponible', 'En Camino', 'Fuera de Servicio'
    totalDeliveries: existingIndex !== -1 ? db.drivers[existingIndex].totalDeliveries || 0 : 0,
    latitude: existingIndex !== -1 ? db.drivers[existingIndex].latitude : null,
    longitude: existingIndex !== -1 ? db.drivers[existingIndex].longitude : null,
    lastActive: new Date().toISOString()
  };

  if (existingIndex !== -1) {
    db.drivers[existingIndex] = driverData;
  } else {
    db.drivers.push(driverData);
  }

  writeDB(db);
  res.status(201).json(driverData);
});

// GET orders ready for drivers
app.get('/api/driver/orders', (req, res) => {
  const { location } = req.query;
  const db = readDB();

  let readyOrders = db.orders.filter(o => o.status === 'Listo' || o.status === 'Preparando' || o.status === 'En Camino');

  if (location && location !== 'all') {
    const matchingEstIds = db.establishments
      .filter(e => (e.location || 'San Antonio').toLowerCase().includes(location.toLowerCase()))
      .map(e => e.id);
    readyOrders = readyOrders.filter(o => matchingEstIds.includes(o.establishmentId));
  }

  res.json(readyOrders);
});

// POST driver accepts order
app.post('/api/driver/accept-order', (req, res) => {
  const { orderId, driverId, driverName, driverPhone } = req.body;
  if (!orderId || !driverName) {
    return res.status(400).json({ error: 'OrderId and driverName are required' });
  }

  const db = readDB();
  const order = db.orders.find(o => o.id === orderId);
  if (!order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  order.status = 'En Camino';
  order.driver = {
    id: driverId || 'drv-temp',
    name: driverName,
    phone: driverPhone || '',
    acceptedAt: new Date().toISOString()
  };
  order.updatedAt = new Date().toISOString();

  // Update driver status
  if (db.drivers) {
    const drv = db.drivers.find(d => d.id === driverId || d.phone === driverPhone);
    if (drv) drv.status = 'En Camino';
  }

  writeDB(db);

  // Broadcast to merchant WebSocket clients
  broadcastToMerchant(order.establishmentId, {
    type: 'ORDER_UPDATED',
    orderId: order.id,
    status: 'En Camino',
    order: order
  });

  res.json({ success: true, order: order });
});

// POST driver completes order (marks Entregado)
app.post('/api/driver/complete-order', (req, res) => {
  const { orderId, driverPhone } = req.body;
  const db = readDB();
  const order = db.orders.find(o => o.id === orderId);
  if (!order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  order.status = 'Entregado';
  order.updatedAt = new Date().toISOString();

  if (db.drivers) {
    const drv = db.drivers.find(d => d.phone === driverPhone || (order.driver && d.id === order.driver.id));
    if (drv) {
      drv.status = 'Disponible';
      drv.totalDeliveries = (drv.totalDeliveries || 0) + 1;
    }
  }

  writeDB(db);

  broadcastToMerchant(order.establishmentId, {
    type: 'ORDER_UPDATED',
    orderId: order.id,
    status: 'Entregado',
    order: order
  });

  res.json({ success: true, order: order });
});

// POST driver broadcasts live GPS location
app.post('/api/driver/location', (req, res) => {
  const { driverPhone, latitude, longitude } = req.body;
  if (!driverPhone || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'driverPhone, latitude and longitude required' });
  }

  const db = readDB();
  let drv = (db.drivers || []).find(d => d.phone === driverPhone);
  if (drv) {
    drv.latitude = parseFloat(latitude);
    drv.longitude = parseFloat(longitude);
    drv.lastActive = new Date().toISOString();
    writeDB(db);
  }

  res.json({ success: true, latitude, longitude });
});

// Fallback for SPA routing (if any) or simple index.html
app.get('*', (req, res, next) => {
  // If request is for api, skip to next route handler (standard Express)
  if (req.url.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  const syncedFromPostgres = await syncFromPostgres();
  if (!syncedFromPostgres) {
    await syncFromSupabase();
  }
});
