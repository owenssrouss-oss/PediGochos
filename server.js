require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper functions for Database read/write
async function syncFromSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.log('Supabase env vars missing. Skipping cloud DB sync.');
    return;
  }
  try {
    const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/menu_images/uploads/db_backup.json`;
    console.log('Syncing database state from Supabase:', url);
    let res = await fetch(url);
    if (!res.ok) {
      const legacyUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/menu_images/db_backup.json`;
      console.log('Trying legacy path fallback:', legacyUrl);
      res = await fetch(legacyUrl);
    }
    if (res.ok) {
      const text = await res.text();
      const cloudData = JSON.parse(text);
      if (cloudData && cloudData.establishments) {
        const localData = readDB();
        const localTime = new Date(localData.lastUpdated || 0).getTime();
        const cloudTime = new Date(cloudData.lastUpdated || 0).getTime();
        
        if (cloudTime > localTime) {
          fs.writeFileSync(DB_FILE, JSON.stringify(cloudData, null, 2), 'utf8');
          console.log('🎉 Database synced successfully from Supabase Storage (Cloud is newer)!');
        } else {
          console.log('Skipping cloud sync: Local database is newer or equal to Cloud backup.');
        }
      }
    } else {
      console.log('No backup db.json found in Supabase Storage or request failed. Status:', res.status);
    }
  } catch (err) {
    console.error('Error syncing database from Supabase:', err);
  }
}

async function uploadToSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return;
  try {
    const url = `${process.env.SUPABASE_URL}/storage/v1/object/menu_images/db_backup.json`;
    const fileContent = fs.readFileSync(DB_FILE, 'utf8');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'apikey': process.env.SUPABASE_ANON_KEY,
        'x-upsert': 'true',
        'Content-Type': 'application/json'
      },
      body: fileContent
    });
    if (res.ok) {
      console.log('☁️ Database state backup updated successfully in Supabase Storage!');
    } else {
      const errText = await res.text();
      console.error('Failed to backup database to Supabase:', res.status, errText);
    }
  } catch (err) {
    console.error('Error backing up database to Supabase:', err);
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
      
      const dbState = {
        establishments: establishments || [],
        orders: orders || [],
        lastUpdated: new Date().toISOString()
      };
      
      fs.writeFileSync(DB_FILE, JSON.stringify(dbState, null, 2), 'utf8');
      console.log('🎉 Database synced successfully from Supabase PostgreSQL tables!');
      return true;
    } else {
      console.log(`Supabase PostgreSQL tables might not be created yet. Status: ${estRes.status} / ${ordRes.status}`);
      console.log('Please run the database script "supabase_setup_tables.sql" in your Supabase SQL Editor.');
      return false;
    }
  } catch (err) {
    console.error('Error syncing database from Supabase PostgreSQL:', err);
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
      const estRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/establishments`, {
        method: 'POST',
        headers,
        body: JSON.stringify(localData.establishments)
      });
      if (!estRes.ok) {
        const errText = await estRes.text();
        console.error('Failed to upsert establishments to Postgres:', estRes.status, errText);
      }
    }

    // Delete removed establishments from PostgreSQL
    const cloudEstRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/establishments?select=id`, {
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
        'apikey': process.env.SUPABASE_ANON_KEY
      }
    });
    if (cloudEstRes.ok) {
      const cloudEsts = await cloudEstRes.json();
      const localIds = new Set((localData.establishments || []).map(e => e.id));
      const deletedIds = cloudEsts.map(e => e.id).filter(id => !localIds.has(id));
      if (deletedIds.length > 0) {
        console.log('Deleting removed establishments from Postgres:', deletedIds);
        const delUrl = `${process.env.SUPABASE_URL}/rest/v1/establishments?id=in.(${deletedIds.map(id => `"${id}"`).join(',')})`;
        await fetch(delUrl, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'apikey': process.env.SUPABASE_ANON_KEY
          }
        });
      }
    }

    // 2. Bulk Upsert Orders
    if (localData.orders && localData.orders.length > 0) {
      const ordRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify(localData.orders)
      });
      if (!ordRes.ok) {
        const errText = await ordRes.text();
        console.error('Failed to upsert orders to Postgres:', ordRes.status, errText);
      }
    }

    // Delete removed orders from PostgreSQL
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
  }
}

function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { establishments: [], orders: [] };
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading DB:', err);
    return { establishments: [], orders: [] };
  }
}

function writeDB(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    uploadToSupabase();
    saveToPostgres();
  } catch (err) {
    console.error('Error writing DB:', err);
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
        const { orderId, status } = message;
        const db = readDB();
        const order = db.orders.find(o => o.id === orderId);
        
        if (order) {
          order.status = status;
          order.updatedAt = new Date().toISOString();
          writeDB(db);
          console.log(`Order ${orderId} updated to status ${status}`);

          // Broadcast status update to all connected clients for this establishment
          const estId = order.establishmentId;
          broadcastToMerchant(estId, {
            type: 'ORDER_UPDATED',
            orderId,
            status,
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
}

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
  
  writeDB(db);
  res.json({ success: true, establishment: est });
});

// DELETE to remove an establishment (authorized by code 0424)
app.delete('/api/establishments/:id', (req, res) => {
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
  res.json({ success: true });
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
