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

    // Check URL parameters for direct auto-login (?key=... or ?shop=... or ?store=...)
    const urlParams = new URLSearchParams(window.location.search);
    const directKey = urlParams.get('key') || urlParams.get('clave');
    const directShop = urlParams.get('shop') || urlParams.get('store');

    if (directKey) {
      const keyInp = document.getElementById('auth-link-key');
      if (keyInp) keyInp.value = directKey.trim().toUpperCase();
      await this.verifyAndLinkKeyDirect();
    } else if (directShop) {
      const est = this.establishments.find(e => e.id === directShop.trim() || (e.linkKey && e.linkKey.toUpperCase() === directShop.trim().toUpperCase()));
      if (est && est.linkKey) {
        const keyInp = document.getElementById('auth-link-key');
        if (keyInp) keyInp.value = est.linkKey;
        await this.verifyAndLinkKeyDirect();
      } else {
        await this.checkSupabaseSession();
        this.checkLocalSession();
      }
    } else {
      await this.checkSupabaseSession();
      this.checkLocalSession();
    }

    // Set up auto-stop listeners and audio unlock for persistent alarm
    if (typeof Sound !== 'undefined') {
      const stopAlarmAndUnlock = (e) => {
        try {
          Sound.init();
          // Do not silence if user clicked on the test button itself or banner silence button
          if (e && e.target && (e.target.closest('.sound-test-btn') || e.target.closest('.alarm-btn-silence'))) {
            return;
          }
          // Debounce: do not silence if alarm was triggered in the last 750ms
          if (Date.now() - Sound.lastStartedAt < 750) {
            return;
          }
          if (Sound.isPlayingAlarm) {
            Sound.stopAlarm();
            this.hideAlarmBanner();
          }
        } catch(err) {}
      };

      // Stop alarm automatically when opening/focusing the app or tab
      window.addEventListener('focus', () => {
        if (Sound.isPlayingAlarm && Date.now() - Sound.lastStartedAt > 750) {
          Sound.stopAlarm();
          this.hideAlarmBanner();
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Sound.isPlayingAlarm && Date.now() - Sound.lastStartedAt > 750) {
          Sound.stopAlarm();
          this.hideAlarmBanner();
        }
      });

      document.addEventListener('click', stopAlarmAndUnlock, { passive: true });
      document.addEventListener('touchstart', stopAlarmAndUnlock, { passive: true });
      document.addEventListener('keydown', stopAlarmAndUnlock, { passive: true });

      // Link SoundManager callbacks to UI banner
      Sound.onAlarmStart(() => this.showAlarmBanner());
      Sound.onAlarmStop(() => this.hideAlarmBanner());
    }

    // Start 4-second REST polling fallback to guarantee live order updates & sound notifications
    this.startPollingFallback();
  }

  toggleSoundTest(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (typeof Sound !== 'undefined') {
      Sound.init();
      if (Sound.isPlayingAlarm) {
        Sound.stopAlarm();
        this.hideAlarmBanner();
      } else {
        Sound.startPersistentOrderAlarm(10);
        this.showAlarmBanner('PRUEBA');
      }
    }
  }

  showAlarmBanner(orderCode) {
    let banner = document.getElementById('kitchen-alarm-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'kitchen-alarm-banner';
      banner.className = 'kitchen-alarm-banner';
      banner.innerHTML = `
        <div class="alarm-banner-inner" onclick="if(window.Sound) Sound.stopAlarm(); KitchenApp.hideAlarmBanner();">
          <div class="alarm-banner-left">
            <span class="alarm-siren-icon">🚨</span>
            <div class="alarm-banner-text">
              <div class="alarm-title">¡NUEVO PEDIDO ENTRANTE! <span class="alarm-order-code"></span></div>
              <div class="alarm-subtitle">Toca la pantalla o abre la app para apagar la alarma sonora</div>
            </div>
          </div>
          <button class="alarm-btn-silence" onclick="event.stopPropagation(); if(window.Sound) Sound.stopAlarm(); KitchenApp.hideAlarmBanner();">
            🔕 Silenciar Alarma
          </button>
        </div>
      `;
      document.body.appendChild(banner);
    }
    if (orderCode) {
      const codeEl = banner.querySelector('.alarm-order-code');
      if (codeEl) codeEl.textContent = `#${orderCode}`;
    }
    banner.classList.remove('hidden');
    const testBtn = document.querySelector('.sound-test-btn');
    if (testBtn) testBtn.classList.add('alarm-ringing');
  }

  hideAlarmBanner() {
    const banner = document.getElementById('kitchen-alarm-banner');
    if (banner) {
      banner.classList.add('hidden');
    }
    const testBtn = document.querySelector('.sound-test-btn');
    if (testBtn) testBtn.classList.remove('alarm-ringing');
  }

  startPollingFallback() {
    if (this.pollingTimer) clearInterval(this.pollingTimer);
    this.pollingTimer = setInterval(() => {
      this.pollOrdersFallback();
    }, 4000);
  }

  async pollOrdersFallback() {
    if (!this.selectedId) return;
    try {
      const res = await fetch('/api/orders');
      if (!res.ok) return;
      const allOrders = await res.json();
      if (!Array.isArray(allOrders)) return;

      const shopOrders = allOrders.filter(o => o.establishmentId === this.selectedId);
      const brandNew = shopOrders.filter(so => !this.orders.some(o => o.id === so.id));

      if (brandNew.length > 0) {
        console.log('🚨 [REST Polling] ¡Nuevos pedidos detectados en tiempo real!', brandNew);
        this.orders = shopOrders;
        this.renderOrders();

        const orderCode = brandNew[0].deliveryDetails?.code || brandNew[0].id.slice(-4);
        if (typeof Sound !== 'undefined') {
          Sound.startPersistentOrderAlarm(20);
        }
        this.showAlarmBanner(orderCode);
        this.showToast(`🚨 ¡NUEVO PEDIDO RECIBIDO! #${orderCode}`);
      } else {
        let needsReRender = false;
        shopOrders.forEach(so => {
          const existing = this.orders.find(o => o.id === so.id);
          if (existing && (existing.status !== so.status || existing.updatedAt !== so.updatedAt)) {
            needsReRender = true;
          }
        });

        if (needsReRender) {
          this.orders = shopOrders;
          this.renderOrders();
        }
      }
    } catch(e) {
      console.warn('REST Polling fallback error:', e);
    }
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
          
          // Show active shop info in header
          const activeShopInfo = document.getElementById('active-shop-info');
          const activeLogo = document.getElementById('active-shop-logo');
          const activeName = document.getElementById('active-shop-name');
          
          if (activeShopInfo) activeShopInfo.classList.remove('hidden');
          if (activeLogo) activeLogo.innerText = est.logo || '🏪';
          if (activeName) activeName.innerText = est.name || '';
          
          this.connectWS(est.linkKey || localStorage.getItem('admin_key_' + estId));
        } else {
          console.warn('Asociado a comercio inexistente:', estId);
        }
      } else if (roleData && roleData.role === 'owner') {
        console.log('👑 Sesión detectada como Dueño de la Plataforma. Acceso a cocina concedido.');
        this.showToast('👑 Sesión detectada como Dueño. Puedes ingresar la clave de cualquier comercio.');
      } else {
        console.log('Cuenta de Google (' + user.email + ') sin rol de comercio asignado en Supabase.');
      }
    }
  }

  checkLocalSession() {
    const savedShopId = localStorage.getItem('active_merchant_shop_id');
    const savedKey = localStorage.getItem('admin_key_' + savedShopId);
    
    if (savedShopId && savedKey) {
      const est = this.establishments.find(e => e.id === savedShopId);
      if (est) {
        this.selectedId = savedShopId;
        
        // Show active shop info in header
        const activeShopInfo = document.getElementById('active-shop-info');
        const activeLogo = document.getElementById('active-shop-logo');
        const activeName = document.getElementById('active-shop-name');
        
        if (activeShopInfo) activeShopInfo.classList.remove('hidden');
        if (activeLogo) activeLogo.innerText = est.logo || '🏪';
        if (activeName) activeName.innerText = est.name || '';
        
        // Update hidden select
        const select = document.getElementById('merchant-shop-select');
        if (select) select.value = savedShopId;
        
        document.getElementById('no-shop-overlay').classList.add('hidden');
        this.connectWS(savedKey);
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

  async verifyAndLinkKeyDirect() {
    const keyInput = document.getElementById('auth-link-key').value.trim().toUpperCase();
    const errorMsg = document.getElementById('auth-error-msg');
    
    if (!keyInput) {
      alert('Por favor, introduce la clave de vinculación.');
      return;
    }
    
    try {
      const res = await fetch('/api/merchant/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyInput })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        errorMsg.classList.add('hidden');
        
        const est = data.establishment;
        this.selectedId = est.id;
        
        // Save session locally
        localStorage.setItem('active_merchant_shop_id', est.id);
        localStorage.setItem('admin_key_' + est.id, keyInput);
        
        // Show active shop info in header
        const activeShopInfo = document.getElementById('active-shop-info');
        const activeLogo = document.getElementById('active-shop-logo');
        const activeName = document.getElementById('active-shop-name');
        
        if (activeShopInfo) activeShopInfo.classList.remove('hidden');
        if (activeLogo) activeLogo.innerText = est.logo || '🏪';
        if (activeName) activeName.innerText = est.name || '';
        
        // Update hidden select element
        const select = document.getElementById('merchant-shop-select');
        if (select) select.value = est.id;
        
        document.getElementById('no-shop-overlay').classList.add('hidden');
        document.getElementById('auth-link-key').value = '';
        
        // Reload establishments list in memory to make sure we have product/menu details
        await this.loadEstablishments();
        
        this.connectWS(keyInput);
      } else {
        errorMsg.innerText = data.error || 'Clave incorrecta. Inténtalo de nuevo.';
        errorMsg.classList.remove('hidden');
      }
    } catch (e) {
      console.error(e);
      errorMsg.innerText = 'Error de conexión al verificar la clave.';
      errorMsg.classList.remove('hidden');
    }
  }

  async logoutMerchant() {
    this.closeWS();
    
    // Clear storage
    const savedShopId = localStorage.getItem('active_merchant_shop_id');
    if (savedShopId) {
      localStorage.removeItem('admin_key_' + savedShopId);
      localStorage.removeItem('active_merchant_shop_id');
    }
    
    // Clear Google session
    if (typeof SupabaseApp !== 'undefined') {
      await SupabaseApp.logout();
    }
    
    this.selectedId = '';
    
    // Hide active shop info in header
    const activeShopInfo = document.getElementById('active-shop-info');
    if (activeShopInfo) activeShopInfo.classList.add('hidden');
    
    // Reset hidden select element value
    const select = document.getElementById('merchant-shop-select');
    if (select) select.value = '';
    
    // Show login overlay
    document.getElementById('no-shop-overlay').classList.remove('hidden');
    document.getElementById('auth-error-msg').classList.add('hidden');
    document.getElementById('auth-link-key').value = '';
    
    // Reset page view
    this.orders = [];
    this.renderOrders();
    this.updatePricesButtonVisibility(false);
  }

  switchEstablishment(id) {
    this.selectedId = id;
    const overlay = document.getElementById('no-shop-overlay');

    // Reset error message and inputs
    document.getElementById('auth-error-msg').classList.add('hidden');
    document.getElementById('auth-link-key').value = '';
    this.updatePricesButtonVisibility(false);

    if (!id) {
      overlay.classList.remove('hidden');
      this.closeWS();
      this.orders = [];
      this.renderOrders();
      return;
    }

    overlay.classList.add('hidden');
    
    // Check if we have a saved linked key for this establishment
    const savedKey = localStorage.getItem('admin_key_' + id);
    if (savedKey) {
      this.connectWS(savedKey);
    } else {
      overlay.classList.remove('hidden');
      this.closeWS();
      this.orders = [];
      this.renderOrders();
    }
  }

  closeWS() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
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

    const key = customKey || this.activeKey || localStorage.getItem('admin_key_' + this.selectedId);
    if (!key) {
      console.warn('No linking key found. Re-authorization required.');
      return;
    }
    this.activeKey = key;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log('Connecting to WebSocket:', wsUrl);
    this.ws = new WebSocket(wsUrl);

    // Keep-Alive Ping Timer (every 20 seconds) to prevent Render / proxy idle timeouts
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 20000);

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
        if (data.type === 'PONG') return;

        console.log('WS Message Received:', data);

        if (data.type === 'AUTH_ERROR') {
          console.error(data.message);
          const overlay = document.getElementById('no-shop-overlay');
          if (overlay) overlay.classList.remove('hidden');
          
          const errorMsg = document.getElementById('auth-error-msg');
          if (errorMsg) {
            errorMsg.innerText = data.message;
            errorMsg.classList.remove('hidden');
          }
          
          const activeShopInfo = document.getElementById('active-shop-info');
          if (activeShopInfo) activeShopInfo.classList.add('hidden');
          
          localStorage.removeItem('admin_key_' + this.selectedId);
          localStorage.removeItem('active_merchant_shop_id');
          
          this.closeWS();
          this.orders = [];
          this.renderOrders();
          return;
        }

        if (data.type === 'INITIAL_ORDERS') {
          this.orders = data.orders;
          this.renderOrders();
          this.updatePricesButtonVisibility(true);
        }

        if (data.type === 'NEW_ORDER') {
          const exists = this.orders.some(o => o.id === data.order.id);
          if (!exists) {
            this.orders.push(data.order);
            this.renderOrders();
            const orderCode = data.order.deliveryDetails?.code || data.order.id.slice(-4);
            if (typeof Sound !== 'undefined') {
              Sound.startPersistentOrderAlarm(20);
            }
            this.showAlarmBanner(orderCode);
            this.showToast(`🚨 ¡NUEVO PEDIDO RECIBIDO! #${orderCode}`);
          }
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
      if (this.pingTimer) clearInterval(this.pingTimer);
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
    const btnPanic = document.getElementById('btn-panic-high-traffic');
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
    const btnPromo = document.getElementById('btn-daily-promo');
    if (btnPromo) {
      if (visible) {
        btnPromo.classList.remove('hidden');
      } else {
        btnPromo.classList.add('hidden');
      }
    }
    if (btnPanic) {
      if (visible) {
        btnPanic.classList.remove('hidden');
        const est = this.establishments.find(e => e.id === this.selectedId);
        this.updatePanicButtonUI(est);
      } else {
        btnPanic.classList.add('hidden');
      }
    }
  }

  updatePanicButtonUI(est) {
    const btn = document.getElementById('btn-panic-high-traffic');
    const icon = document.getElementById('panic-icon');
    const text = document.getElementById('panic-text');
    if (!btn) return;

    const isHigh = Boolean(est && est.isHighTraffic);
    const extra = (est && est.extraPrepTime) || 20;

    if (isHigh) {
      btn.style.background = '#dc2626';
      btn.style.color = '#ffffff';
      btn.style.borderColor = '#ef4444';
      btn.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.6)';
      if (icon) icon.innerText = '🚨';
      if (text) text.innerText = `TRÁFICO ALTO ACTIVO (+${extra} min)`;
    } else {
      btn.style.background = 'rgba(239, 68, 68, 0.15)';
      btn.style.color = '#f87171';
      btn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      btn.style.boxShadow = 'none';
      if (icon) icon.innerText = '🚨';
      if (text) text.innerText = `Modo Tráfico Alto (+${extra} min)`;
    }
  }

  async toggleHighTrafficPanicMode() {
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    const currentStatus = Boolean(est.isHighTraffic);
    const nextStatus = !currentStatus;

    let extraTime = est.extraPrepTime || 20;

    if (nextStatus) {
      const userInput = prompt('🚨 BOTÓN DE PÁNICO - TRÁFICO ALTO EN COCINA\n\n¿Cuántos minutos adicionales deseas sumar al tiempo de entrega de tus clientes?', extraTime.toString());
      if (userInput === null) return; // User cancelled
      const parsed = parseInt(userInput);
      if (!isNaN(parsed) && parsed > 0) {
        extraTime = parsed;
      }
    }

    est.isHighTraffic = nextStatus;
    est.extraPrepTime = extraTime;

    this.updatePanicButtonUI(est);

    const currentLinkKey = localStorage.getItem(`admin_key_${this.selectedId}`) || est.linkKey || '';

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: false,
          linkKey: currentLinkKey,
          isHighTraffic: nextStatus,
          extraPrepTime: extraTime
        })
      });

      if (res.ok) {
        if (nextStatus) {
          this.showLocalToast(`🚨 ¡TRÁFICO ALTO ACTIVADO! Se han sumado +${extraTime} min al tiempo de entrega.`);
        } else {
          this.showLocalToast(`🟢 ¡Modo Tráfico Normal Restablecido!`);
        }
      }
    } catch (err) {
      console.error(err);
      alert('Error al actualizar el modo de tráfico alto.');
    }
  }

  showToast(message, isError = false) {
    this.showLocalToast(message, isError);
  }

  formatCop(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '$0 COP';
    let num = parseFloat(amount);
    if (num < 1000 && num > 0) {
      num = num * 1000;
    }
    return `$${Math.round(num).toLocaleString('de-DE')} COP`;
  }

  async updateOrderStatus(orderId, nextStatus, driver = null) {
    // 1. Local update
    const ord = (this.orders || []).find(o => String(o.id) === String(orderId));
    if (ord) {
      ord.status = nextStatus;
      if (driver) ord.driver = driver;
      this.renderOrders();
    }

    // 2. WebSocket broadcast
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'UPDATE_STATUS',
        orderId: orderId,
        status: nextStatus
      };
      if (driver) payload.driver = driver;
      this.ws.send(JSON.stringify(payload));
    }

    // 3. HTTP API fallback update to server
    try {
      const bodyData = { status: nextStatus };
      if (driver) bodyData.driver = driver;
      await fetch(`/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });
    } catch(e) {
      console.warn('HTTP status update fallback error:', e);
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

    const activeOrders = this.orders.filter(o => o.status !== 'Entregado' && o.status !== 'Cancelado');

    activeOrders.forEach(order => {
      // Auto-generate code for old delivery orders if not present
      if (order.orderType === 'delivery') {
        if (!order.deliveryDetails) order.deliveryDetails = {};
        order.deliveryDetails.code = order.deliveryDetails.code || Math.floor(1000 + Math.random() * 9000).toString();
      }

      const card = document.createElement('div');
      card.className = 'order-card';

      let itemsListHTML = '';
      order.items.forEach(item => {
        let specsHTML = '';
        if (item.selected_specifications && typeof item.selected_specifications === 'object') {
          const specParts = [];
          const specs = item.selected_specifications;
          if (Array.isArray(specs.single_selections)) {
            specs.single_selections.forEach(sel => {
              if (sel && sel.chosen_option) {
                const deltaVal = sel.price_delta ? (sel.price_delta < 1000 && sel.price_delta > 0 ? sel.price_delta * 1000 : sel.price_delta) : 0;
                const delta = deltaVal > 0 ? ` (+${this.formatCop(deltaVal)})` : '';
                specParts.push(`${sel.group_name || 'Opción'}: ${sel.chosen_option}${delta}`);
              }
            });
          }
          if (Array.isArray(specs.add_ons)) {
            specs.add_ons.forEach(add => {
              if (add && add.name) {
                const aQty = add.quantity || 1;
                const unitP = add.price_per_unit || 0;
                const totalP = (unitP < 1000 && unitP > 0 ? unitP * 1000 : unitP) * aQty;
                const priceText = totalP > 0 ? ` (+${this.formatCop(totalP)})` : '';
                specParts.push(`+ ${aQty}x ${add.name}${priceText}`);
              }
            });
          }
          if (Array.isArray(specs.exclusions)) {
            specs.exclusions.forEach(exc => {
              if (exc && exc.name) specParts.push(`- Sin ${exc.name}`);
            });
          }
          if (specs.special_notes && String(specs.special_notes).trim()) {
            specParts.push(`Nota: "${String(specs.special_notes).trim()}"`);
          }
          if (specParts.length > 0) {
            specsHTML = `<div class="order-item-specs" style="font-size: 11.5px; line-height: 1.4; color: #FBBF24; margin-top: 2px;">${specParts.join('<br>')}</div>`;
          }
        } else if (item.specifications) {
          const formattedSpecs = item.specifications.split(' | ').join('<br>');
          specsHTML = `<div class="order-item-specs" style="font-size: 11.5px; line-height: 1.4; color: #FBBF24; margin-top: 2px;">${formattedSpecs}</div>`;
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
        let phoneRow = '';
        if (order.customerPhone || (order.deliveryDetails && order.deliveryDetails.phone)) {
          const ph = order.customerPhone || order.deliveryDetails.phone;
          phoneRow = `<p style="margin-top: 4px;"><strong>Tlf:</strong> <a href="#" onclick="KitchenApp.handleCustomerWhatsAppClick(event, '${order.id}')" style="color: #10B981; text-decoration: none; font-weight: 800; background: rgba(16, 185, 129, 0.15); padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(16, 185, 129, 0.3);">💬 ${ph} (Confirmar)</a></p>`;
        }
        detailsHTML = `<div class="order-address-box"><strong>📍 Consumo Local</strong><p>Servir en Mesa #${order.tableNumber}</p>${phoneRow}</div>`;
      } else {
        typeBadge = `<span class="order-type-badge delivery">Delivery</span>`;
        const phoneLink = `<a href="#" onclick="KitchenApp.handleCustomerWhatsAppClick(event, '${order.id}')" style="color: #10B981; text-decoration: none; font-weight: 800; background: rgba(16, 185, 129, 0.15); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.3); display: inline-flex; align-items: center; gap: 4px;" title="Enviar confirmación y cuenta por WhatsApp">💬 ${order.deliveryDetails.phone || 'N/A'} (Confirmar)</a>`;
        const codeHTML = order.deliveryDetails.code ? `<p><strong>Código de Seguridad:</strong> <span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-weight: 700; color: var(--accent);">${order.deliveryDetails.code}</span></p>` : '';
        const housePhotoUrl = order.deliveryDetails.housePhotoUrl || order.deliveryDetails.house_photo_url || null;
        const photoHTML = housePhotoUrl 
          ? `<div style="margin-top: 8px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15);">
               <strong style="color: #60A5FA; font-size: 11.5px; display: block; margin-bottom: 6px;">🏡 Foto de Fachada / Casa:</strong>
               <a href="${housePhotoUrl}" target="_blank" style="display: block; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.2);">
                 <img src="${housePhotoUrl}" alt="Fachada Casa" style="width: 100%; max-height: 150px; object-fit: cover; border-radius: 6px; display: block;">
               </a>
             </div>` 
          : '';

        detailsHTML = `
          <div class="order-address-box">
            <strong>🚴 Envío a Domicilio</strong>
            <p><strong>Tlf:</strong> ${phoneLink}</p>
            <p><strong>Dir:</strong> ${order.deliveryDetails.address || 'N/A'}</p>
            ${codeHTML}
            ${photoHTML}
          </div>
        `;
      }

      const orderTimeRaw = order.createdAt || order.created_at;
      const elapsedMins = orderTimeRaw ? Math.floor((new Date() - new Date(orderTimeRaw)) / 60000) : 0;
      const isLate = elapsedMins >= 15 ? 'late' : '';

      const paymentBadge = order.paymentStatus === 'Pagado' ? '<span class="payment-badge paid" style="background-color: #10b981; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 6px;">💳 Pagado</span>' : '<span class="payment-badge pending" style="background-color: #f59e0b; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 6px;">💳 Pendiente</span>';
      
      const payMethodBadge = order.paymentMethod === 'Transferencia' 
        ? '<span style="background-color: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid #3b82f6; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 4px;">📲 Transferencia</span>'
        : '<span style="background-color: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-left: 4px;">💵 Efectivo</span>';

      const payNotesHTML = order.paymentNotes ? `<div style="font-size: 11px; color: #f59e0b; font-weight: 700; margin-top: 4px; background: rgba(245,158,11,0.08); padding: 4px 8px; border-radius: 6px;">💬 Nota de Pago: ${order.paymentNotes}</div>` : '';

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
            <h4 class="customer-name">${order.customerName} ${paymentBadge} ${payMethodBadge}</h4>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
            ${typeBadge}
            <span class="order-timer ${isLate}" data-created="${order.createdAt || order.created_at || ''}">⏱️ hace ${elapsedMins} min</span>
          </div>
        </div>
        
        <ul class="order-items-list">
          ${itemsListHTML}
        </ul>

        ${detailsHTML}
        ${payNotesHTML}
        
        <div class="order-total-price">Total: $${Math.round(order.total).toLocaleString('de-DE')}</div>

        <div class="order-card-actions" style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px; width: 100%;">
          ${actionBtnHTML}
          <button class="btn-card-action cancel" onclick="KitchenApp.cancelOrderPrompt('${order.id}')">❌ Cancelar Pedido</button>
        </div>
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

  async callDelivery(orderId) {
    try {
      const order = (this.orders || []).find(o => String(o.id) === String(orderId));
      if (!order) {
        alert('No se encontró el pedido seleccionado.');
        return;
      }

      if (typeof Sound !== 'undefined' && Sound.playBell) {
        Sound.playBell();
      }
      
      // Auto-generate code if missing
      if (order.orderType === 'delivery') {
        if (!order.deliveryDetails) order.deliveryDetails = {};
        order.deliveryDetails.code = order.deliveryDetails.code || Math.floor(1000 + Math.random() * 9000).toString();
      }

      // Fetch next rotated driver equitably
      let assignedDriver = {
        id: 'default-central',
        name: 'Central Gocho',
        phone: '573227949751',
        totalDeliveries: 0
      };

      try {
        const driverRes = await fetch('/api/drivers/next-available');
        if (driverRes.ok) {
          const driverData = await driverRes.json();
          if (driverData && driverData.driver) {
            assignedDriver = driverData.driver;
          }
        }
      } catch(e) {
        console.warn('Error fetching rotated driver, using fallback:', e);
      }

      const driverName = assignedDriver.name || 'Repartidor';
      const driverPhone = assignedDriver.phone || '573227949751';

      let cleanDriverPhone = String(driverPhone).replace(/\D/g, '');
      if (cleanDriverPhone.startsWith('04')) {
        cleanDriverPhone = '58' + cleanDriverPhone.slice(1);
      } else if (cleanDriverPhone.startsWith('4') && cleanDriverPhone.length === 10) {
        cleanDriverPhone = '58' + cleanDriverPhone;
      } else if (cleanDriverPhone.startsWith('3') && cleanDriverPhone.length === 10) {
        cleanDriverPhone = '57' + cleanDriverPhone;
      }

      // Build driver notification message
      const storeName = (this.establishments || []).find(e => String(e.id) === String(this.selectedId))?.name || order.establishmentName || 'El Local';
      const clientName = order.customerName || 'Cliente';
      const clientPhone = order.deliveryDetails?.phone || 'N/A';
      const clientAddress = order.deliveryDetails?.address || 'N/A';
      const housePhotoUrl = order.deliveryDetails?.housePhotoUrl || null;
      const clientLat = order.deliveryDetails?.latitude;
      const clientLng = order.deliveryDetails?.longitude;

      // Itemized order text with full COP prices
      const itemsSummary = (order.items || []).map(item => {
        let line = `• ${item.quantity}x ${item.name}`;
        if (item.specifications) line += ` (${item.specifications})`;
        const rawSub = item.subtotal_combined || (item.price * item.quantity);
        const subCop = rawSub < 1000 ? rawSub * 1000 : rawSub;
        line += ` - $${Math.round(subCop).toLocaleString('de-DE')} COP`;
        return line;
      }).join('\n');

      const rawTotal = order.total || 0;
      const totalCop = Math.round(rawTotal < 1000 ? rawTotal * 1000 : rawTotal);
      const formattedTotal = `$${totalCop.toLocaleString('de-DE')} COP`;
      const payMethodText = order.paymentMethod === 'Transferencia' ? '📲 Transferencia / Pago Móvil (Verificado)' : `💵 Efectivo contra entrega${order.paymentNotes ? ` (${order.paymentNotes})` : ''}`;

      let messageText = `🚴 *Rapi Gochos - SOLICITUD DE DOMICILIO*\n` +
        `👤 *Asignado a:* ${driverName}\n\n` +
        `🏬 *Establecimiento:* ${storeName}\n` +
        `👤 *Cliente:* ${clientName}\n` +
        `📞 *Teléfono:* ${clientPhone}\n` +
        `📍 *Dirección de Entrega:* ${clientAddress}\n` +
        `💳 *Forma de Pago:* ${payMethodText}\n`;

      if (clientLat && clientLng) {
        messageText += `🗺️ *Ubicación GPS:* https://maps.google.com/?q=${clientLat},${clientLng}\n`;
      }

      messageText += `\n📝 *DETALLE DE LA ORDEN:*\n${itemsSummary}\n\n` +
        `💰 *TOTAL A COBRAR EN DESTINO:* ${formattedTotal}`;

      if (housePhotoUrl) {
        messageText += `\n\n🏡 *FOTO FACHADA/CASA:* ${housePhotoUrl}`;
      }

      const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanDriverPhone}&text=${encodeURIComponent(messageText)}`;
      
      try {
        this.showLocalToast(`✨ Pedido asignado a ${driverName} (${driverPhone})`);
      } catch(e) {
        console.log('Toast error suppressed');
      }

      // Open WhatsApp safely in a new tab without blocking navigation or leaving dashboard
      let opened = false;
      try {
        const waLink = document.createElement('a');
        waLink.href = whatsappUrl;
        waLink.target = '_blank';
        waLink.rel = 'noopener noreferrer';
        document.body.appendChild(waLink);
        waLink.click();
        setTimeout(() => waLink.remove(), 300);
        opened = true;
      } catch(e) {
        opened = false;
      }

      if (!opened) {
        try {
          window.open(whatsappUrl, '_blank');
        } catch(e) {}
      }

      // Persist status and driver to server
      await this.updateOrderStatus(orderId, 'En Camino', assignedDriver);
    } catch(outerErr) {
      console.error('Error in callDelivery:', outerErr);
      alert('Se produjo un error al procesar el despacho a domicilio.');
    }
  }

  cancelOrderPrompt(orderId) {
    const reason = prompt('Por favor, ingresa la razón de la cancelación del pedido:');
    if (reason === null) return; // User cancelled prompt
    
    const cleanReason = reason.trim();
    if (!cleanReason) {
      alert('Debes ingresar una razón válida para cancelar el pedido.');
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'UPDATE_STATUS',
        orderId: orderId,
        status: 'Cancelado',
        reason: cleanReason
      }));
    }
  }

  async handleCustomerWhatsAppClick(event, orderId) {
    if (event) event.preventDefault();
    
    const order = (this.orders || []).find(o => String(o.id) === String(orderId));
    if (!order) {
      alert('No se encontró el pedido seleccionado.');
      return;
    }

    if (!confirm('¿Deseas enviar la solicitud de confirmación de pedido al cliente por WhatsApp?')) {
      return;
    }

    // 1. Mark order payment status if needed (or broadcast status)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'UPDATE_STATUS',
        orderId: orderId,
        paymentStatus: order.paymentStatus || 'Pagado'
      }));
    }

    // Auto-generate security code if missing
    if (order.orderType === 'delivery') {
      if (!order.deliveryDetails) order.deliveryDetails = {};
      order.deliveryDetails.code = order.deliveryDetails.code || Math.floor(1000 + Math.random() * 9000).toString();
    }

    // 2. Parse customer phone (without using customer personal name)
    let rawPhone = order.deliveryDetails?.phone || order.customerPhone || '';
    let cleanPhone = String(rawPhone).replace(/\D/g, '');
    if (cleanPhone.startsWith('04')) {
      cleanPhone = '58' + cleanPhone.slice(1);
    } else if (cleanPhone.startsWith('4') && cleanPhone.length === 10) {
      cleanPhone = '58' + cleanPhone;
    } else if (cleanPhone.startsWith('3') && cleanPhone.length === 10) {
      cleanPhone = '57' + cleanPhone;
    }
    
    const storeName = (this.establishments || []).find(e => String(e.id) === String(this.selectedId))?.name || order.establishmentName || 'El Restaurante';
    const orderCode = order.deliveryDetails?.code || (order.id ? String(order.id).slice(-4) : 'ORD');

    // 3. Build detailed items summary with explicit addition quantities (1x, 2x) & subtotals
    let totalItemsCount = 0;
    let productsSubtotal = 0;

    const itemsSummaryLines = (order.items || []).map(item => {
      const qty = item.quantity || 1;
      totalItemsCount += qty;

      let itemSub = item.subtotal_combined || (item.unit_total_calculated ? item.unit_total_calculated * qty : (item.price || 0) * qty);
      if (itemSub < 1000 && itemSub > 0) itemSub = itemSub * 1000;
      productsSubtotal += Math.round(itemSub);

      let itemBlock = `• *${qty}x* ${item.name}`;

      const specLines = [];

      // Check structured selected_specifications
      if (item.selected_specifications && typeof item.selected_specifications === 'object') {
        const specs = item.selected_specifications;

        if (Array.isArray(specs.single_selections) && specs.single_selections.length > 0) {
          specs.single_selections.forEach(sel => {
            if (sel && sel.chosen_option) {
              const deltaVal = sel.price_delta ? (sel.price_delta < 1000 && sel.price_delta > 0 ? sel.price_delta * 1000 : sel.price_delta) : 0;
              const delta = deltaVal > 0 ? ` (+${this.formatCop(deltaVal)})` : '';
              specLines.push(`  ↳ • ${sel.group_name || 'Opción'}: ${sel.chosen_option}${delta}`);
            }
          });
        }

        if (Array.isArray(specs.add_ons) && specs.add_ons.length > 0) {
          specs.add_ons.forEach(add => {
            if (add && add.name) {
              const aQty = add.quantity || 1;
              const unitP = add.price_per_unit || 0;
              const totalP = (unitP < 1000 && unitP > 0 ? unitP * 1000 : unitP) * aQty;
              const priceText = totalP > 0 ? ` (+${this.formatCop(totalP)})` : '';
              specLines.push(`  ↳ + *${aQty}x* ${add.name}${priceText}`);
            }
          });
        }

        if (Array.isArray(specs.exclusions) && specs.exclusions.length > 0) {
          specs.exclusions.forEach(exc => {
            if (exc && exc.name) {
              specLines.push(`  ↳ - Sin ${exc.name}`);
            }
          });
        }

        if (specs.special_notes && String(specs.special_notes).trim()) {
          specLines.push(`  ↳ 📝 Nota: "${String(specs.special_notes).trim()}"`);
        }
      } else if (item.specifications && String(item.specifications).trim()) {
        const parts = String(item.specifications).split(' | ');
        parts.forEach(p => {
          if (p.trim()) {
            specLines.push(`  ↳ _${p.trim()}_`);
          }
        });
      }

      if (specLines.length > 0) {
        itemBlock += '\n' + specLines.join('\n');
      }

      itemBlock += `\n  ↳ *Subtotal: ${this.formatCop(itemSub)}*`;
      return itemBlock;
    });

    // 4. Financial calculations
    const rawTotal = order.total || 0;
    const finalTotal = Math.round(rawTotal < 1000 && rawTotal > 0 ? rawTotal * 1000 : rawTotal);

    let deliveryFee = 0;
    if (order.orderType === 'delivery' || order.orderType === 'Delivery') {
      if (order.deliveryDetails && order.deliveryDetails.deliveryFee) {
        deliveryFee = order.deliveryDetails.deliveryFee;
      } else if (order.delivery_fee) {
        deliveryFee = order.delivery_fee;
      } else if (finalTotal > productsSubtotal) {
        deliveryFee = finalTotal - productsSubtotal;
      }
    }
    if (deliveryFee < 1000 && deliveryFee > 0) deliveryFee = deliveryFee * 1000;

    let accountBreakdown = `• *Subtotal Productos:* ${this.formatCop(productsSubtotal)}\n`;
    if (deliveryFee > 0) {
      accountBreakdown += `• *Costo de Envío:* ${this.formatCop(deliveryFee)}\n`;
    }
    if (order.discount && order.discount > 0) {
      accountBreakdown += `• *Descuento Cupón:* -${this.formatCop(order.discount)}\n`;
    }
    accountBreakdown += `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 *TOTAL A PAGAR:* *${this.formatCop(finalTotal)}*`;

    // 5. Modality & payment details
    let modalLabel = '🚴 Envío a Domicilio';
    let deliveryExtraLines = '';
    const securityCode = (order.deliveryDetails && order.deliveryDetails.code) ? order.deliveryDetails.code : 'N/A';

    if (order.orderType === 'mesa' || order.tableNumber) {
      modalLabel = `🍽️ Consumo en Local (Mesa #${order.tableNumber || '1'})`;
    } else if (order.orderType === 'pickup') {
      modalLabel = `🛍️ Para Llevar / Retiro en Restaurante`;
    } else {
      const address = order.deliveryDetails?.address || 'Dirección acordada';
      deliveryExtraLines = `• *Dirección de Entrega:* ${address}\n• *Código de Entrega:* *${securityCode}*`;
    }

    let payMethodText = '💵 Efectivo';
    if (order.paymentMethod === 'Transferencia') {
      payMethodText = '📲 Transferencia Bancaria / Pago Móvil';
    } else if (order.paymentMethod === 'Efectivo') {
      payMethodText = order.paymentNotes ? `💵 Efectivo (${order.paymentNotes})` : '💵 Efectivo contra entrega';
    } else if (order.paymentMethod) {
      payMethodText = order.paymentMethod;
    }

    // 6. Confirmation request message with items, address, security code, and safety warnings (No sensitive customer name)
    const confirmationMessage =
      `👋 ¡Hola! Te saludamos de *${storeName}* 🏪\n\n` +
      `Hemos recibido una solicitud de pedido asociada a este número. Por favor *confírmanos si realizaste esta orden* respondiendo a este mensaje para comenzar su preparación de inmediato 👨‍🍳\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 *DETALLE DEL PEDIDO:* (#${orderCode})\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${itemsSummaryLines.join('\n\n')}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📍 *DATOS DE ENTREGA Y SERVICIO:*\n` +
      `• *Modalidad:* ${modalLabel}\n` +
      (deliveryExtraLines ? `${deliveryExtraLines}\n` : '') +
      `• *Forma de Pago:* ${payMethodText}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 *DESGLOSE DE LA CUENTA:*\n` +
      `${accountBreakdown}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `⚠️ *ACCIONES REQUERIDAS Y ADVERTENCIAS:*\n` +
      `1️⃣ *Confirmación:* Responde este mensaje con un *"SÍ, CONFIRMO EL PEDIDO"* para ingresar tu orden a cocina.\n` +
      (order.orderType === 'delivery' ? `2️⃣ *Seguridad:* Entrega el código *${securityCode}* ÚNICAMENTE en persona al repartidor al recibir tu entrega.\n` : '') +
      `3️⃣ *Verificación:* Revisa que los artículos y la dirección sean exactos para evitar demoras.\n\n` +
      `¡Esperamos tu pronta confirmación para comenzar a preparar tu comida! ✨🍽️`;

    const clientWhatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(confirmationMessage)}`;

    try {
      this.showLocalToast(`💬 Abriendo WhatsApp para solicitar confirmación...`);
    } catch(e) {}

    let opened = false;
    try {
      const waLink = document.createElement('a');
      waLink.href = clientWhatsappUrl;
      waLink.target = '_blank';
      waLink.rel = 'noopener noreferrer';
      document.body.appendChild(waLink);
      waLink.click();
      setTimeout(() => waLink.remove(), 300);
      opened = true;
    } catch(e) {
      opened = false;
    }

    if (!opened) {
      try {
        window.open(clientWhatsappUrl, '_blank');
      } catch(e) {}
    }
  }

  openDailyPromoModal() {
    if (!this.selectedId) return;
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    const modal = document.getElementById('kitchen-promo-modal');
    if (!modal) return;

    // Populate products select
    const select = document.getElementById('promo-select-product');
    if (select) {
      select.innerHTML = '<option value="">-- Nuevo Plato en Promoción --</option>';
      const products = est.products || [];
      products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.innerText = `${p.name} ($${(p.price || 0).toLocaleString('de-DE')})`;
        select.appendChild(opt);
      });
    }

    document.getElementById('promo-title').value = '';
    document.getElementById('promo-description').value = '';
    document.getElementById('promo-original-price').value = '';
    document.getElementById('promo-price').value = '';
    document.getElementById('promo-image').value = '';

    modal.classList.add('active');
  }

  closeDailyPromoModal() {
    const modal = document.getElementById('kitchen-promo-modal');
    if (modal) modal.classList.remove('active');
  }

  handlePromoProductSelect(productId) {
    if (!this.selectedId || !productId) return;
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;
    const prod = (est.products || []).find(p => p.id === productId);
    if (!prod) return;

    document.getElementById('promo-title').value = prod.name || '';
    document.getElementById('promo-description').value = prod.description || '';
    document.getElementById('promo-original-price').value = prod.originalPrice || prod.price || '';
    document.getElementById('promo-price').value = Math.round((prod.price || 0) * 0.85); // Suggest 15% discount
    document.getElementById('promo-image').value = prod.image || '';
  }

  async handleCreatePromoSubmit(e) {
    e.preventDefault();
    if (!this.selectedId) return;
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    const productId = document.getElementById('promo-select-product').value;
    const title = document.getElementById('promo-title').value.trim();
    const description = document.getElementById('promo-description').value.trim();
    const originalPrice = document.getElementById('promo-original-price').value;
    const promoPrice = document.getElementById('promo-price').value;
    const image = document.getElementById('promo-image').value.trim();

    try {
      const res = await fetch('/api/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          establishmentId: est.id,
          linkKey: est.linkKey,
          productId,
          title,
          description,
          originalPrice,
          promoPrice,
          image: image || est.logoImage || '/images/burger_royale.jpg'
        })
      });

      if (res.ok) {
        this.showToast('🔥 ¡Promoción del día publicada con éxito por 24 horas!');
        this.closeDailyPromoModal();
        await this.loadEstablishments();
      } else {
        alert('Error al publicar la promoción.');
      }
    } catch(err) {
      console.error('Error publishing daily promo:', err);
      alert('Error de conexión al publicar la promoción.');
    }
  }

  // Immersive local layout & menu management
  async openMenuTablesModal() {
    if (!this.selectedId) return;
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    window.activeShopIdForMenu = est.id; // Sync with global helper references
    this.activeFloorTool = 'table'; // Default tool

    // Update titles and subtext
    const titleEl = document.getElementById('designer-modal-shop-name');
    if (titleEl) titleEl.innerText = `🍔 Taller de Menú y Distribución: ${est.name}`;
    const subtextEl = document.getElementById('designer-modal-shop-subtext');
    if (subtextEl) subtextEl.innerText = `Diseño de distribución de mesas y carta de comida para ${est.name}`;

    // Open Modal
    document.getElementById('menu-tables-modal').classList.add('active');

    // Switch to default tab (daily specials or previous tab)
    const initialTab = this.activeModalTab || 'daily';
    this.switchModalTab(initialTab);
  }

  switchModalTab(tabId) {
    this.activeModalTab = tabId;
    const tabs = ['daily', 'menu', 'tables', 'catalog'];
    tabs.forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      const content = document.getElementById(`tab-content-${t}`);
      if (btn) btn.classList.toggle('active', t === tabId);
      if (content) content.classList.toggle('active', t === tabId);
    });

    if (tabId === 'daily') {
      this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
    } else if (tabId === 'menu') {
      this.renderModalCategories();
      this.renderModalProducts();
    } else if (tabId === 'tables') {
      this.renderFloorGrid();
    } else if (tabId === 'catalog') {
      this.loadModalImportCatalog();
    }
  }

  selectDailySpecialsDay(day) {
    this.selectedDailyDay = day;
    const container = document.getElementById('daily-specials-day-selector');
    if (container) {
      container.querySelectorAll('.day-pill').forEach(pill => {
        pill.classList.toggle('active', pill.getAttribute('data-day') === day);
      });
    }
    this.renderDailySpecialsTab(day);
  }

  renderDailySpecialsTab(selectedDay = 'todos') {
    const grid = document.getElementById('daily-specials-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est || !est.products || est.products.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted); font-size: 12.5px; background: rgba(255,255,255,0.02); border-radius: 12px;">
          No hay productos registrados en este restaurante.
        </div>
      `;
      return;
    }

    const today = typeof getTodayDayId === 'function' ? getTodayDayId() : 'lunes';

    // Mark the "HOY" badge on the day pill
    const daySelector = document.getElementById('daily-specials-day-selector');
    if (daySelector) {
      daySelector.querySelectorAll('.day-pill').forEach(p => {
        if (p.getAttribute('data-day') === today) {
          p.classList.add('today-badge');
        }
      });
    }

    // Filter products for the selected day
    const filtered = est.products.filter(p => {
      const days = (p.available_days && Array.isArray(p.available_days) && p.available_days.length > 0)
        ? p.available_days.map(d => String(d).toLowerCase())
        : ['todos'];

      if (selectedDay === 'todos') return true;
      return days.includes('todos') || days.includes(selectedDay);
    });

    if (filtered.length === 0) {
      const dayNames = {
        lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles',
        jueves: 'Jueves', viernes: 'Viernes', sabado: 'Sábado',
        domingo: 'Domingo', todos: 'todos los días'
      };
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 28px; text-align: center; color: var(--text-muted); font-size: 13px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.08); border-radius: 14px;">
          <span style="font-size: 24px; display: block; margin-bottom: 4px;">🍲</span>
          <p style="margin: 4px 0 10px 0;">No hay platos asignados para <strong>${dayNames[selectedDay] || selectedDay}</strong>.</p>
          <button type="button" class="btn-neumorphic" onclick="openMenuModal()" style="margin: 0; font-size: 11.5px; padding: 6px 14px; background: var(--accent); color: #121216; font-weight: 800;">➕ Asignar Plato a este Día</button>
        </div>
      `;
      return;
    }

    filtered.forEach(prod => {
      const isPaused = prod.is_paused === true || prod.available === false;
      const days = (prod.available_days && Array.isArray(prod.available_days) && prod.available_days.length > 0)
        ? prod.available_days
        : ['todos'];
      
      const daysLabel = days.includes('todos') ? 'Todos los días' : days.map(d => d.slice(0, 3).toUpperCase()).join(', ');
      
      const dynamicModifiers = (prod.modifiers && Array.isArray(prod.modifiers)) ? prod.modifiers : [];
      const dynamicBadges = dynamicModifiers.map(g => `
        <span class="daily-dish-options-badge" title="${g.group_name}: ${g.options ? g.options.map(o => o.name).join(', ') : ''}">
          🍲 ${g.group_name} (${g.options ? g.options.length : 0})
        </span>
      `).join('');

      const card = document.createElement('div');
      card.className = `daily-dish-card ${isPaused ? 'paused' : ''}`;
      const imgUrl = prod.image || '/images/burger_royale.jpg';

      card.innerHTML = `
        <div class="daily-dish-header">
          <img src="${imgUrl}" alt="${prod.name}" class="daily-dish-img" onerror="this.src='/images/burger_royale.jpg'">
          <div style="flex: 1; min-width: 0;">
            <h4 class="daily-dish-title">${prod.name}</h4>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <span class="daily-dish-price">$${parseFloat(prod.price || 0).toFixed(2)}</span>
              <span style="font-size: 10px; color: #f59e0b; font-weight: 700; background: rgba(245,158,11,0.1); padding: 2px 6px; border-radius: 4px;">📅 ${daysLabel}</span>
            </div>
          </div>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
          ${dynamicBadges || '<span style="font-size: 10px; color: var(--text-muted); font-style: italic;">Sin opciones dinámicas configuradas</span>'}
        </div>

        <div class="daily-dish-actions">
          <button type="button" class="btn-daily-action toggle-active ${isPaused ? 'is-paused' : ''}" onclick="KitchenApp.toggleProductStatus('${prod.id}')" title="Pausar o activar plato">
            <span>${isPaused ? '⏸️ Pausado' : '🟢 Activo Hoy'}</span>
          </button>
          <button type="button" class="btn-daily-action" onclick="KitchenApp.openDailyOptionsModal('${prod.id}')" style="color: #f59e0b;" title="Editar opciones cambiantes (sopas, ensaladas, etc.)">
            <span>🍲 Opciones</span>
          </button>
          <button type="button" class="btn-daily-action" onclick="KitchenApp.openProductSpecsModal('${prod.id}')" title="Editar precio, foto e ingredientes">
            <span>✏️ Editar</span>
          </button>
        </div>
      `;

      grid.appendChild(card);
    });
  }

  async toggleProductStatus(productId) {
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est || !est.products) return;

    const prod = est.products.find(p => String(p.id) === String(productId));
    if (!prod) return;

    prod.is_paused = !(prod.is_paused === true || prod.available === false);
    prod.available = !prod.is_paused;

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
        this.showLocalToast(`Plato ${prod.name} ${prod.available ? 'activado' : 'pausado'}.`);
        this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
        this.renderModalProducts();
      }
    } catch (err) {
      console.error(err);
    }
  }

  openDailyOptionsModal(productId) {
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est || !est.products) return;

    const prod = est.products.find(p => String(p.id) === String(productId));
    if (!prod) return;

    this.activeDailyOptionsProductId = productId;
    this.dailyOptionsGroups = prod.modifiers ? JSON.parse(JSON.stringify(prod.modifiers)) : [];

    if (this.dailyOptionsGroups.length === 0) {
      this.dailyOptionsGroups = [
        {
          group_id: 'g-sopa-' + Date.now(),
          group_name: 'Sopa del Día',
          selection_type: 'single',
          required: true,
          options: [
            { option_id: 'opt-s1', name: 'Sopa de Costilla', extra_price: 0 },
            { option_id: 'opt-s2', name: 'Sancocho de Gallina', extra_price: 0 },
            { option_id: 'opt-s3', name: 'Sin Sopa', extra_price: 0 }
          ]
        }
      ];
    }

    const titleEl = document.getElementById('daily-options-product-name');
    if (titleEl) titleEl.innerText = prod.name;
    const modal = document.getElementById('daily-options-modal');
    if (modal) modal.classList.add('active');
    this.renderDailyOptionsGroupsList();
  }

  closeDailyOptionsModal() {
    const modal = document.getElementById('daily-options-modal');
    if (modal) modal.classList.remove('active');
  }

  renderDailyOptionsGroupsList() {
    const container = document.getElementById('daily-options-groups-list');
    if (!container) return;
    container.innerHTML = '';

    if (!this.dailyOptionsGroups || this.dailyOptionsGroups.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 11.5px; padding: 16px;">Sin grupos de opciones agregados. Haz clic en "➕ Agregar Opción".</div>`;
      return;
    }

    this.dailyOptionsGroups.forEach((group, gIdx) => {
      const gCard = document.createElement('div');
      gCard.style.background = 'rgba(255, 255, 255, 0.03)';
      gCard.style.border = '1px solid rgba(255, 255, 255, 0.08)';
      gCard.style.borderRadius = '12px';
      gCard.style.padding = '12px';
      gCard.style.display = 'flex';
      gCard.style.flexDirection = 'column';
      gCard.style.gap = '8px';

      const optionsListHTML = (group.options || []).map((opt, oIdx) => `
        <div style="display: flex; gap: 6px; align-items: center;">
          <input type="text" value="${opt.name || ''}" oninput="KitchenApp.updateDailyOptionName(${gIdx}, ${oIdx}, this.value)" placeholder="Nombre del sabor u opción" style="flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 6px; padding: 5px 8px; font-size: 12px;">
          <input type="number" step="0.01" value="${opt.extra_price !== undefined ? opt.extra_price : (opt.price || 0)}" oninput="KitchenApp.updateDailyOptionPrice(${gIdx}, ${oIdx}, this.value)" placeholder="+$ extra" style="width: 70px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #10b981; border-radius: 6px; padding: 5px 6px; font-size: 11.5px; font-weight: bold; text-align: center;">
          <button type="button" onclick="KitchenApp.removeDailyOptionItem(${gIdx}, ${oIdx})" style="background: rgba(239, 68, 68, 0.8); border: none; color: #fff; width: 24px; height: 24px; border-radius: 50%; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button>
        </div>
      `).join('');

      gCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <input type="text" value="${group.group_name || ''}" oninput="KitchenApp.updateDailyGroupName(${gIdx}, this.value)" placeholder="Título (Ej: Sopa del Día, Ensalada, Proteína)" style="flex: 1; font-weight: 800; color: var(--accent); background: transparent; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 4px 8px; font-size: 12.5px;">
          <select onchange="KitchenApp.updateDailyGroupType(${gIdx}, this.value)" style="background: rgba(18,18,22,0.9); color: #fff; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 4px 6px; font-size: 11px;">
            <option value="single" ${group.selection_type === 'single' ? 'selected' : ''}>1 Selección</option>
            <option value="multiple" ${group.selection_type === 'multiple' ? 'selected' : ''}>Múltiple</option>
          </select>
          <button type="button" onclick="KitchenApp.removeDailyGroup(${gIdx})" style="background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer;">🗑️</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
          ${optionsListHTML}
        </div>

        <button type="button" onclick="KitchenApp.addDailyOptionItem(${gIdx})" style="align-self: flex-start; background: rgba(255,255,255,0.05); color: #cbd5e1; border: 1px dashed rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; margin-top: 4px;">
          ➕ Agregar Sabor / Opción
        </button>
      `;

      container.appendChild(gCard);
    });
  }

  addQuickDailyGroup() {
    if (!this.dailyOptionsGroups) this.dailyOptionsGroups = [];
    this.dailyOptionsGroups.push({
      group_id: 'g-grp-' + Date.now(),
      group_name: 'Nueva Opción (Ej: Ensalada, Sabor)',
      selection_type: 'single',
      required: true,
      options: [
        { option_id: 'opt-' + Date.now() + '-1', name: 'Opción 1', extra_price: 0 },
        { option_id: 'opt-' + Date.now() + '-2', name: 'Opción 2', extra_price: 0 }
      ]
    });
    this.renderDailyOptionsGroupsList();
  }

  updateDailyGroupName(gIdx, name) {
    if (this.dailyOptionsGroups && this.dailyOptionsGroups[gIdx]) this.dailyOptionsGroups[gIdx].group_name = name;
  }

  updateDailyGroupType(gIdx, type) {
    if (this.dailyOptionsGroups && this.dailyOptionsGroups[gIdx]) this.dailyOptionsGroups[gIdx].selection_type = type;
  }

  removeDailyGroup(gIdx) {
    if (this.dailyOptionsGroups) {
      this.dailyOptionsGroups.splice(gIdx, 1);
      this.renderDailyOptionsGroupsList();
    }
  }

  addDailyOptionItem(gIdx) {
    if (!this.dailyOptionsGroups || !this.dailyOptionsGroups[gIdx]) return;
    if (!this.dailyOptionsGroups[gIdx].options) this.dailyOptionsGroups[gIdx].options = [];
    this.dailyOptionsGroups[gIdx].options.push({
      option_id: 'opt-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: 'Nueva Variante',
      extra_price: 0
    });
    this.renderDailyOptionsGroupsList();
  }

  updateDailyOptionName(gIdx, oIdx, name) {
    if (this.dailyOptionsGroups && this.dailyOptionsGroups[gIdx] && this.dailyOptionsGroups[gIdx].options[oIdx]) {
      this.dailyOptionsGroups[gIdx].options[oIdx].name = name;
    }
  }

  updateDailyOptionPrice(gIdx, oIdx, val) {
    if (this.dailyOptionsGroups && this.dailyOptionsGroups[gIdx] && this.dailyOptionsGroups[gIdx].options[oIdx]) {
      this.dailyOptionsGroups[gIdx].options[oIdx].extra_price = parseFloat(val) || 0;
      this.dailyOptionsGroups[gIdx].options[oIdx].price = parseFloat(val) || 0;
    }
  }

  removeDailyOptionItem(gIdx, oIdx) {
    if (this.dailyOptionsGroups && this.dailyOptionsGroups[gIdx] && this.dailyOptionsGroups[gIdx].options) {
      this.dailyOptionsGroups[gIdx].options.splice(oIdx, 1);
      this.renderDailyOptionsGroupsList();
    }
  }

  async saveDailyOptions() {
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est || !est.products || !this.activeDailyOptionsProductId) return;

    const prod = est.products.find(p => String(p.id) === String(this.activeDailyOptionsProductId));
    if (!prod) return;

    // Filter empty groups
    prod.modifiers = this.dailyOptionsGroups.filter(g => g.group_name && g.group_name.trim() !== '');

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
        this.showLocalToast(`✅ Opciones dinámicas de ${prod.name} guardadas con éxito.`);
        this.closeDailyOptionsModal();
        this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
        this.renderModalProducts();
      }
    } catch (err) {
      console.error(err);
      alert('Error al guardar opciones dinámicas.');
    }
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
        
        const newOpt = document.createElement('option');
        newOpt.value = 'new';
        newOpt.innerText = '+ Crear nueva categoría...';
        newOpt.style.fontWeight = 'bold';
        newOpt.style.color = 'var(--primary)';
        select.appendChild(newOpt);
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
    const tbody = document.getElementById('modal-import-catalog-tbody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">Cargando catálogo maestro...</td></tr>`;

    try {
      if (typeof MenuBuilder !== 'undefined' && MenuBuilder.supabase) {
        const { data, error } = await MenuBuilder.supabase
          .from('products')
          .select('*')
          .order('name');
        
        if (error) throw error;

        this.globalProductsCache = data || [];
        this.renderImportCatalogTable(this.globalProductsCache);
      }
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: #f87171;">Error al cargar el catálogo maestro: ${err.message}</td></tr>`;
    }
  }

  renderImportCatalogTable(products) {
    const tbody = document.getElementById('modal-import-catalog-tbody');
    if (!tbody) return;

    if (!products || products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">No hay productos en el catálogo maestro.</td></tr>`;
      return;
    }

    const est = this.establishments.find(e => e.id === this.selectedId);
    const existingProductNames = est && est.products ? est.products.map(p => p.name.toLowerCase()) : [];

    tbody.innerHTML = '';
    products.forEach(prod => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
      tr.style.transition = 'background 0.2s';
      tr.onmouseenter = () => tr.style.background = 'rgba(255,255,255,0.04)';
      tr.onmouseleave = () => tr.style.background = 'transparent';

      const imgUrl = prod.image_url || prod.image || '/images/burger_royale.jpg';
      const isAlreadyAdded = existingProductNames.includes(prod.name.toLowerCase());
      const rawPrice = parseFloat(prod.price) || 0;
      const copPrice = rawPrice < 1000 ? rawPrice * 1000 : rawPrice;
      const formattedPrice = `$${Math.round(copPrice).toLocaleString('de-DE')} COP`;

      const actionBtn = isAlreadyAdded 
        ? `<span style="background: rgba(16, 185, 129, 0.15); color: #10B981; border: 1px solid rgba(16, 185, 129, 0.4); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; display: inline-block;">✓ En tu Menú</span>`
        : `<button onclick="KitchenApp.importGlobalProductFromModal('${prod.id}')" style="background: var(--accent); color: #121216; font-weight: 800; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.2s;">➕ Agregar a mi Menú</button>`;

      tr.innerHTML = `
        <td style="padding: 10px 14px;">
          <img src="${imgUrl}" alt="${prod.name}" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover; border: 1px solid rgba(255,255,255,0.1);" onerror="this.src='/images/burger_royale.jpg'">
        </td>
        <td style="padding: 10px 14px;">
          <div style="font-weight: 700; color: #fff;">${prod.name}</div>
          <span style="font-size: 10.5px; background: rgba(255,255,255,0.08); color: #a78bfa; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 2px;">${prod.category || 'General'}</span>
        </td>
        <td style="padding: 10px 14px; color: var(--text-muted); font-size: 12px; max-width: 250px;">
          ${prod.description || 'Sin descripción especificada.'}
        </td>
        <td style="padding: 10px 14px; font-weight: 800; color: #10B981;">
          ${formattedPrice}
        </td>
        <td style="padding: 10px 14px; text-align: center;">
          ${actionBtn}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  filterImportCatalogTable() {
    const searchInput = document.getElementById('modal-import-search');
    if (!searchInput || !this.globalProductsCache) return;
    const query = searchInput.value.toLowerCase().trim();

    const filtered = this.globalProductsCache.filter(p => 
      p.name.toLowerCase().includes(query) || 
      (p.category && p.category.toLowerCase().includes(query)) ||
      (p.description && p.description.toLowerCase().includes(query))
    );

    this.renderImportCatalogTable(filtered);
  }

  async importGlobalProductFromModal(prodId) {
    if (!prodId) return;

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

    const rawPrice = parseFloat(selected.price) || 0;
    const copPrice = rawPrice < 1000 ? rawPrice * 1000 : rawPrice;

    const newLocalProduct = {
      id: `p-${Date.now()}-${Math.floor(Math.random() * 100)}`,
      name: selected.name,
      price: copPrice,
      description: selected.description || '',
      image: selected.image_url || selected.image || ''
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
        this.showLocalToast(`📥 "${selected.name}" agregado a tu carta.`);
        this.loadModalProducts();
        this.renderImportCatalogTable(this.globalProductsCache);
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

    // Load general product details
    document.getElementById('specs-product-name').value = prod.name || '';
    document.getElementById('specs-product-category').value = prod.category || '';
    document.getElementById('specs-product-price').value = prod.price !== undefined ? prod.price : '';
    document.getElementById('specs-product-description').value = prod.description || '';

    this.specsIngredients = prod.exclusions ? prod.exclusions.map(e => ({
      name: e.name,
      price: e.price !== undefined ? e.price : 500
    })) : [];
    this.renderSpecsIngredients();

    this.specsGroups = prod.modifiers ? JSON.parse(JSON.stringify(prod.modifiers)) : [];
    this.renderSpecsGroups();

    // Set product image preview & reset file upload input
    const previewImg = document.getElementById('specs-product-image-preview');
    if (previewImg) previewImg.src = prod.image || '/images/burger_royale.jpg';
    const fileInput = document.getElementById('specs-product-image-file');
    if (fileInput) fileInput.value = '';

    // Switch container view (embed specs inside floor plan grid slot)
    document.getElementById('floor-plan-grid-container').style.display = 'none';
    document.getElementById('floor-specs-editor-container').style.display = 'block';

    // Set available days pills
    if (typeof window.setSelectedDaysToContainer === 'function') {
      window.setSelectedDaysToContainer('specs-available-days-pills', prod.available_days || ['todos']);
    }

    // Switch tab to tables so editor is visible
    this.switchModalTab('tables');
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

    this.specsIngredients.forEach((ingObj, idx) => {
      // support both string legacy format or object {name, price} format
      const ingName = typeof ingObj === 'string' ? ingObj : (ingObj.name || '');
      const ingPrice = typeof ingObj === 'string' ? 500 : (ingObj.price !== undefined ? ingObj.price : 500);

      const tag = document.createElement('div');
      tag.style.display = 'flex';
      tag.style.alignItems = 'center';
      tag.style.gap = '8px';
      tag.style.background = 'rgba(255, 94, 58, 0.1)';
      tag.style.border = '1px solid rgba(255, 94, 58, 0.25)';
      tag.style.color = 'var(--accent)';
      tag.style.padding = '6px 12px';
      tag.style.borderRadius = '8px';
      tag.style.fontSize = '12px';
      tag.style.fontWeight = '700';

      tag.innerHTML = `
        <span>${ingName}</span>
        <input type="number" value="${ingPrice}" onchange="KitchenApp.updateIngredientPrice(${idx}, this.value)" style="width: 70px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 4px; padding: 2px 4px; font-size: 11px; font-weight: bold; text-align: center;" placeholder="Precio">
        <span onclick="KitchenApp.removeIngredientOption(${idx})" style="cursor: pointer; color: #ef4444; font-weight: 900; margin-left: 4px;">✕</span>
      `;
      container.appendChild(tag);
    });
  }

  addIngredientOption() {
    const input = document.getElementById('new-ingredient-input');
    const val = input.value.trim();
    if (!val) return;

    const duplicate = this.specsIngredients.some(i => {
      const name = typeof i === 'string' ? i : i.name;
      return name.toLowerCase() === val.toLowerCase();
    });

    if (duplicate) {
      alert('Ingrediente duplicado.');
      return;
    }

    this.specsIngredients.push({
      name: val,
      price: 500 // default price
    });
    input.value = '';
    this.renderSpecsIngredients();
  }

  updateIngredientPrice(idx, val) {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    if (typeof this.specsIngredients[idx] === 'string') {
      this.specsIngredients[idx] = {
        name: this.specsIngredients[idx],
        price: num
      };
    } else {
      this.specsIngredients[idx].price = num;
    }
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

    // 1. Update general details
    prod.name = document.getElementById('specs-product-name').value.trim();
    prod.category = document.getElementById('specs-product-category').value.trim();
    prod.price = parseFloat(document.getElementById('specs-product-price').value) || 0;
    prod.description = document.getElementById('specs-product-description').value.trim();
    prod.available_days = typeof window.getSelectedDaysFromContainer === 'function' ? window.getSelectedDaysFromContainer('specs-available-days-pills') : ['todos'];

    // 2. Prepare exclusions
    prod.exclusions = this.specsIngredients.map((item, i) => {
      const ingName = typeof item === 'string' ? item : item.name;
      const ingPrice = typeof item === 'string' ? 500 : (item.price !== undefined ? item.price : 500);
      return {
        id: `ex-${i}`,
        name: ingName,
        price: ingPrice
      };
    });

    // 3. Save modifiers groups
    prod.modifiers = this.specsGroups;

    // 4. Create pricing map for exclusions and modifiers
    const priceMap = {};
    prod.exclusions.forEach(item => {
      const key = item.name.trim().toLowerCase();
      if (key) priceMap[key] = item.price;
    });
    prod.modifiers.forEach(group => {
      if (group.options) {
        group.options.forEach(opt => {
          const key = opt.name.trim().toLowerCase();
          if (key) priceMap[key] = opt.price;
        });
      }
    });

    // 5. Propagate pricing changes to all other products in the establishment
    est.products.forEach(p => {
      // Exclusions
      if (p.exclusions) {
        p.exclusions = p.exclusions.map(ex => {
          let exName = typeof ex === 'string' ? ex : (ex.name || '');
          let exPrice = typeof ex === 'string' ? 500 : (ex.price !== undefined ? ex.price : 500);
          const key = exName.trim().toLowerCase();
          if (priceMap[key] !== undefined) {
            exPrice = priceMap[key];
          }
          return { id: ex.id || `ex-${Math.random()}`, name: exName, price: exPrice };
        });
      }
      // Modifiers
      if (p.modifiers) {
        p.modifiers.forEach(group => {
          if (group.options) {
            group.options.forEach(opt => {
              const key = opt.name.trim().toLowerCase();
              if (priceMap[key] !== undefined) {
                opt.price = priceMap[key];
                opt.extra_price = priceMap[key];
              }
            });
          }
        });
      }
    });

    const fileInput = document.getElementById('specs-product-image-file');
    const imageFile = fileInput ? fileInput.files[0] : null;

    try {
      if (imageFile && typeof MenuBuilder !== 'undefined') {
        this.showLocalToast('Uploading image...');
        const newImgUrl = await MenuBuilder.uploadProductImage(imageFile);
        prod.image = newImgUrl;
      }

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
        if (typeof this.renderDailySpecialsTab === 'function') {
          this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  handleFastAdd() {
    const text = document.getElementById('form-fast-add')?.value;
    if (!text || !text.trim()) return;

    // Use global parser or fallback local parser
    const parsed = typeof parseMagicProductText === 'function' ? parseMagicProductText(text) : (() => {
      let t = text.trim().replace(/^[\d#\*\-\.\)\•\>\s]+/, '').trim();
      let name = '', desc = '', price = '', sizes = [], flavors = '', extras = '';

      const sizesMatch = t.match(/(?:tamaños?|variaciones?|porciones?):?\s*([^-\n]+)/i);
      if (sizesMatch) {
        sizesMatch[1].trim().split(/,|\//).forEach(item => {
          const trimmed = item.trim();
          const pMatch = trimmed.match(/(\d+(?:[.,]\d+)?)\s*(?:k|cop|usd|\$)?$/i);
          let sPrice = '', sName = trimmed;
          if (pMatch) {
            sPrice = pMatch[1].replace(/[.,]/g, '');
            sName = trimmed.replace(pMatch[0], '').trim();
          }
          if (sName) sizes.push({ name: sName, price: sPrice });
        });
        t = t.replace(sizesMatch[0], '').trim();
      }

      const flavorsMatch = t.match(/(?:sabores?|variantes?):?\s*([^-\n]+)/i);
      if (flavorsMatch) {
        flavors = flavorsMatch[1].trim();
        t = t.replace(flavorsMatch[0], '').trim();
      }

      const extrasMatch = t.match(/(?:adicionales?|extras?|toppings?):?\s*([^-\n]+)/i);
      if (extrasMatch) {
        extras = extrasMatch[1].trim();
        t = t.replace(extrasMatch[0], '').trim();
      }

      const endPriceRegex = /(?:^|\s*[-–—|:,]\s*|\s+)(?:precio\s*:?\s*)?(?:\$|usd|cop)?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:cop|usd|\$|k|mil)?\.?\s*$/i;
      const taggedPriceRegex = /(?:precio|valor|cuesta|vale|\$|cop|usd)\s*:?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:cop|usd|\$|k|mil)?/i;

      let priceMatch = t.match(endPriceRegex) || t.match(taggedPriceRegex);
      if (priceMatch) {
        let rawP = priceMatch[1].replace(/[.,]/g, '');
        if (priceMatch[0].toLowerCase().includes('k') || priceMatch[0].toLowerCase().includes('mil')) {
          if (parseInt(rawP, 10) < 1000) rawP = String(parseInt(rawP, 10) * 1000);
        }
        price = rawP;
        t = t.substring(0, priceMatch.index) + t.substring(priceMatch.index + priceMatch[0].length);
        t = t.trim().replace(/[-–—|:,.\s]+$/, '').trim();
      }

      let parts = t.split(/\s*[-–—|:]\s*|\n+/).map(p => p.trim().replace(/^[-–—|:,.\s]+|[-–—|:,.\s]+$/g, '')).filter(p => p.length > 0);

      if (parts.length === 1) {
        const dotSplit = parts[0].split(/\.\s+/);
        if (dotSplit.length > 1 && dotSplit[0].length < 35 && dotSplit[1].length > 5) {
          name = dotSplit[0].trim();
          desc = dotSplit.slice(1).join('. ').trim();
        } else {
          name = parts[0];
        }
      } else if (parts.length === 2) {
        name = parts[0];
        if (!price && /^\d+$/.test(parts[1].replace(/[^\d]/g, '')) && !/[a-zA-Z]/.test(parts[1])) {
          price = parts[1].replace(/[^\d]/g, '');
        } else {
          desc = parts[1];
        }
      } else if (parts.length >= 3) {
        name = parts[0];
        if (!price && /^\d+$/.test(parts[parts.length - 1].replace(/[^\d]/g, '')) && !/[a-zA-Z]/.test(parts[parts.length - 1])) {
          price = parts[parts.length - 1].replace(/[^\d]/g, '');
          desc = parts.slice(1, -1).join(' - ');
        } else {
          desc = parts.slice(1).join(' - ');
        }
      }

      if (name) name = name.replace(/[-–—|:,.\s]+$/, '').trim();
      if (desc) desc = desc.replace(/[-–—|:,.\s]+$/, '').trim();

      return { name, desc, price, sizes, flavors, extras };
    })();

    if (!parsed) return;
    const { name, desc, price, sizes, flavors, extras } = parsed;

    if (name) {
      document.getElementById('form-name').value = name;
      const catSelect = document.getElementById('form-category');
      if (catSelect) {
        const nameLower = name.toLowerCase();
        const categoryMapping = {
          'pepito': 'pepitos',
          'pepitos': 'pepitos',
          'hamburguesa': 'hamburguesas',
          'burguer': 'hamburguesas',
          'burger': 'hamburguesas',
          'perro': 'hot-dogs-perros-calientes',
          'hot dog': 'hot-dogs-perros-calientes',
          'hot-dog': 'hot-dogs-perros-calientes',
          'dog': 'hot-dogs-perros-calientes',
          'pizza': 'pizzas',
          'shawarma': 'shawarmas',
          'arepa': 'arepas',
          'cachapa': 'cachapas',
          'salchipapa': 'salchipapas',
          'patacon': 'patacones',
          'parrilla': 'parrillas',
          'pollo': 'pollo',
          'alita': 'pollo',
          'oblea': 'helados-postres',
          'helado': 'helados-postres',
          'malteada': 'bebidas',
          'batido': 'bebidas',
          'bebida': 'bebidas',
          'jugo': 'bebidas',
          'empanada': 'empanadas',
          'pastelito': 'empanadas',
          'tequeño': 'tequenos',
          'tequeno': 'tequenos',
          'pan': 'pan',
          'sándwich': 'sandwiches',
          'sandwich': 'sandwiches',
          'baguette': 'baguettes',
          'sushi': 'sushi',
          'taco': 'mexicana',
          'burrito': 'mexicana',
          'ramen': 'ramen',
          'postre': 'postres',
          'dulce': 'postres',
          'café': 'cafe',
          'cafe': 'cafe'
        };

        let matchedSlug = '';
        for (const [keyword, slug] of Object.entries(categoryMapping)) {
          if (nameLower.includes(keyword)) {
            matchedSlug = slug;
            break;
          }
        }

        let foundCategory = false;
        for (let i = 0; i < catSelect.options.length; i++) {
          const optVal = catSelect.options[i].value;
          const optText = catSelect.options[i].text.toLowerCase();
          if (optVal !== 'new') {
            if (matchedSlug && (optVal === matchedSlug || optVal.includes(matchedSlug) || optText.includes(matchedSlug.split('-')[0]))) {
              catSelect.selectedIndex = i;
              foundCategory = true;
              break;
            }
            const cleanOptText = optText.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '').trim();
            if (cleanOptText.length > 2 && nameLower.includes(cleanOptText.split('/')[0].trim().split(' ')[0].toLowerCase())) {
              catSelect.selectedIndex = i;
              foundCategory = true;
              break;
            }
            const firstWord = name.split(' ')[0].toLowerCase();
            if (optText.includes(firstWord)) {
              catSelect.selectedIndex = i;
              foundCategory = true;
              break;
            }
          }
        }

        if (!foundCategory) {
          catSelect.value = 'new';
          const firstWord = name.split(' ')[0];
          const suggestedCat = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase() + (firstWord.endsWith('s') ? '' : 's');
          const newCatInput = document.getElementById('form-new-category-name');
          if (newCatInput) newCatInput.value = suggestedCat;
          const container = document.getElementById('form-new-category-container');
          if (container) container.style.display = 'block';
        }

        if (typeof window.handleCategoryChange === 'function') window.handleCategoryChange(catSelect);
      }
    }

    if (desc) {
      const descElem = document.getElementById('form-desc');
      if (descElem) descElem.value = desc;
    }
    if (price) {
      const priceElem = document.getElementById('form-price');
      if (priceElem) priceElem.value = price;
    }

    if (sizes && sizes.length > 0) {
      sizes.forEach((item, idx) => {
        if (idx < 4) {
          const nameElem = document.getElementById(`form-size-${idx+1}-name`);
          const priceElem = document.getElementById(`form-size-${idx+1}-price`);
          if (nameElem) nameElem.value = item.name;
          if (priceElem && item.price) priceElem.value = item.price;
        }
      });
    }

    if (flavors) {
      const saboresElem = document.getElementById('form-sabores');
      if (saboresElem) saboresElem.value = flavors;
    }

    if (extras) {
      const formAdicionales = document.getElementById('form-adicionales');
      if (formAdicionales) formAdicionales.value = extras;
    }

    this.showLocalToast(`✨ Autocompletado: ${name || 'Producto'}`);
  }

  async handleProductSubmit(e) {
    e.preventDefault();
    let catSelect = document.getElementById('form-category').value;
    const nameInput = document.getElementById('form-name').value;
    const descInput = document.getElementById('form-desc').value;
    const isPizza = document.getElementById('pizza-sizes-container')?.style.display === 'block';
    const isDrink = document.getElementById('drink-sizes-container')?.style.display === 'block';

    const drinkPeq = document.getElementById('form-drink-peq')?.value;
    const drinkMed = document.getElementById('form-drink-med')?.value;
    const drinkGde = document.getElementById('form-drink-gde')?.value;

    let priceInput = document.getElementById('form-price').value;
    if (isPizza && pizzaSmall) {
      priceInput = pizzaSmall;
    } else if (isDrink && drinkPeq) {
      priceInput = drinkPeq;
    }

    const extrasInput = document.getElementById('form-adicionales') ? document.getElementById('form-adicionales').value : '';
    const fileInput = document.getElementById('form-image').files[0];

    try {
      if (catSelect === 'new') {
          const newCatName = document.getElementById('form-new-category-name').value;
          const newCatSlug = newCatName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
          const createdCat = await MenuBuilder.createCategory(newCatName, newCatSlug);
          catSelect = createdCat.id;
          
          // Re-fetch categories silently so the select is updated for next time
          if (typeof MenuBuilder !== 'undefined') {
              window.categoriesList = await MenuBuilder.getCategories();
              this.renderModalCategories();
          }
      }

      let imageUrl = '';
      if (fileInput) {
        imageUrl = await MenuBuilder.uploadProductImage(fileInput);
      }
      let newProduct;
      try {
        newProduct = await MenuBuilder.createProduct(catSelect, nameInput, descInput, priceInput, imageUrl);
      } catch (err) {
        console.warn('Supabase products table insert failed. Saving locally to active shop only. Reason:', err);
        newProduct = {
          id: 'p-local-' + Date.now() + Math.floor(Math.random() * 1000),
          category_id: catSelect,
          name: nameInput,
          description: descInput,
          price: parseFloat(priceInput) || 0,
          image_url: imageUrl || '',
          created_at: new Date().toISOString()
        };
      }
      
      let modifiers = [];
      
      // Pizza explicit sizes override
      const pizzaSmallVal = document.getElementById('form-pizza-small')?.value;
      const pizzaMediumVal = document.getElementById('form-pizza-medium')?.value;
      const pizzaLargeVal = document.getElementById('form-pizza-large')?.value;

      if (isPizza && (pizzaSmallVal || pizzaMediumVal || pizzaLargeVal)) {
          const smallPriceNum = parseFloat(pizzaSmallVal) || 0;
          const options = [];
          if (pizzaSmallVal) options.push({ id: 'opt-' + Date.now() + 1, name: 'Pequeña', extra_price: 0, option_id: 'opt-' + Date.now() + 1 });
          if (pizzaMediumVal) {
             const mPrice = parseFloat(pizzaMediumVal);
             options.push({ id: 'opt-' + Date.now() + 2, name: 'Mediana', extra_price: mPrice - smallPriceNum, option_id: 'opt-' + Date.now() + 2 });
          }
          if (pizzaLargeVal) {
             const lPrice = parseFloat(pizzaLargeVal);
             options.push({ id: 'opt-' + Date.now() + 3, name: 'Grande', extra_price: lPrice - smallPriceNum, option_id: 'opt-' + Date.now() + 3 });
          }
          
          if (options.length > 0) {
              modifiers.push({
                  group_id: 'g-tamanos-' + Date.now(),
                  group_name: 'Tamaño',
                  selection_type: 'single',
                  required: true,
                  options: options
              });
          }
      }

      // Drink dynamic sizes
      const drinkSizes = window.getDrinkSizesFromUI ? window.getDrinkSizesFromUI() : [];
      if (isDrink && drinkSizes.length > 0) {
          const basePrice = drinkSizes[0].price || 0;
          priceInput = basePrice;
          const options = drinkSizes.map((s, i) => {
             const optName = `${s.name}${s.oz ? ' (' + s.oz + ')' : ''}`;
             const extraPrice = Math.max(0, s.price - basePrice);
             return {
               id: 'opt-drk-' + Date.now() + '-' + i,
               name: optName,
               extra_price: extraPrice,
               option_id: 'opt-drk-' + Date.now() + '-' + i
             };
          });

          if (options.length > 0) {
              modifiers.push({
                  group_id: 'g-tamanos-drk-' + Date.now(),
                  group_name: 'Tamaño',
                  selection_type: 'single',
                  required: true,
                  options: options
              });
          }
      }

      // Extras parsing
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
             return { id: 'opt-' + Date.now() + Math.random(), name: name, extra_price: val, option_id: 'opt-' + Date.now() + Math.random() };
          }).filter(opt => opt.name !== '');

          if (options.length > 0) {
              modifiers.push({
                  group_id: 'g-extras-' + Date.now(),
                  group_name: 'Adicionales',
                  selection_type: 'multiple',
                  required: false,
                  options: options
              });
          }
      }
      newProduct.modifiers = modifiers.length > 0 ? modifiers : undefined;

      // Base ingredients from description
      if (descInput && descInput.trim() !== '') {
          const excls = descInput.split(/,| y | e /i).map(i => i.trim().replace(/\.$/, '')).filter(i => i.length > 2);
          if (excls.length > 0) {
              newProduct.exclusions = excls;
          }
      const availableDays = typeof window.getSelectedDaysFromContainer === 'function' ? window.getSelectedDaysFromContainer('form-available-days-pills') : ['todos'];
      newProduct.available_days = availableDays;

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
      modifiers: newProduct.modifiers,
      available_days: newProduct.available_days || ['todos'],
      exclusions: newProduct.exclusions ? newProduct.exclusions.map(name => ({ name })) : undefined
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
        if (typeof this.renderDailySpecialsTab === 'function') {
          this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
        }
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

  openCustomizeShopModal() {
    if (!this.selectedId) {
      alert('Por favor, selecciona y vincula un establecimiento primero.');
      return;
    }
    const est = this.establishments.find(e => e.id === this.selectedId);
    if (!est) return;

    // Populate inputs
    const currentKey = localStorage.getItem('admin_key_' + this.selectedId) || est.linkKey || '';
    if (document.getElementById('custom-shop-link-key')) {
      document.getElementById('custom-shop-link-key').value = currentKey;
    }
    document.getElementById('custom-shop-name').value = est.name || '';
    document.getElementById('custom-shop-desc').value = est.description || '';
    document.getElementById('custom-shop-location').value = est.location || 'San Antonio';
    
    // Set Sede GPS Coordinates
    const latEl = document.getElementById('custom-shop-lat');
    if (latEl) latEl.value = (est.location_lat !== undefined && est.location_lat !== null) ? est.location_lat : (est.latitude || '');
    const lngEl = document.getElementById('custom-shop-lng');
    if (lngEl) lngEl.value = (est.location_lng !== undefined && est.location_lng !== null) ? est.location_lng : (est.longitude || '');

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

  getCurrentLocationForSede() {
    if (navigator.geolocation) {
      this.showLocalToast('📡 Obteniendo posición GPS de Sede...');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const latEl = document.getElementById('custom-shop-lat');
          const lngEl = document.getElementById('custom-shop-lng');
          if (latEl) latEl.value = pos.coords.latitude;
          if (lngEl) lngEl.value = pos.coords.longitude;
          this.showLocalToast('✅ Coordenadas de Sede capturadas');
        },
        (err) => {
          alert('No se pudo obtener la ubicación GPS: ' + err.message);
        },
        { enableHighAccuracy: true }
      );
    } else {
      alert('Tu navegador no soporta geolocalización.');
    }
  }

  closeCustomizeShopModal() {
    document.getElementById('customize-shop-modal').classList.remove('active');
  }

  checkKitchenTermsModal() {
    const accepted = localStorage.getItem('kitchen_terms_accepted');
    const modal = document.getElementById('kitchen-terms-modal');
    if (!accepted && modal) {
      modal.classList.remove('hidden');
    }
  }

  toggleTermsButton(checked) {
    const btn = document.getElementById('btn-confirm-kitchen-terms');
    if (btn) {
      btn.disabled = !checked;
      btn.style.opacity = checked ? '1' : '0.5';
    }
  }

  acceptTermsAndProceed() {
    const chk = document.getElementById('chk-accept-kitchen-terms');
    if (chk && chk.checked) {
      localStorage.setItem('kitchen_terms_accepted', 'true');
      const modal = document.getElementById('kitchen-terms-modal');
      if (modal) modal.classList.add('hidden');
      this.showToast('✅ Términos y requisitos aceptados');
    }
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
    const location = document.getElementById('custom-shop-location').value;
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

      let bannerType = est.bannerType || 'gradient';
      
      // 2. Upload cover banner file if selected
      if (bannerFile) {
        submitBtn.innerHTML = `<span>Subiendo Portada...</span>`;
        banner = await MenuBuilder.uploadProductImage(bannerFile);
        bannerType = 'image';
      } else if (banner && (banner.startsWith('http') || banner.startsWith('/'))) {
        bannerType = 'image';
      }

      // Read linked code/key from storage & check master code 0424 for changes
      const currentLinkKey = localStorage.getItem(`admin_key_${this.selectedId}`) || est.linkKey || '';
      const newKeyInput = document.getElementById('custom-shop-link-key') ? document.getElementById('custom-shop-link-key').value.trim().toUpperCase() : currentLinkKey;
      
      let finalLinkKey = currentLinkKey;
      let newLinkKeyToSend = null;

      if (newKeyInput && newKeyInput !== currentLinkKey.toUpperCase()) {
        const masterCode = prompt('⚠️ Para modificar la Clave de Vinculación debes ingresar el Código de Confirmación Maestro:');
        if (masterCode === '0424') {
          finalLinkKey = newKeyInput;
          newLinkKeyToSend = newKeyInput;
          localStorage.setItem(`admin_key_${this.selectedId}`, newKeyInput);
          alert('🔑 Clave de vinculación autorizada y actualizada con éxito a: ' + newKeyInput);
        } else {
          alert('❌ Código de confirmación maestro incorrecto. Se mantendrá la clave previa.');
        }
      }

      const location_lat = document.getElementById('custom-shop-lat') ? document.getElementById('custom-shop-lat').value : '';
      const location_lng = document.getElementById('custom-shop-lng') ? document.getElementById('custom-shop-lng').value : '';

      const payload = {
        isOwner: false,
        linkKey: currentLinkKey,
        newLinkKey: newLinkKeyToSend,
        name,
        description,
        location,
        location_lat: location_lat !== '' ? parseFloat(location_lat) : null,
        location_lng: location_lng !== '' ? parseFloat(location_lng) : null,
        logo,
        delivery_fee: delivery_fee ? parseFloat(delivery_fee) : 0,
        banner,
        bannerType,
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

window.handleCategoryChange = function(selectElem) {
  const selectedValue = selectElem.value;
  const newCategoryContainer = document.getElementById('form-new-category-container');
  const newCategoryInput = document.getElementById('form-new-category-name');
  
  if (selectedValue === 'new') {
    newCategoryContainer.style.display = 'block';
    newCategoryInput.required = true;
  } else {
    newCategoryContainer.style.display = 'none';
    newCategoryInput.required = false;
    newCategoryInput.value = '';
  }
  
  if (typeof togglePizzaSizes === 'function') togglePizzaSizes(selectElem);
};

window.renderDrinkSizeRows = function(sizes = []) {
  const container = document.getElementById('drink-sizes-rows-list');
  if (!container) return;

  if (!sizes || sizes.length === 0) {
    sizes = [
      { name: 'Pequeño', oz: '10 oz', price: '' },
      { name: 'Mediano', oz: '16 oz', price: '' },
      { name: 'Grande', oz: '32 oz', price: '' }
    ];
  }

  container.innerHTML = sizes.map(s => `
    <div class="drink-size-row" style="display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
      <div style="flex: 1.2;">
        <label style="font-size: 10px; color: #94A3B8; display: block; margin-bottom: 2px;">Tamaño</label>
        <input type="text" class="drink-size-name" value="${s.name || ''}" placeholder="Ej. Pequeño, Grande" style="width: 100%; padding: 6px; border-radius: 6px; background: #0F172A; border: 1px solid #334155; color: #FFF; font-size: 12px;">
      </div>
      <div style="flex: 1;">
        <label style="font-size: 10px; color: #94A3B8; display: block; margin-bottom: 2px;">Capacidad / Onzas</label>
        <input type="text" class="drink-size-oz" value="${s.oz || ''}" placeholder="Ej. 12 oz, 16 oz" style="width: 100%; padding: 6px; border-radius: 6px; background: #0F172A; border: 1px solid #334155; color: #00b894; font-size: 12px; font-weight: 700;">
      </div>
      <div style="flex: 1.2;">
        <label style="font-size: 10px; color: #94A3B8; display: block; margin-bottom: 2px;">Precio (COP)</label>
        <input type="number" class="drink-size-price" value="${s.price !== undefined ? s.price : ''}" placeholder="Ej. 12000" style="width: 100%; padding: 6px; border-radius: 6px; background: #0F172A; border: 1px solid #334155; color: #10B981; font-size: 12px; font-weight: 800;">
      </div>
      <button type="button" onclick="removeDrinkSizeRow(this)" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #EF4444; border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; margin-top: 14px;" title="Eliminar este tamaño">
        🗑️
      </button>
    </div>
  `).join('');
};

window.addDrinkSizeRow = function() {
  const container = document.getElementById('drink-sizes-rows-list');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'drink-size-row';
  div.style.cssText = 'display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);';
  div.innerHTML = `
    <div style="flex: 1.2;">
      <label style="font-size: 10px; color: #94A3B8; display: block; margin-bottom: 2px;">Tamaño</label>
      <input type="text" class="drink-size-name" placeholder="Ej. Jumbo, Litro" style="width: 100%; padding: 6px; border-radius: 6px; background: #0F172A; border: 1px solid #334155; color: #FFF; font-size: 12px;">
    </div>
    <div style="flex: 1;">
      <label style="font-size: 10px; color: #94A3B8; display: block; margin-bottom: 2px;">Capacidad / Onzas</label>
      <input type="text" class="drink-size-oz" placeholder="Ej. 24 oz, 1L" style="width: 100%; padding: 6px; border-radius: 6px; background: #0F172A; border: 1px solid #334155; color: #00b894; font-size: 12px; font-weight: 700;">
    </div>
    <div style="flex: 1.2;">
      <label style="font-size: 10px; color: #94A3B8; display: block; margin-bottom: 2px;">Precio (COP)</label>
      <input type="number" class="drink-size-price" placeholder="Ej. 18000" style="width: 100%; padding: 6px; border-radius: 6px; background: #0F172A; border: 1px solid #334155; color: #10B981; font-size: 12px; font-weight: 800;">
    </div>
    <button type="button" onclick="removeDrinkSizeRow(this)" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #EF4444; border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; margin-top: 14px;" title="Eliminar este tamaño">
      🗑️
    </button>
  `;
  container.appendChild(div);
};

window.removeDrinkSizeRow = function(btn) {
  const row = btn.closest('.drink-size-row');
  if (row) row.remove();
};

window.getDrinkSizesFromUI = function() {
  const rows = document.querySelectorAll('#drink-sizes-rows-list .drink-size-row');
  const sizes = [];
  rows.forEach(r => {
    const name = r.querySelector('.drink-size-name')?.value.trim();
    const oz = r.querySelector('.drink-size-oz')?.value.trim();
    const priceVal = r.querySelector('.drink-size-price')?.value;
    if (name || priceVal) {
      sizes.push({
        name: name || 'Tamaño',
        oz: oz || '',
        price: parseFloat(priceVal) || 0
      });
    }
  });
  return sizes;
};

window.togglePizzaSizes = function(selectElem) {
  const selectedText = selectElem.options[selectElem.selectedIndex].text.toLowerCase();
  const pizzaContainer = document.getElementById('pizza-sizes-container');
  const drinkContainer = document.getElementById('drink-sizes-container');
  const basePriceInput = document.getElementById('form-price');
  
  const isPizza = selectedText.includes('pizza') || (selectElem.value === 'new' && document.getElementById('form-new-category-name').value.toLowerCase().includes('pizza'));
  const isDrink = selectedText.includes('bebida') || selectedText.includes('batido') || selectedText.includes('café') || selectedText.includes('cafe') || selectedText.includes('jugo') || selectedText.includes('líquido') || selectedText.includes('sopas') || selectedText.includes('caldo') || (selectElem.value === 'new' && (document.getElementById('form-new-category-name').value.toLowerCase().includes('bebida') || document.getElementById('form-new-category-name').value.toLowerCase().includes('batido') || document.getElementById('form-new-category-name').value.toLowerCase().includes('cafe') || document.getElementById('form-new-category-name').value.toLowerCase().includes('jugo')));

  if (isPizza) {
    if (pizzaContainer) pizzaContainer.style.display = 'block';
    if (drinkContainer) drinkContainer.style.display = 'none';
    if (basePriceInput) {
      basePriceInput.required = false;
      basePriceInput.value = '0';
    }
  } else if (isDrink) {
    if (pizzaContainer) pizzaContainer.style.display = 'none';
    if (drinkContainer) drinkContainer.style.display = 'block';
    if (basePriceInput) {
      basePriceInput.required = false;
      basePriceInput.value = '0';
    }
    const list = document.getElementById('drink-sizes-rows-list');
    if (list && list.children.length === 0) {
      window.renderDrinkSizeRows();
    }
  } else {
    if (pizzaContainer) pizzaContainer.style.display = 'none';
    if (drinkContainer) drinkContainer.style.display = 'none';
    if (basePriceInput) basePriceInput.required = true;
  }
};

window.getTodayDayId = function() {
  const dayIndex = new Date().getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  const map = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  return map[dayIndex];
};

window.toggleFormDayPill = function(el, containerId) {
  const day = el.getAttribute('data-day');
  const container = document.getElementById(containerId);
  if (!container) return;

  if (day === 'todos') {
    container.querySelectorAll('.day-pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
  } else {
    const todosPill = container.querySelector('[data-day="todos"]');
    if (todosPill) todosPill.classList.remove('active');
    el.classList.toggle('active');

    // If nothing selected, re-select "todos"
    const anyActive = container.querySelectorAll('.day-pill.active').length > 0;
    if (!anyActive && todosPill) {
      todosPill.classList.add('active');
    }
  }
};

window.toggleSpecsDayPill = function(el) {
  window.toggleFormDayPill(el, 'specs-available-days-pills');
};

window.getSelectedDaysFromContainer = function(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return ['todos'];
  const activePills = container.querySelectorAll('.day-pill.active');
  const days = Array.from(activePills).map(p => p.getAttribute('data-day'));
  return (days.length === 0 || days.includes('todos')) ? ['todos'] : days;
};

window.setSelectedDaysToContainer = function(containerId, daysArray) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const days = (Array.isArray(daysArray) && daysArray.length > 0) ? daysArray.map(d => String(d).toLowerCase()) : ['todos'];
  container.querySelectorAll('.day-pill').forEach(p => {
    const d = p.getAttribute('data-day');
    p.classList.toggle('active', days.includes(d) || (days.includes('todos') && d === 'todos'));
  });
};

