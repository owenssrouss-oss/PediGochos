/* Kitchen Dashboard Logic (kitchen.js) */

class KitchenController {
  constructor() {
    this.establishments = [];
    this.selectedId = '';
    this.orders = [];
    this.ws = null;
    this.reconnectTimer = null;
    this.timeInterval = null;
  }

  async init() {
    await this.loadEstablishments();
    this.setupTimer();
    await this.checkSupabaseSession();
  }

  async checkSupabaseSession() {
    if (typeof SupabaseApp === 'undefined') return;
    await SupabaseApp.init();
    const session = await SupabaseApp.getCurrentSession();
    
    if (session && session.user) {
      const user = session.user;
      const roleData = await SupabaseApp.getUserRole(user.email);
      
      if (roleData && roleData.role === 'merchant') {
        const estId = roleData.establishment_id;
        const est = this.establishments.find(e => e.id === estId);
        
        if (est) {
          const select = document.getElementById('merchant-shop-select');
          if (select) select.value = estId;
          
          this.selectedId = estId;
          document.getElementById('no-shop-overlay').classList.add('hidden');
          document.getElementById('auth-shop-overlay').classList.add('hidden');
          
          this.connectWS(est.linkKey);
        } else {
          console.warn('Asociado a comercio inexistente:', estId);
        }
      } else if (roleData && roleData.role === 'owner') {
        alert('Sesión detectada como Dueño de la Plataforma. Redirigiendo a Panel Central...');
        window.location.href = '/admin.html';
      } else {
        alert('Tu cuenta de Google (' + user.email + ') no tiene permisos de Cocina (merchant).');
        await SupabaseApp.logout();
      }
    }
  }

  async loginWithGoogle() {
    if (typeof SupabaseApp === 'undefined') return;
    await SupabaseApp.loginWithGoogle();
  }

  async loadEstablishments() {
    try {
      const res = await fetch('/api/establishments');
      this.establishments = await res.json();
      
      const select = document.getElementById('merchant-shop-select');
      select.innerHTML = '<option value="">-- Selecciona tu negocio --</option>';
      
      this.establishments.forEach(est => {
        const opt = document.createElement('option');
        opt.value = est.id;
        opt.innerText = `${est.logo} ${est.name}`;
        select.appendChild(opt);
      });
    } catch (e) {
      console.error(e);
      alert('Error cargando la lista de comercios.');
    }
  }

  switchEstablishment(id) {
    this.selectedId = id;
    const overlay = document.getElementById('no-shop-overlay');
    const authOverlay = document.getElementById('auth-shop-overlay');

    // Reset error message and inputs
    document.getElementById('auth-error-msg').classList.add('hidden');
    document.getElementById('auth-link-key').value = '';
    this.updatePricesButtonVisibility(false);

    if (!id) {
      overlay.classList.remove('hidden');
      authOverlay.classList.add('hidden');
      this.closeWS();
      this.orders = [];
      this.renderOrders();
      return;
    }

    overlay.classList.add('hidden');
    
    // Check if we have a saved linked key for this establishment
    const savedKey = localStorage.getItem('admin_key_' + id);
    if (savedKey) {
      authOverlay.classList.add('hidden');
      this.connectWS(savedKey);
    } else {
      const est = this.establishments.find(e => e.id === id);
      document.getElementById('auth-shop-name').innerText = est ? est.name : 'Comercio Protegido';
      authOverlay.classList.remove('hidden');
      this.closeWS();
      this.orders = [];
      this.renderOrders();
    }
  }

  closeWS() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.updateStatusBadge(false);
    this.updatePricesButtonVisibility(false);
  }

  connectWS(customKey = null) {
    this.closeWS();

    const key = customKey || localStorage.getItem('admin_key_' + this.selectedId);
    if (!key) {
      console.warn('No linking key found. Re-authorization required.');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log('Connecting to WebSocket:', wsUrl);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WS Connection established');
      this.updateStatusBadge(true);
      
      // Register with the server for this establishment including the authentication key
      this.ws.send(JSON.stringify({
        type: 'REGISTER_MERCHANT',
        establishmentId: this.selectedId,
        key: key
      }));
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WS Message Received:', data);

        if (data.type === 'AUTH_ERROR') {
          console.error(data.message);
          // Show authorization overlay and show error text
          document.getElementById('auth-shop-overlay').classList.remove('hidden');
          const errorMsg = document.getElementById('auth-error-msg');
          errorMsg.innerText = data.message;
          errorMsg.classList.remove('hidden');
          
          // Clear invalid key
          localStorage.removeItem('admin_key_' + this.selectedId);
          this.closeWS();
          this.orders = [];
          this.renderOrders();
          return;
        }

        if (data.type === 'INITIAL_ORDERS') {
          // Key was correct, save it in localStorage if it was typed just now
          const currentInputKey = document.getElementById('auth-link-key').value.trim().toUpperCase();
          if (currentInputKey) {
            localStorage.setItem('admin_key_' + this.selectedId, currentInputKey);
            document.getElementById('auth-shop-overlay').classList.add('hidden');
            document.getElementById('auth-link-key').value = '';
          }
          
          this.orders = data.orders;
          this.renderOrders();
          this.updatePricesButtonVisibility(true);
        }

        if (data.type === 'NEW_ORDER') {
          this.orders.push(data.order);
          this.renderOrders();
          Sound.playBell();
        }

        if (data.type === 'ORDER_UPDATED') {
          const index = this.orders.findIndex(o => o.id === data.orderId);
          if (index !== -1) {
            this.orders[index] = data.order;
            this.renderOrders();
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    this.ws.onclose = () => {
      console.log('WS Connection closed, retrying in 5 seconds...');
      this.updateStatusBadge(false);
      this.reconnectTimer = setTimeout(() => this.connectWS(), 5000);
    };

    this.ws.onerror = (err) => {
      console.error('WS Error:', err);
      this.ws.close();
    };
  }

  updateStatusBadge(isOnline) {
    const badge = document.getElementById('connection-status');
    if (badge) {
      if (isOnline) {
        badge.innerText = 'Conectado';
        badge.className = 'status-badge online';
      } else {
        badge.innerText = 'Desconectado';
        badge.className = 'status-badge offline';
      }
    }
  }

  updatePricesButtonVisibility(visible) {
    const btn = document.getElementById('btn-manage-prices');
    if (btn) {
      if (visible) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }
  }

  updateOrderStatus(orderId, nextStatus) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'UPDATE_STATUS',
        orderId: orderId,
        status: nextStatus
      }));
    }
  }

  setupTimer() {
    this.timeInterval = setInterval(() => {
      this.updateTimers();
    }, 10000);
  }

  updateTimers() {
    document.querySelectorAll('.order-timer').forEach(span => {
      const createdStr = span.dataset.created;
      if (!createdStr) return;

      const elapsedMins = Math.floor((new Date() - new Date(createdStr)) / 60000);
      span.innerHTML = `⏱️ hace ${elapsedMins} min`;

      if (elapsedMins >= 15) {
        span.classList.add('late');
      } else {
        span.classList.remove('late');
      }
    });
  }

  renderOrders() {
    const colPending = document.getElementById('cards-pending');
    const colPreparing = document.getElementById('cards-preparing');
    const colReady = document.getElementById('cards-ready');

    colPending.innerHTML = '';
    colPreparing.innerHTML = '';
    colReady.innerHTML = '';

    let countPending = 0;
    let countPreparing = 0;
    let countCompleted = 0;

    const activeOrders = this.orders.filter(o => o.status !== 'Entregado');

    activeOrders.forEach(order => {
      const card = document.createElement('div');
      card.className = 'order-card';

      let itemsListHTML = '';
      order.items.forEach(item => {
        let specsHTML = '';
        if (item.specifications) {
          const formattedSpecs = item.specifications.split(' | ').join('\n');
          specsHTML = `<div class="order-item-specs">${formattedSpecs}</div>`;
        }
        
        itemsListHTML += `
          <li class="order-item-detail" style="margin-bottom: 10px;">
            <div style="display: flex; align-items: flex-start; gap: 8px;">
              <span class="order-item-qty" style="font-weight: 700; color: var(--primary);">${item.quantity}x</span>
              <span class="order-item-name" style="font-weight: 600;">${item.name}</span>
            </div>
            ${specsHTML}
          </li>
        `;
      });

      let detailsHTML = '';
      let typeBadge = '';
      if (order.orderType === 'mesa') {
        typeBadge = `<span class="order-type-badge mesa">Mesa ${order.tableNumber}</span>`;
        detailsHTML = `<div class="order-address-box"><strong>📍 Consumo Local</strong><p>Servir en Mesa #${order.tableNumber}</p></div>`;
      } else {
        typeBadge = `<span class="order-type-badge delivery">Delivery</span>`;
        detailsHTML = `
          <div class="order-address-box">
            <strong>🚴 Envío a Domicilio</strong>
            <p><strong>Tlf:</strong> ${order.deliveryDetails.phone}</p>
            <p><strong>Dir:</strong> ${order.deliveryDetails.address}</p>
          </div>
        `;
      }

      const elapsedMins = Math.floor((new Date() - new Date(order.createdAt)) / 60000);
      const isLate = elapsedMins >= 15 ? 'late' : '';

      let actionBtnHTML = '';
      if (order.status === 'Pendiente') {
        countPending++;
        actionBtnHTML = `<button class="btn-card-action start" onclick="KitchenApp.updateOrderStatus('${order.id}', 'Preparando')">Comenzar Preparación</button>`;
      } else if (order.status === 'Preparando') {
        countPreparing++;
        actionBtnHTML = `<button class="btn-card-action ready" onclick="KitchenApp.updateOrderStatus('${order.id}', 'Listo')">¡Listo! Despachar</button>`;
      } else if (order.status === 'Listo') {
        countCompleted++;
        if (order.orderType === 'delivery') {
          actionBtnHTML = `<button class="btn-card-action ready" onclick="KitchenApp.callDelivery('${order.id}')">🚴 Llamar Domicilio</button>`;
        } else {
          actionBtnHTML = `<button class="btn-card-action archive" onclick="KitchenApp.updateOrderStatus('${order.id}', 'Entregado')">🍽️ Finalizar Mesa</button>`;
        }
      }

      card.innerHTML = `
        <div class="order-card-header">
          <div>
            <span class="order-id-label">#${order.id.split('-')[2] || 'ORD'}</span>
            <h4 class="customer-name">${order.customerName}</h4>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
            ${typeBadge}
            <span class="order-timer ${isLate}" data-created="${order.createdAt}">⏱️ hace ${elapsedMins} min</span>
          </div>
        </div>
        
        <ul class="order-items-list">
          ${itemsListHTML}
        </ul>

        ${detailsHTML}
        
        <div class="order-total-price">Total: $${Math.round(order.total).toLocaleString('de-DE')}</div>

        ${actionBtnHTML}
      `;

      if (order.status === 'Pendiente') {
        colPending.appendChild(card);
      } else if (order.status === 'Preparando') {
        colPreparing.appendChild(card);
      } else if (order.status === 'Listo') {
        colReady.appendChild(card);
      }
    });

    document.getElementById('count-pending').innerText = countPending;
    document.getElementById('count-preparing').innerText = countPreparing;
    document.getElementById('count-ready').innerText = countCompleted;

    document.getElementById('stat-pending').innerText = countPending;
    document.getElementById('stat-preparing').innerText = countPreparing;
    document.getElementById('stat-completed').innerText = countCompleted;
  }

  verifyAndLinkKey() {
    const keyInput = document.getElementById('auth-link-key').value.trim().toUpperCase();
    if (!keyInput) {
      alert('Por favor, introduce la clave de vinculación.');
      return;
    }
    this.connectWS(keyInput);
  }

  // Prices Management Modal
  openPricesModal() {
    if (!this.selectedId) return;
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;
    
    const container = document.getElementById('prices-modal-body');
    container.innerHTML = '';
    
    if (!est.products || est.products.length === 0) {
      container.innerHTML = '<p style="color: #94A3B8;">Este comercio no tiene productos registrados.</p>';
      return;
    }
    
    est.products.forEach((prod, prodIdx) => {
      const prodDiv = document.createElement('div');
      prodDiv.style.borderBottom = '1px solid #334155';
      prodDiv.style.paddingBottom = '16px';
      prodDiv.style.marginBottom = '16px';
      
      let modifiersHTML = '';
      if (prod.modifiers && prod.modifiers.length > 0) {
        prod.modifiers.forEach((group, groupIdx) => {
          let optionsHTML = '';
          group.options.forEach((opt, optIdx) => {
            optionsHTML += `
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 13px; color: #94A3B8; padding-left: 20px;">
                <span>• Extra: ${opt.name}</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span>$</span>
                  <input type="number" value="${opt.extra_price}" 
                    data-prod-idx="${prodIdx}" 
                    data-group-idx="${groupIdx}" 
                    data-opt-idx="${optIdx}" 
                    class="input-opt-price" 
                    style="width: 100px; background-color: #0F172A; color: #FFFFFF; border: 1px solid #475569; border-radius: 4px; padding: 4px 8px; font-weight: 700; text-align: right; outline: none;">
                </div>
              </div>
            `;
          });
          
          modifiersHTML += `
            <div style="margin-top: 8px; font-weight: 600; font-size: 13.5px; color: #E2E8F0;">
              <span>Modificadores: ${group.group_name}</span>
              ${optionsHTML}
            </div>
          `;
        });
      }

      // Render base ingredients options for adding new additionals
      let baseIngredientsHTML = '';
      if (prod.exclusions && prod.exclusions.length > 0) {
        let itemsHTML = '';
        prod.exclusions.forEach(item => {
          let isAdditionalEnabled = false;
          if (prod.modifiers) {
            prod.modifiers.forEach(group => {
              if (group.selection_type === 'multiple') {
                const optName = item + ' Extra';
                if (group.options.some(opt => opt.name.toLowerCase() === optName.toLowerCase())) {
                  isAdditionalEnabled = true;
                }
              }
            });
          }

          if (isAdditionalEnabled) {
            itemsHTML += `
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 12.5px; color: #64748B; padding-left: 20px; font-style: italic;">
                <span>• ${item} (Habilitado como Adicional)</span>
                <span style="color: #10B981; font-weight: 700; font-size: 11px;">✓ Habilitado</span>
              </div>
            `;
          } else {
            itemsHTML += `
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 12.5px; color: #94A3B8; padding-left: 20px;">
                <span>• ${item} (Ingrediente base)</span>
                <button onclick="KitchenApp.createAdditionalOption(${prodIdx}, '${item}')" style="background-color: #1E293B; color: #38BDF8; border: 1px solid #0284C7; border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 700; cursor: pointer; outline: none;">
                  ➕ Crear Adicional
                </button>
              </div>
            `;
          }
        });

        baseIngredientsHTML += `
          <div style="margin-top: 10px; font-weight: 600; font-size: 13.5px; color: #E2E8F0;">
            <span>Crear Adicionales para Ingredientes Base:</span>
            ${itemsHTML}
          </div>
        `;
      }
      
      prodDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 14.5px; color: #FFFFFF;">
          <span>${prod.name}</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>$</span>
            <input type="number" value="${prod.price}" 
              data-prod-idx="${prodIdx}" 
              class="input-prod-price" 
              style="width: 110px; background-color: #0F172A; color: #FFFFFF; border: 1px solid #475569; border-radius: 4px; padding: 6px 10px; font-weight: 700; text-align: right; outline: none;">
          </div>
        </div>
        ${modifiersHTML}
        ${baseIngredientsHTML}
      `;
      
      container.appendChild(prodDiv);
    });
    
    document.getElementById('prices-modal').classList.add('open');
  }

  createAdditionalOption(prodIdx, ingredientName) {
    if (!this.selectedId) return;
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    const prod = est.products[prodIdx];
    if (!prod) return;

    if (!prod.modifiers) {
      prod.modifiers = [];
    }

    let group = prod.modifiers.find(g => g.selection_type === 'multiple');
    if (!group) {
      group = {
        group_id: 'mod_auto_' + Date.now(),
        group_name: 'Ingredientes Adicionales',
        selection_type: 'multiple',
        is_required: false,
        options: []
      };
      prod.modifiers.push(group);
    }

    const optionName = ingredientName + ' Extra';
    const exists = group.options.some(opt => opt.name.toLowerCase() === optionName.toLowerCase());
    if (exists) {
      alert(`El adicional "${optionName}" ya existe.`);
      return;
    }

    const newOption = {
      option_id: 'opt_auto_' + Date.now() + '_' + Math.floor(Math.random() * 100),
      name: optionName,
      extra_price: 500
    };

    group.options.push(newOption);
    this.openPricesModal();
  }

  closePricesModal() {
    document.getElementById('prices-modal').classList.remove('open');
  }

  async savePrices() {
    if (!this.selectedId) return;
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;
    
    const key = localStorage.getItem('admin_key_' + this.selectedId) || est.linkKey;
    if (!key) {
      alert('Clave de vinculación no encontrada. Inicie sesión nuevamente.');
      return;
    }
    
    const updatedProducts = JSON.parse(JSON.stringify(est.products));
    
    // Product prices
    const prodInputs = document.querySelectorAll('.input-prod-price');
    prodInputs.forEach(input => {
      const prodIdx = parseInt(input.dataset.prodIdx, 10);
      const newPrice = parseFloat(input.value);
      if (!isNaN(newPrice)) {
        updatedProducts[prodIdx].price = newPrice;
        updatedProducts[prodIdx].base_price = newPrice;
      }
    });
    
    // Modifier prices
    const optInputs = document.querySelectorAll('.input-opt-price');
    optInputs.forEach(input => {
      const prodIdx = parseInt(input.dataset.prodIdx, 10);
      const groupIdx = parseInt(input.dataset.groupIdx, 10);
      const optIdx = parseInt(input.dataset.optIdx, 10);
      const newPrice = parseFloat(input.value);
      if (!isNaN(newPrice)) {
        updatedProducts[prodIdx].modifiers[groupIdx].options[optIdx].extra_price = newPrice;
      }
    });
    
    try {
      const res = await fetch(`/api/establishments/${this.selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkKey: key,
          products: updatedProducts
        })
      });
      
      if (res.ok) {
        est.products = updatedProducts;
        alert('💾 ¡Precios actualizados con éxito en todo el sistema!');
        this.closePricesModal();
      } else {
        const data = await res.json();
        alert('Error al guardar precios: ' + (data.error || 'Problema desconocido'));
      }
    } catch (err) {
      console.error(err);
      alert('Error de red al guardar los precios.');
    }
  }

  callDelivery(orderId) {
    Sound.playBell();
    const orderNum = orderId.split('-')[2] || 'ORD';
    alert(`🚴 ¡Domicilio Solicitado!\nSe ha asignado un repartidor de DeliverCity para el pedido #${orderNum}. Está en camino al establecimiento.`);
    this.updateOrderStatus(orderId, 'Entregado');
  }
}

const KitchenApp = new KitchenController();
window.KitchenApp = KitchenApp;

document.addEventListener('DOMContentLoaded', () => {
  KitchenApp.init();
});
