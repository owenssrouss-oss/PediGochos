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
    const btnCust = document.getElementById('btn-customize-shop');
    if (btn) {
      if (visible) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }
    if (btnCust) {
      if (visible) {
        btnCust.classList.remove('hidden');
      } else {
        btnCust.classList.add('hidden');
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
        await this.triggerCloudBackup();
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

  // Immersive local layout & menu management
  async openMenuTablesModal() {
    if (!this.selectedId) return;
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    window.activeShopIdForMenu = est.id; // Sync with global helper references
    this.activeFloorTool = 'table'; // Default tool

    // Update titles and subtext
    document.getElementById('designer-modal-shop-name').innerText = `🍔 Taller de Menú y Distribución: ${est.name}`;
    document.getElementById('designer-modal-shop-subtext').innerText = `Diseño de distribución de mesas y carta de comida para ${est.name}`;

    // Open Modal
    document.getElementById('menu-tables-modal').classList.add('active');

    // Initialize Layout Grid & Catalog
    this.renderFloorGrid();
    this.loadModalProducts();
    this.loadModalImportCatalog();
  }

  closeMenuTablesModal() {
    document.getElementById('menu-tables-modal').classList.remove('active');
    this.closeProductSpecsModal();
    this.loadEstablishments(); // Reload changes locally
  }

  setFloorTool(tool) {
    this.activeFloorTool = tool;
    
    // Update button active classes
    const tools = ['table', 'wall', 'eraser'];
    tools.forEach(t => {
      const btn = document.getElementById(`tool-${t}`);
      if (btn) {
        if (t === tool) {
          btn.style.background = 'var(--accent)';
          btn.style.color = '#121216';
        } else {
          btn.style.background = 'rgba(255,255,255,0.05)';
          btn.style.color = '#ffffff';
        }
      }
    });
  }

  renderFloorGrid() {
    const canvas = document.getElementById('floor-grid-canvas');
    if (!canvas) return;
    canvas.innerHTML = '';

    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    if (!est.layout) est.layout = [];

    // Render 10x10 grid cells
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const cell = document.createElement('div');
        cell.className = 'floor-cell';
        cell.style.background = 'rgba(255, 255, 255, 0.02)';
        cell.style.border = '1px solid rgba(255, 255, 255, 0.05)';
        cell.style.borderRadius = '6px';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.cursor = 'pointer';
        cell.style.transition = 'all 0.15s';
        
        // Hover effects
        cell.onmouseenter = () => cell.style.background = 'rgba(255, 255, 255, 0.08)';
        cell.onmouseleave = () => {
          const item = est.layout.find(c => c.x === x && c.y === y);
          if (item) {
            if (item.type === 'wall') cell.style.background = '#475569';
            else if (item.type === 'table') cell.style.background = 'rgba(16, 185, 129, 0.15)';
          } else {
            cell.style.background = 'rgba(255, 255, 255, 0.02)';
          }
        };

        // Check if layout item exists at x, y
        const item = est.layout.find(c => c.x === x && c.y === y);
        if (item) {
          if (item.type === 'wall') {
            cell.style.background = '#475569';
            cell.style.borderColor = '#64748b';
            cell.innerHTML = '<span style="font-size:12px;">🧱</span>';
          } else if (item.type === 'table') {
            cell.style.background = 'rgba(16, 185, 129, 0.15)';
            cell.style.borderColor = 'var(--accent)';
            cell.innerHTML = `
              <div style="display:flex; flex-direction:column; align-items:center; gap:2px; color:var(--accent);">
                <span style="font-size:10px;">🪑</span>
                <span style="font-size:8.5px; font-weight:800;">#${item.number}</span>
              </div>
            `;
          }
        }

        cell.onclick = () => this.handleCellClick(x, y);
        canvas.appendChild(cell);
      }
    }
  }

  async handleCellClick(x, y) {
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    if (!est.layout) est.layout = [];

    const existingIdx = est.layout.findIndex(c => c.x === x && c.y === y);

    if (this.activeFloorTool === 'eraser') {
      if (existingIdx !== -1) {
        est.layout.splice(existingIdx, 1);
      }
    } else if (this.activeFloorTool === 'wall') {
      const cellData = { x, y, type: 'wall' };
      if (existingIdx !== -1) est.layout[existingIdx] = cellData;
      else est.layout.push(cellData);
    } else if (this.activeFloorTool === 'table') {
      // Calculate sequence table number
      const existingTables = est.layout.filter(c => c.type === 'table');
      let number = existingTables.length + 1;
      if (existingIdx !== -1 && est.layout[existingIdx].type === 'table') {
        number = est.layout[existingIdx].number;
      }
      
      const cellData = { x, y, type: 'table', number };
      if (existingIdx !== -1) est.layout[existingIdx] = cellData;
      else est.layout.push(cellData);
    }

    // Auto sequential normalization for table numbers
    let tCount = 1;
    est.layout.forEach(cell => {
      if (cell.type === 'table') {
        cell.number = tCount++;
      }
    });

    this.renderFloorGrid();

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          layout: est.layout
        })
      });
      if (res.ok) {
        await this.triggerCloudBackup();
      }
    } catch (err) {
      console.error('Error saving layout cell click:', err);
    }
  }

  async loadModalProducts() {
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    // Load category categories
    if (typeof MenuBuilder !== 'undefined') {
      const cats = await MenuBuilder.getCategories();
      window.categoriesList = cats;

      // Populate Category selector inside create product modal
      const select = document.getElementById('form-category');
      if (select) {
        select.innerHTML = '<option value="">-- Selecciona una categoría --</option>';
        cats.forEach(cat => {
          const opt = document.createElement('option');
          opt.value = cat.id;
          opt.innerText = cat.name;
          select.appendChild(opt);
        });
      }
    }
    
    window.productsList = est.products || [];
    this.renderModalCategories();
    this.renderModalProducts();
  }

  renderModalCategories() {
    const sidebar = document.getElementById('modal-categories-sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = '';

    const allLi = document.createElement('li');
    allLi.className = `category-item ${window.activeCategoryId === 'all' ? 'active' : ''}`;
    allLi.innerText = 'Todos';
    allLi.style.fontSize = '11.5px';
    allLi.style.padding = '8px 10px';
    allLi.style.cursor = 'pointer';
    allLi.style.borderRadius = '8px';
    allLi.onclick = () => this.filterCategoryModal('all');
    sidebar.appendChild(allLi);

    window.categoriesList.forEach(cat => {
      const li = document.createElement('li');
      li.className = `category-item ${window.activeCategoryId === cat.id ? 'active' : ''}`;
      li.innerText = cat.name;
      li.style.fontSize = '11.5px';
      li.style.padding = '8px 10px';
      li.style.cursor = 'pointer';
      li.style.borderRadius = '8px';
      li.onclick = () => this.filterCategoryModal(cat.id);
      sidebar.appendChild(li);
    });
  }

  filterCategoryModal(catId) {
    window.activeCategoryId = catId;
    this.renderModalCategories();
    this.renderModalProducts();
  }

  renderModalProducts() {
    const grid = document.getElementById('modal-products-catalog-grid');
    if (!grid) return;
    grid.innerHTML = '';

    let filtered = window.productsList;
    if (window.activeCategoryId !== 'all') {
      filtered = window.productsList.filter(p => {
        if (p.category_id) return p.category_id === window.activeCategoryId;
        const cat = window.categoriesList.find(c => c.id === window.activeCategoryId);
        if (cat && p.category) return p.category.toLowerCase().includes(cat.slug);
        return false;
      });
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px;">
          No hay productos en esta categoría.
        </div>
      `;
      return;
    }

    filtered.forEach(prod => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.style.background = 'rgba(255, 255, 255, 0.03)';
      card.style.border = '1px solid rgba(255, 255, 255, 0.05)';
      card.style.borderRadius = '14px';
      card.style.padding = '8px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '6px';
      card.style.position = 'relative';
      card.style.cursor = 'pointer';
      card.onclick = () => this.openProductSpecsModal(prod.id);

      const imgUrl = prod.image || '/images/burger_royale.jpg';

      card.innerHTML = `
        <img src="${imgUrl}" alt="${prod.name}" style="width: 100%; aspect-ratio: 1.2/1; object-fit: cover; border-radius: 10px;" onerror="this.src='/images/burger_royale.jpg'">
        <div style="padding: 0;">
          <h4 style="color: #ffffff; font-size: 11px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${prod.name}</h4>
          <p style="font-size: 10px; color: var(--text-muted); line-height: 1.2; margin: 4px 0 0 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${prod.description || 'Sin descripción.'}</p>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto;">
          <span style="color: var(--accent); font-weight: 700; font-size: 11px;">$${parseFloat(prod.price).toFixed(2)}</span>
          <button onclick="event.stopPropagation(); deleteProductFromModal('${prod.id}')" style="background: rgba(239, 68, 68, 0.9); border: none; border-radius: 50%; color: #fff; width: 20px; height: 20px; font-size: 9px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 700;">✕</button>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  async loadModalImportCatalog() {
    const select = document.getElementById('modal-import-product-select');
    if (!select) return;
    select.innerHTML = `<option value="">Cargando...</option>`;

    try {
      if (typeof MenuBuilder !== 'undefined' && MenuBuilder.supabase) {
        const { data, error } = await MenuBuilder.supabase
          .from('products')
          .select('*')
          .order('name');
        
        if (error) throw error;

        this.globalProductsCache = data || [];
        select.innerHTML = `<option value="">-- Selecciona --</option>`;
        this.globalProductsCache.forEach(prod => {
          const opt = document.createElement('option');
          opt.value = prod.id;
          opt.innerText = prod.name;
          select.appendChild(opt);
        });
      }
    } catch (err) {
      console.error(err);
      select.innerHTML = `<option value="">Error de carga</option>`;
    }
  }

  async importGlobalProductFromModal() {
    const select = document.getElementById('modal-import-product-select');
    const prodId = select.value;
    if (!prodId) {
      alert('Selecciona un producto del catálogo.');
      return;
    }

    const selected = this.globalProductsCache.find(p => p.id === prodId);
    if (!selected) return;

    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    if (!est.products) est.products = [];

    // Check duplicate
    if (est.products.some(p => p.name.toLowerCase() === selected.name.toLowerCase())) {
      alert(`El producto "${selected.name}" ya está en el menú.`);
      return;
    }

    const newLocalProduct = {
      id: `p-${Date.now()}-${Math.floor(Math.random() * 100)}`,
      name: selected.name,
      price: parseFloat(selected.price),
      description: selected.description || '',
      image: selected.image_url
    };

    est.products.push(newLocalProduct);

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          products: est.products
        })
      });
      if (res.ok) {
        this.showLocalToast('📥 Producto importado con éxito.');
        this.loadModalProducts();
        await this.triggerCloudBackup();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async deleteProductFromModal(prodId) {
    if (!confirm('¿Seguro que deseas eliminar este producto de la carta?')) return;

    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    est.products = est.products.filter(p => p.id !== prodId);

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          products: est.products
        })
      });
      if (res.ok) {
        this.showLocalToast('🗑️ Producto eliminado de la carta.');
        this.loadModalProducts();
        await this.triggerCloudBackup();
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Specifications/Ingredients editor modal
  openProductSpecsModal(productId) {
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    const prod = est.products.find(p => p.id === productId);
    if (!prod) return;

    this.activeSpecsProductId = productId;
    
    document.getElementById('specs-modal-title').innerText = `⚙️ Especificaciones: ${prod.name}`;
    document.getElementById('specs-product-id').value = productId;

    this.specsIngredients = prod.exclusions ? prod.exclusions.map(e => e.name) : [];
    this.renderSpecsIngredients();

    this.specsGroups = prod.modifiers ? JSON.parse(JSON.stringify(prod.modifiers)) : [];
    this.renderSpecsGroups();

    // Switch container view (embed specs inside floor plan grid slot)
    document.getElementById('floor-plan-grid-container').style.display = 'none';
    document.getElementById('floor-specs-editor-container').style.display = 'block';
  }

  closeProductSpecsModal() {
    document.getElementById('floor-specs-editor-container').style.display = 'none';
    document.getElementById('floor-plan-grid-container').style.display = 'flex';
  }

  renderSpecsIngredients() {
    const container = document.getElementById('specs-ingredients-list');
    if (!container) return;
    container.innerHTML = '';

    if (this.specsIngredients.length === 0) {
      container.innerHTML = `<span style="font-size: 11.5px; color: var(--text-muted);">Sin ingredientes listados</span>`;
      return;
    }

    this.specsIngredients.forEach((ing, idx) => {
      const tag = document.createElement('div');
      tag.style.display = 'flex';
      tag.style.alignItems = 'center';
      tag.style.gap = '6px';
      tag.style.background = 'rgba(255, 94, 58, 0.1)';
      tag.style.border = '1px solid rgba(255, 94, 58, 0.25)';
      tag.style.color = 'var(--accent)';
      tag.style.padding = '4px 10px';
      tag.style.borderRadius = '8px';
      tag.style.fontSize = '12px';
      tag.style.fontWeight = '700';

      tag.innerHTML = `
        <span>${ing}</span>
        <span onclick="KitchenApp.removeIngredientOption(${idx})" style="cursor: pointer; color: #ef4444; font-weight: 900;">✕</span>
      `;
      container.appendChild(tag);
    });
  }

  addIngredientOption() {
    const input = document.getElementById('new-ingredient-input');
    const val = input.value.trim();
    if (!val) return;

    if (this.specsIngredients.includes(val)) {
      alert('Ingrediente duplicado.');
      return;
    }

    this.specsIngredients.push(val);
    input.value = '';
    this.renderSpecsIngredients();
  }

  removeIngredientOption(idx) {
    this.specsIngredients.splice(idx, 1);
    this.renderSpecsIngredients();
  }

  renderSpecsGroups() {
    const container = document.getElementById('specs-groups-container');
    if (!container) return;
    container.innerHTML = '';

    if (this.specsGroups.length === 0) {
      container.innerHTML = `<p style="font-size: 12px; color: #64748b; text-align: center; padding: 10px 0;">Sin modificadores.</p>`;
      return;
    }

    this.specsGroups.forEach((group, gIdx) => {
      const gDiv = document.createElement('div');
      gDiv.style.background = 'rgba(255,255,255,0.02)';
      gDiv.style.border = '1px solid rgba(255,255,255,0.05)';
      gDiv.style.borderRadius = '12px';
      gDiv.style.padding = '12px';
      gDiv.style.display = 'flex';
      gDiv.style.flexDirection = 'column';
      gDiv.style.gap = '10px';
      gDiv.style.marginBottom = '12px';

      gDiv.innerHTML = `
        <div style="display: flex; gap: 8px; align-items: center; justify-content: space-between;">
          <input type="text" value="${group.group_name}" onchange="KitchenApp.updateGroupName('${group.group_id}', this.value)" placeholder="Nombre del grupo" style="flex: 1; padding: 6px 10px; font-size: 12.5px; background: rgba(18,18,22,0.6); border: 1px solid rgba(255,255,255,0.08); color: #fff; border-radius: 8px;">
          
          <select onchange="KitchenApp.updateGroupType('${group.group_id}', this.value)" style="background: rgba(18,18,22,0.6); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 6px; border-radius: 8px; font-size: 11.5px;">
            <option value="single" ${group.selection_type === 'single' ? 'selected' : ''}>Única</option>
            <option value="multiple" ${group.selection_type === 'multiple' ? 'selected' : ''}>Múltiple</option>
          </select>

          <label style="display: flex; align-items: center; gap: 4px; font-size: 11.5px; cursor: pointer; color: #64748b; margin:0;">
            <input type="checkbox" ${group.is_required ? 'checked' : ''} onchange="KitchenApp.updateGroupRequired('${group.group_id}', this.checked)"> Oblig.
          </label>

          <button type="button" onclick="KitchenApp.deleteModifierGroup('${group.group_id}')" style="background: none; border: none; color: #ef4444; font-size: 14px; cursor: pointer; padding: 0; width: auto; height: auto;">🗑️</button>
        </div>

        <div style="border-top: 1px dashed rgba(255,255,255,0.04); padding-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11.5px; color: #64748b; font-weight: 700;">Adicionales</span>
            <button type="button" class="btn-neumorphic" onclick="KitchenApp.addOptionToGroup('${group.group_id}')" style="margin: 0; padding: 4px 8px; font-size: 10px; height: 24px;">➕ Opción</button>
          </div>
          <div id="options-list-${group.group_id}" style="display: flex; flex-direction: column; gap: 6px;"></div>
        </div>
      `;

      const optList = gDiv.querySelector(`#options-list-${group.group_id}`);
      group.options.forEach((opt, oIdx) => {
        const oDiv = document.createElement('div');
        oDiv.style.display = 'flex';
        oDiv.style.gap = '8px';
        oDiv.style.alignItems = 'center';

        oDiv.innerHTML = `
          <input type="text" value="${opt.name}" onchange="KitchenApp.updateOptionName('${group.group_id}', '${opt.option_id}', this.value)" style="flex: 1; padding: 4px 8px; font-size: 11.5px; background: rgba(18,18,22,0.4); border: 1px solid rgba(255,255,255,0.05); color: #fff; border-radius: 6px;">
          <input type="number" value="${opt.price}" onchange="KitchenApp.updateOptionPrice('${group.group_id}', '${opt.option_id}', this.value)" style="width: 80px; padding: 4px 8px; font-size: 11.5px; background: rgba(18,18,22,0.4); border: 1px solid rgba(255,255,255,0.05); color: #fff; border-radius: 6px;">
          <button type="button" onclick="KitchenApp.deleteOptionFromGroup('${group.group_id}', '${opt.option_id}')" style="background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer; padding: 0; width: auto; height: auto;">✕</button>
        `;
        optList.appendChild(oDiv);
      });

      container.appendChild(gDiv);
    });
  }

  addModifierGroup() {
    this.specsGroups.push({
      group_id: 'g-' + Date.now() + '-' + Math.floor(Math.random() * 100),
      group_name: 'Adicionales',
      selection_type: 'single',
      is_required: false,
      options: []
    });
    this.renderSpecsGroups();
  }

  deleteModifierGroup(groupId) {
    this.specsGroups = this.specsGroups.filter(g => g.group_id !== groupId);
    this.renderSpecsGroups();
  }

  updateGroupName(groupId, val) {
    const group = this.specsGroups.find(g => g.group_id === groupId);
    if (group) group.group_name = val.trim();
  }

  updateGroupType(groupId, val) {
    const group = this.specsGroups.find(g => g.group_id === groupId);
    if (group) group.selection_type = val;
  }

  updateGroupRequired(groupId, val) {
    const group = this.specsGroups.find(g => g.group_id === groupId);
    if (group) group.is_required = val;
  }

  addOptionToGroup(groupId) {
    const group = this.specsGroups.find(g => g.group_id === groupId);
    if (group) {
      group.options.push({
        option_id: 'opt-' + Date.now() + '-' + Math.floor(Math.random() * 100),
        name: 'Nuevo adicional',
        price: 0
      });
      this.renderSpecsGroups();
    }
  }

  deleteOptionFromGroup(groupId, optionId) {
    const group = this.specsGroups.find(g => g.group_id === groupId);
    if (group) {
      group.options = group.options.filter(o => o.option_id !== optionId);
      this.renderSpecsGroups();
    }
  }

  updateOptionName(groupId, optionId, val) {
    const group = this.specsGroups.find(g => g.group_id === groupId);
    if (group) {
      const opt = group.options.find(o => o.option_id === optionId);
      if (opt) opt.name = val.trim();
    }
  }

  updateOptionPrice(groupId, optionId, val) {
    const group = this.specsGroups.find(g => g.group_id === groupId);
    if (group) {
      const opt = group.options.find(o => o.option_id === optionId);
      if (opt) opt.price = parseFloat(val) || 0;
    }
  }

  async handleSpecsSubmit(e) {
    e.preventDefault();
    if (!this.activeSpecsProductId) return;

    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    const prod = est.products.find(p => p.id === this.activeSpecsProductId);
    if (!prod) return;

    prod.exclusions = this.specsIngredients.map((name, i) => ({
      id: `ex-${i}`,
      name: name
    }));

    prod.modifiers = this.specsGroups;

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          products: est.products
        })
      });
      if (res.ok) {
        this.showLocalToast('✅ Especificaciones guardadas con éxito.');
        this.closeProductSpecsModal();
        this.loadModalProducts();
        await this.triggerCloudBackup();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async handleProductSubmit(e) {
    e.preventDefault();
    const catSelect = document.getElementById('form-category').value;
    const nameInput = document.getElementById('form-name').value;
    const descInput = document.getElementById('form-desc').value;
    const priceInput = document.getElementById('form-price').value;
    const extrasInput = document.getElementById('form-adicionales') ? document.getElementById('form-adicionales').value : '';
    const fileInput = document.getElementById('form-image').files[0];

    if (!fileInput) {
      alert('Selecciona una imagen.');
      return;
    }

    try {
      const imageUrl = await MenuBuilder.uploadProductImage(fileInput);
      const newProduct = await MenuBuilder.createProduct(catSelect, nameInput, descInput, priceInput, imageUrl);
      
      let modifiers = [];
      if (extrasInput && extrasInput.trim() !== '') {
          const options = extrasInput.split(',').map(ext => {
             const extParts = ext.trim().split(' ');
             let price = parseFloat(extParts.pop());
             if (isNaN(price)) {
                price = 0;
                extParts.push(String(price));
             }
             const priceMatch2 = ext.match(/\d+(?:\.\d+)?$/);
             let val = 0;
             let name = ext.trim();
             if (priceMatch2) {
                 val = parseFloat(priceMatch2[0]);
                 name = ext.replace(/\d+(?:\.\d+)?$/, '').trim();
             }
             return { id: 'opt-' + Date.now() + Math.random(), name: name, price: val };
          }).filter(opt => opt.name !== '');

          if (options.length > 0) {
              modifiers.push({
                  group_id: 'g-extras-' + Date.now(),
                  group_name: 'Adicionales',
                  type: 'multiple',
                  required: false,
                  options: options
              });
          }
      }
      newProduct.modifiers = modifiers.length > 0 ? modifiers : undefined;

      await this.importNewProductToActiveShop(newProduct);
      closeMenuModal();
      this.showLocalToast('🎉 Producto creado e importado.');
    } catch (err) {
      console.error(err);
    }
  }

  async importNewProductToActiveShop(newProduct) {
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    if (!est.products) est.products = [];

    const newLocalProduct = {
      id: `p-${Date.now()}-${Math.floor(Math.random() * 100)}`,
      name: newProduct.name,
      price: parseFloat(newProduct.price),
      description: newProduct.description || '',
      image: newProduct.image_url,
      modifiers: newProduct.modifiers
    };

    est.products.push(newLocalProduct);

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          products: est.products
        })
      });
      if (res.ok) {
        this.loadModalProducts();
        await this.triggerCloudBackup();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async triggerCloudBackup() {
    try {
      if (typeof MenuBuilder === 'undefined' || !MenuBuilder.supabase) {
        console.warn('MenuBuilder not initialized. Cannot run cloud backup.');
        return;
      }
      
      let session = (await MenuBuilder.supabase.auth.getSession()).data.session;
      if (!session) {
        console.log('No active session, attempting anonymous sign in for cloud backup...');
        const { data: authData, error: authError } = await MenuBuilder.supabase.auth.signInAnonymously();
        if (authError) {
          console.error('Anonymous auth failed:', authError.message);
          return;
        }
        session = authData.session;
        console.log('Anonymous sign in successful for backup!');
      }
      
      const estRes = await fetch('/api/owner/establishments');
      if (!estRes.ok) throw new Error('Failed to fetch establishments for backup');
      const establishments = await estRes.json();
      
      const ordRes = await fetch('/api/orders');
      if (!ordRes.ok) throw new Error('Failed to fetch orders for backup');
      const orders = await ordRes.json();
      
      const dbState = { establishments, orders };
      const blob = new Blob([JSON.stringify(dbState, null, 2)], { type: 'application/json' });
      
      console.log('☁️ Triggering cloud backup of db.json to Supabase Storage...');
      const { data, error } = await MenuBuilder.supabase.storage
        .from('menu_images')
        .upload('uploads/db_backup.json', blob, {
          contentType: 'application/json',
          upsert: true
        });
        
      if (error) {
        console.error('Failed to upload db_backup.json:', error.message);
      } else {
        console.log('🎉 Cloud backup of db.json completed successfully!');
      }
    } catch (err) {
      console.error('Error during cloud backup:', err);
    }
  }

  showLocalToast(message, isError = false) {
    const container = document.getElementById('toast-center');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'error' : ''}`;
    toast.innerHTML = `
      <span>${isError ? '⚠️' : '⚡'}</span>
      <p>${message}</p>
    `;
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1) reverse forwards';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 4000);
  }

  callDelivery(orderId) {
    Sound.playBell();
    const orderNum = orderId.split('-')[2] || 'ORD';
    alert(`🚴 ¡Domicilio Solicitado!\nSe ha asignado un repartidor de DeliverCity para el pedido #${orderNum}. Está en camino al establecimiento.`);
    this.updateOrderStatus(orderId, 'Entregado');
  }

  openCustomizeShopModal() {
    if (!this.selectedId) {
      alert('Por favor, selecciona y vincula un establecimiento primero.');
      return;
    }
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    // Populate inputs
    document.getElementById('custom-shop-name').value = est.name || '';
    document.getElementById('custom-shop-desc').value = est.description || '';
    document.getElementById('custom-shop-logo').value = est.logo || '🍔';
    document.getElementById('custom-shop-delivery').value = est.delivery_fee !== undefined ? est.delivery_fee : 0;
    document.getElementById('custom-shop-prep-time').value = est.prep_time || '';
    document.getElementById('custom-shop-delivery-time').value = est.delivery_time || '';
    document.getElementById('custom-shop-theme').value = est.themeColor || '#FF5E3A';

    // Clear file inputs
    document.getElementById('custom-shop-logo-file').value = '';
    document.getElementById('custom-shop-banner-file').value = '';

    document.getElementById('customize-shop-modal').classList.add('active');
  }

  closeCustomizeShopModal() {
    document.getElementById('customize-shop-modal').classList.remove('active');
  }

  async handleCustomizeShopSubmit(e) {
    e.preventDefault();
    if (!this.selectedId) return;

    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    const submitBtn = document.getElementById('btn-submit-customize-shop');
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Guardando Cambios...</span>`;

    const name = document.getElementById('custom-shop-name').value.trim();
    const description = document.getElementById('custom-shop-desc').value.trim();
    const logo = document.getElementById('custom-shop-logo').value;
    const delivery_fee = document.getElementById('custom-shop-delivery').value;
    const themeColor = document.getElementById('custom-shop-theme').value;
    const prep_time = document.getElementById('custom-shop-prep-time').value;
    const delivery_time = document.getElementById('custom-shop-delivery-time').value;

    const logoFile = document.getElementById('custom-shop-logo-file').files[0];
    const bannerFile = document.getElementById('custom-shop-banner-file').files[0];

    let logoImage = est.logoImage || null;
    let banner = est.banner || '';

    try {
      // 1. Upload custom logo file if selected
      if (logoFile) {
        submitBtn.innerHTML = `<span>Subiendo Logo...</span>`;
        logoImage = await MenuBuilder.uploadProductImage(logoFile);
      }

      // 2. Upload cover banner file if selected
      if (bannerFile) {
        submitBtn.innerHTML = `<span>Subiendo Portada...</span>`;
        banner = await MenuBuilder.uploadProductImage(bannerFile);
      }

      // Read linked code/key from storage
      const storageKey = `linked_shop_${this.selectedId}`;
      const linkKey = localStorage.getItem(storageKey);

      const payload = {
        isOwner: false,
        linkKey,
        name,
        description,
        logo,
        delivery_fee: delivery_fee ? parseFloat(delivery_fee) : 0,
        banner,
        themeColor,
        logoImage,
        prep_time: prep_time ? parseInt(prep_time) : null,
        delivery_time: delivery_time ? parseInt(delivery_time) : null
      };

      const res = await fetch(`/api/establishments/${this.selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        this.showLocalToast('✅ Cambios estéticos guardados con éxito.');
        this.closeCustomizeShopModal();
        await this.loadEstablishments();
        
        // Trigger backup to Supabase
        await this.triggerCloudBackup();
      } else {
        const errText = await res.text();
        alert('Error al guardar cambios: ' + errText);
      }
    } catch (err) {
      console.error(err);
      alert('Error de red al actualizar establecimiento.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Guardar Cambios</span>`;
    }
  }
}

const KitchenApp = new KitchenController();
window.KitchenApp = KitchenApp;

document.addEventListener('DOMContentLoaded', () => {
  KitchenApp.init();
});
