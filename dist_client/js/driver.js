// Driver Application Logic (driver.js)

// Universal Capacitor / Native Android API proxy
(function() {
  const isWebRender = window.location.origin.includes('pedigochos.onrender.com');
  const isLocalDev = window.location.hostname === 'localhost' && window.location.port === '3000';
  
  if (!isWebRender && !isLocalDev) {
    const TARGET_HOST = 'https://pedigochos.onrender.com';
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      if (typeof input === 'string') {
        if (input.startsWith('/api/')) {
          input = TARGET_HOST + input;
        } else if (input.startsWith('api/')) {
          input = TARGET_HOST + '/' + input;
        }
      } else if (input && input.url) {
        if (input.url.startsWith('/') || input.url.includes('localhost/api/')) {
          const newUrl = input.url.replace(/^(?:https?:\/\/[^\/]+)?\/api\//, TARGET_HOST + '/api/');
          input = new Request(newUrl, input);
        }
      }
      return originalFetch.call(this, input, init);
    };
  }
})();

class DriverController {
  constructor() {
    this.driver = null;
    this.activeTab = 'available';
    this.availableOrders = [];
    this.activeOrder = null;
    this.watchId = null;
    this.pollingTimer = null;
  }

  init() {
    this.checkLocalSession();
  }

  checkLocalSession() {
    try {
      const savedDriver = JSON.parse(localStorage.getItem('pedigochos_active_driver') || 'null');
      if (savedDriver && savedDriver.phone) {
        this.driver = savedDriver;
        document.getElementById('driver-login-gate').classList.add('hidden');
        this.updateProfileUI();
        this.startDriverServices();
      } else {
        document.getElementById('driver-login-gate').classList.remove('hidden');
      }
    } catch(e) {
      document.getElementById('driver-login-gate').classList.remove('hidden');
    }
  }

  quickLoginDefaultDriver() {
    const phoneInput = document.getElementById('driver-input-phone');
    const keyInput = document.getElementById('driver-input-key');
    if (phoneInput) phoneInput.value = '+573227949751';
    if (keyInput) keyInput.value = 'GOCHO-8821';
    this.loginDriver();
  }

  async loginDriver() {
    const phone = document.getElementById('driver-input-phone').value.trim();
    const key = document.getElementById('driver-input-key').value.trim().toUpperCase();
    const errEl = document.getElementById('driver-login-error');

    if (!phone || !key) {
      if (errEl) {
        errEl.innerText = '⚠️ Ingresa tu número de teléfono y clave privada.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    try {
      // Register or verify driver with server
      const res = await fetch('/api/drivers/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Repartidor ' + phone.slice(-4), phone, linkKey: key })
      });

      if (res.ok) {
        const driverData = await res.json();
        this.driver = driverData;
        localStorage.setItem('pedigochos_active_driver', JSON.stringify(driverData));
        document.getElementById('driver-login-gate').classList.add('hidden');
        this.updateProfileUI();
        this.startDriverServices();
      } else {
        if (errEl) {
          errEl.innerText = '⚠️ Clave de repartidor o teléfono incorrectos.';
          errEl.classList.remove('hidden');
        }
      }
    } catch(e) {
      console.error(e);
      if (errEl) {
        errEl.innerText = 'Error de conexión con el servidor.';
        errEl.classList.remove('hidden');
      }
    }
  }

  updateProfileUI() {
    if (!this.driver) return;
    const nameEl = document.getElementById('driver-profile-name');
    const phoneEl = document.getElementById('driver-profile-phone');
    if (nameEl) nameEl.innerText = this.driver.name || 'Repartidor Gocho';
    if (phoneEl) phoneEl.innerText = `📱 ${this.driver.phone} • ${this.driver.vehicleType || 'Moto 🛵'}`;
  }

  startDriverServices() {
    // 1. Enable Duty Status
    const toggle = document.getElementById('driver-duty-toggle');
    if (toggle) toggle.checked = true;
    this.toggleDutyStatus(true);

    // 2. Start REST Polling every 4s for new orders
    this.loadAvailableOrders();
    if (this.pollingTimer) clearInterval(this.pollingTimer);
    this.pollingTimer = setInterval(() => {
      this.loadAvailableOrders();
    }, 4000);

    // 3. Start Live GPS Location Watcher
    this.startGPSWatcher();
  }

  toggleDutyStatus(isOnline) {
    const badge = document.getElementById('duty-status-badge');
    if (badge) {
      if (isOnline) {
        badge.innerText = '🟢 En Servicio (Disponible)';
        badge.className = 'duty-badge badge-online';
      } else {
        badge.innerText = '🔴 Fuera de Servicio';
        badge.className = 'duty-badge badge-offline';
      }
    }
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    ['available', 'active', 'earnings'].forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      const view = document.getElementById(`tab-view-${t}`);
      if (btn) btn.classList.toggle('active', t === tabName);
      if (view) view.classList.toggle('hidden', t !== tabName);
    });

    if (tabName === 'available') this.loadAvailableOrders();
    if (tabName === 'active') this.renderActiveOrderTab();
    if (tabName === 'earnings') this.renderEarningsTab();
  }

  async loadAvailableOrders() {
    if (!this.driver) return;
    try {
      const res = await fetch('/api/driver/orders');
      if (!res.ok) return;
      const orders = await res.json();

      // Separate orders assigned to THIS driver vs unassigned orders
      const assigned = orders.find(o => o.driver && (o.driver.phone === this.driver.phone || o.driver.id === this.driver.id) && o.status === 'En Camino');
      if (assigned) {
        this.activeOrder = assigned;
      }

      this.availableOrders = orders.filter(o => o.status === 'Listo' || o.status === 'Preparando');

      const badge = document.getElementById('badge-available-count');
      if (badge) badge.innerText = this.availableOrders.length;

      this.renderAvailableOrdersList();
    } catch(e) {
      console.warn('Error loading available orders for driver:', e);
    }
  }

  renderAvailableOrdersList() {
    const container = document.getElementById('available-orders-list');
    if (!container) return;

    if (this.availableOrders.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card">
          <span class="empty-icon">📦</span>
          <h3>Sin Pedidos Pendientes</h3>
          <p>No hay encomiendas listas para recoger en este momento. Mantente disponible.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.availableOrders.map(order => {
      const deliveryFee = order.deliveryDetails?.deliveryFee || 0;
      const custAddress = order.deliveryDetails?.address || 'Dirección de entrega';
      const custName = order.customerName || 'Cliente';

      return `
        <div class="order-card-3d">
          <div class="card-header-bar">
            <span class="card-shop-name">🏪 ${order.establishmentName || 'Restaurante'}</span>
            <span class="card-fee-badge">💰 Delivery: $${parseFloat(deliveryFee).toFixed(2)}</span>
          </div>

          <div class="order-info-line">
            <span>👤 Cliente:</span> <strong>${custName}</strong>
          </div>
          <div class="order-info-line">
            <span>📍 Entrega:</span> <span>${custAddress}</span>
          </div>
          <div class="order-info-line">
            <span>🛍️ Items:</span> <span>${order.items?.length || 0} producto(s)</span>
          </div>

          <button type="button" class="btn-3d btn-3d-emerald" onclick="DriverApp.acceptOrder('${order.id}')" style="width: 100%; margin-top: 12px; font-size: 13.5px; padding: 12px;">
            🛵 Aceptar Encomienda y Tomar Carrera
          </button>
        </div>
      `;
    }).join('');
  }

  async acceptOrder(orderId) {
    if (!this.driver) return;
    try {
      const res = await fetch('/api/driver/accept-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          driverId: this.driver.id,
          driverName: this.driver.name,
          driverPhone: this.driver.phone
        })
      });

      if (res.ok) {
        const data = await res.json();
        this.activeOrder = data.order;
        if (typeof Sound !== 'undefined') Sound.playBell();
        this.switchTab('active');
      } else {
        alert('Este pedido ya fue tomado por otro repartidor.');
        this.loadAvailableOrders();
      }
    } catch(e) {
      console.error(e);
      alert('Error de conexión al aceptar el pedido.');
    }
  }

  renderActiveOrderTab() {
    const emptyMsg = document.getElementById('no-active-order-msg');
    const detailsCard = document.getElementById('active-order-details-card');

    if (!this.activeOrder || this.activeOrder.status === 'Entregado') {
      if (emptyMsg) emptyMsg.classList.remove('hidden');
      if (detailsCard) detailsCard.classList.add('hidden');
      return;
    }

    if (emptyMsg) emptyMsg.classList.add('hidden');
    if (detailsCard) detailsCard.classList.remove('hidden');

    const order = this.activeOrder;
    const estName = order.establishmentName || 'Restaurante';
    const custName = order.customerName || 'Cliente';
    const custPhone = order.deliveryDetails?.phone || '';
    const custAddress = order.deliveryDetails?.address || 'Dirección de Entrega';
    const deliveryFee = order.deliveryDetails?.deliveryFee || 0;

    const gmapsStoreUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(estName)}`;
    const hasGps = Boolean(order.deliveryDetails?.latitude && order.deliveryDetails?.longitude);
    const gmapsCustUrl = hasGps
      ? `https://www.google.com/maps/search/?api=1&query=${order.deliveryDetails.latitude},${order.deliveryDetails.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(custAddress)}`;

    const wazeCustUrl = hasGps
      ? `https://waze.com/ul?ll=${order.deliveryDetails.latitude},${order.deliveryDetails.longitude}&navigate=yes`
      : `https://waze.com/ul?q=${encodeURIComponent(custAddress)}&navigate=yes`;

    const whatsappUrl = custPhone ? `https://wa.me/${custPhone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent('Hola ' + custName + ', soy tu repartidor de Pedi Gochos 🛵. Voy en camino con tu pedido.')}` : '#';

    const totalCop = Math.round(order.total < 1000 ? order.total * 1000 : order.total);
    const totalBs = (totalCop / 100).toFixed(2);
    const totalUsd = (totalCop / 4000).toFixed(2);

    detailsCard.innerHTML = `
      <div class="order-card-3d" style="border: 2px solid #10B981;">
        <div class="card-header-bar">
          <div>
            <span class="card-shop-name">🛵 Pedido #${order.id.slice(-4)}</span>
            <span style="display: block; font-size: 11px; color: #10B981; font-weight: 800;">EN CAMINO A ENTREGA</span>
          </div>
          <span class="card-fee-badge" style="font-size: 14px;">💰 Ganancia: $${parseFloat(deliveryFee).toFixed(2)}</span>
        </div>

        <!-- Store Pickup Section -->
        <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.08);">
          <strong style="color: #FF5E3A; font-size: 13px; display: block; margin-bottom: 4px;">🏪 1. Recoger en Local:</strong>
          <span style="font-size: 14px; font-weight: 800; color: #FFF;">${estName}</span>
          <a href="${gmapsStoreUrl}" target="_blank" class="btn-3d btn-3d-blue" style="margin-top: 8px; width: 100%; font-size: 12px; padding: 8px;">
            🗺️ Navegar al Restaurante (Google Maps)
          </a>
        </div>

        <!-- Payment & Change Section -->
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); padding: 12px; border-radius: 12px; margin-bottom: 12px;">
          <strong style="color: #10B981; font-size: 13px; display: block; margin-bottom: 4px;">💵 Cobro en Destino:</strong>
          <div style="font-size: 16px; font-weight: 900; color: #FFF;">Total: $${totalCop.toLocaleString('de-DE')} COP</div>
          <div style="display: flex; gap: 8px; font-size: 11.5px; color: #CBD5E1; margin-top: 4px;">
            <span>🇻🇪 Bs. ${totalBs}</span>
            <span>•</span>
            <span>💵 $${totalUsd} USD</span>
          </div>
          <div style="font-size: 12.5px; font-weight: 800; color: #34D399; margin-top: 6px;">
            ${order.paymentMethod === 'Transferencia' ? '📲 Transferencia / Pago Móvil (Ya Pagado)' : `💵 Efectivo: ${order.paymentNotes || 'Monto exacto'}`}
          </div>
        </div>

        <!-- Customer Delivery Section -->
        <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 12px; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.08);">
          <strong style="color: #10B981; font-size: 13px; display: block; margin-bottom: 4px;">🏠 2. Entregar a Cliente:</strong>
          <div style="font-size: 14px; font-weight: 800; color: #FFF; margin-bottom: 4px;">${custName}</div>
          <div style="font-size: 12.5px; color: #CBD5E1; margin-bottom: 10px;">📍 ${custAddress}</div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
            <a href="tel:${custPhone}" class="btn-3d btn-3d-emerald" style="font-size: 12px; padding: 8px;">
              📞 Llamar Cliente
            </a>
            <a href="${whatsappUrl}" target="_blank" class="btn-3d btn-3d-emerald" style="font-size: 12px; padding: 8px; background: #25D366; box-shadow: 0 5px 0 #1B9A4A;">
              💬 WhatsApp
            </a>
          </div>

          <!-- Dual GPS Navigation Buttons -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <a href="${gmapsCustUrl}" target="_blank" class="btn-3d btn-3d-blue" style="font-size: 12px; padding: 8px;">
              📍 Google Maps
            </a>
            <a href="${wazeCustUrl}" target="_blank" class="btn-3d btn-3d-blue" style="font-size: 12px; padding: 8px; background: #33CCFF; box-shadow: 0 5px 0 #0099CC; color: #000; font-weight: 900;">
              🗺️ Waze GPS
            </a>
          </div>
        </div>

        <!-- Complete Delivery Action Button -->
        <button type="button" class="btn-3d btn-3d-emerald" onclick="DriverApp.completeOrder('${order.id}')" style="width: 100%; font-size: 15px; padding: 16px; background: linear-gradient(180deg, #059669 0%, #047857 100%);">
          ✅ Confirmar Entrega Realizada al Cliente
        </button>
      </div>
    `;
  }

  async completeOrder(orderId) {
    if (!confirm('¿Confirmas que has entregado el pedido al cliente correctamente?')) return;
    try {
      const res = await fetch('/api/driver/complete-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, driverPhone: this.driver?.phone })
      });

      if (res.ok) {
        alert('🎉 ¡Excelente trabajo! Entrega completada con éxito.');
        this.activeOrder = null;
        this.switchTab('available');
      }
    } catch(e) {
      console.error(e);
      alert('Error de conexión al completar el pedido.');
    }
  }

  renderEarningsTab() {
    // Calculate total delivered orders and earnings from server / orders list
    fetch('/api/orders')
      .then(res => res.json())
      .then(orders => {
        const completed = orders.filter(o => o.status === 'Entregado' && o.driver && (o.driver.phone === this.driver?.phone || o.driver.id === this.driver?.id));
        const totalEarnings = completed.reduce((sum, o) => sum + (parseFloat(o.deliveryDetails?.deliveryFee) || 0), 0);

        const earningsEl = document.getElementById('driver-today-earnings');
        const countEl = document.getElementById('driver-today-deliveries-count');

        if (earningsEl) earningsEl.innerText = `$${totalEarnings.toFixed(2)} USD`;
        if (countEl) countEl.innerText = `${completed.length} Envíos Realizados`;

        const historyContainer = document.getElementById('driver-history-list');
        if (historyContainer) {
          if (completed.length === 0) {
            historyContainer.innerHTML = `<div class="empty-state-card"><p>Aún no has completado entregas hoy.</p></div>`;
          } else {
            historyContainer.innerHTML = completed.map(o => `
              <div class="order-card-3d" style="padding: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <strong style="color: #FFF; font-size: 14px;">🏪 ${o.establishmentName}</strong>
                    <span style="display: block; font-size: 11px; color: #94A3B8;">Cliente: ${o.customerName}</span>
                  </div>
                  <span style="color: #10B981; font-weight: 800; font-size: 14px;">+$${parseFloat(o.deliveryDetails?.deliveryFee || 0).toFixed(2)}</span>
                </div>
              </div>
            `).join('');
          }
        }
      })
      .catch(err => console.error(err));
  }

  startGPSWatcher() {
    if ('geolocation' in navigator) {
      this.watchId = navigator.geolocation.watchPosition((pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        if (this.driver && this.driver.phone) {
          fetch('/api/driver/location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              driverPhone: this.driver.phone,
              latitude: lat,
              longitude: lng
            })
          }).catch(e => console.warn('GPS broadcast error:', e));
        }
      }, (err) => {
        console.warn('Geolocation watch position warning:', err);
      }, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000
      });
    }
  }
}

const DriverApp = new DriverController();
window.DriverApp = DriverApp;

document.addEventListener('DOMContentLoaded', () => {
  DriverApp.init();
});
