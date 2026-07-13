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
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      // Return default empty structure if file doesn't exist
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
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing DB:', err);
  }
}

// Owner Master Key Configuration
const OWNER_PASSWORDS = ['DUEÑO123', 'DUENO123', 'OWNER123'];

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

// PUT to update establishment details (authorized by linkKey)
app.put('/api/establishments/:id', (req, res) => {
  const { id } = req.params;
  const { linkKey, products } = req.body;
  
  const db = readDB();
  const estIndex = db.establishments.findIndex(e => e.id === id);
  if (estIndex === -1) {
    return res.status(404).json({ error: 'Establecimiento no encontrado' });
  }
  
  const est = db.establishments[estIndex];
  if (est.linkKey !== linkKey) {
    return res.status(401).json({ error: 'Clave de vinculación incorrecta' });
  }
  
  if (products) {
    est.products = products;
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

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
