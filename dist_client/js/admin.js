/* Superadmin Platform Owner Portal Logic (admin.js) */

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

const CATEGORY_EMOJIS = {
  comidas: ['🍔', '🍕', '🌭', '🥤', '🍲', '🌯', '🫓', '🌽', '🍞', '🥖', '🍣', '🌮', '🍜', '🍰', '☕'],
  farmacias: ['💊', '🩹', '🧪', '🧼', '🧴', '🩺'],
  mercados: ['🛒', '🍎', '🥛', '🍞', '🥩', '🧀', '🍌'],
  ferreterias: ['🛠️', '🔨', '🔩', '🔧', '🪚', '🧰', '📐']
};

const DEFAULT_IMAGES = {
  comidas: '/images/burger_royale.jpg',
  farmacias: '/images/vitamina_c.jpg',
  mercados: '/images/pack_frutas.jpg',
  ferreterias: '/images/pack_frutas.jpg'
};

function normalizeStoreName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

class AdminController {
  constructor() {
    this.establishments = [];
    this.orders = [];
    this.isAuthenticated = false;

    // Load cached establishments immediately so UI is never blank
    try {
      const cached = localStorage.getItem('pedigochos_admin_establishments');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.establishments = this.enforceVerifiedGps(parsed);
        }
      }
    } catch(e) {}
  }

  enforceVerifiedGps(establishments) {
    if (!Array.isArray(establishments)) return establishments;
    establishments.forEach(est => {
      if (!est) return;
      if (est.latitude !== undefined && est.latitude !== null && !isNaN(parseFloat(est.latitude)) && est.longitude !== undefined && est.longitude !== null && !isNaN(parseFloat(est.longitude))) {
        est.latitude = parseFloat(est.latitude);
        est.longitude = parseFloat(est.longitude);
      } else {
        let localSaved = null;
        try {
          const raw = localStorage.getItem('store_gps_' + est.id);
          if (raw) localSaved = JSON.parse(raw);
        } catch(e) {}
        if (localSaved && localSaved.latitude && localSaved.longitude) {
          est.latitude = parseFloat(localSaved.latitude);
          est.longitude = parseFloat(localSaved.longitude);
        } else {
          est.latitude = null;
          est.longitude = null;
        }
      }
      est.location_lat = est.latitude;
      est.location_lng = est.longitude;
    });
    return establishments;
  }

  async forceCleanUpdate() {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let reg of registrations) {
          await reg.unregister();
        }
      }
      const url = new URL(window.location.href);
      url.searchParams.set('t_sync', Date.now());
      window.location.href = url.toString();
    } catch(e) {
      window.location.reload(true);
    }
  }

  async init() {
    // Auto-detect version update and clear stale caches
    const APP_VER = '190';
    try {
      const cachedVer = localStorage.getItem('pedigochos_app_ver');
      if (cachedVer && cachedVer !== APP_VER) {
        localStorage.setItem('pedigochos_app_ver', APP_VER);
        if ('caches' in window) {
          caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
            const url = new URL(window.location.href);
            url.searchParams.set('v_flush', Date.now());
            window.location.replace(url.toString());
          });
          return;
        }
      } else {
        localStorage.setItem('pedigochos_app_ver', APP_VER);
      }
    } catch(e) {}

    this.initModalHistoryNavigation();
    this.populateLogoSelect('comidas');
    this.generateRandomLinkKey();

    // Set up auto-stop listeners and audio unlock for persistent alarm in admin
    if (typeof Sound !== 'undefined') {
      const stopAlarmAndUnlock = (e) => {
        try {
          Sound.init();
          this.requestWakeLock();
          if (e && e.target && (e.target.closest('.sound-test-btn') || e.target.closest('.alarm-btn-silence'))) {
            return;
          }
          if (Date.now() - Sound.lastStartedAt < 750) {
            return;
          }
          if (Sound.isPlayingAlarm) {
            Sound.stopAlarm();
            this.hideAlarmBanner();
          }
        } catch(err) {}
      };

      window.addEventListener('focus', () => {
        this.requestWakeLock();
        this.pollOrdersFallback();
        if (Sound.isPlayingAlarm && Date.now() - Sound.lastStartedAt > 750) {
          Sound.stopAlarm();
          this.hideAlarmBanner();
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.requestWakeLock();
          this.pollOrdersFallback();
          if (Sound.isPlayingAlarm && Date.now() - Sound.lastStartedAt > 750) {
            Sound.stopAlarm();
            this.hideAlarmBanner();
          }
        }
      });

      window.addEventListener('online', () => {
        console.log('🌐 Conexión restaurada en Admin. Re-sincronizando...');
        this.initWebSocket();
        this.pollOrdersFallback();
      });

      window.addEventListener('pageshow', () => {
        this.requestWakeLock();
        this.pollOrdersFallback();
      });

      document.addEventListener('click', stopAlarmAndUnlock, { passive: true });
      document.addEventListener('touchstart', stopAlarmAndUnlock, { passive: true });
      document.addEventListener('keydown', stopAlarmAndUnlock, { passive: true });

      Sound.onAlarmStart(() => this.showAlarmBanner());
      Sound.onAlarmStop(() => this.hideAlarmBanner());
    }

    // Listen for notification tap actions in Capacitor Native
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
      try {
        window.Capacitor.Plugins.LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
          console.log('🚨 Notification clicked:', notificationAction);
          const extra = notificationAction.notification?.extra || {};
          const targetEstId = extra.establishmentId || extra.establishment_id;
          const targetOrderId = extra.orderId || extra.order_id;
          if (targetEstId) {
            this.focusEstablishment(targetEstId, targetOrderId);
          }
        });
      } catch(e) {
        console.warn('LocalNotifications listener registration:', e);
      }
    }

    // Keep screen awake permanently so mobile/desktop browsers do not sleep
    this.requestWakeLock();

    // Audio & JS background heartbeat keep-alive
    this.startBackgroundHeartbeat();

    // Start 3.5-second REST polling fallback for live order detection across all stores
    this.startOrdersPolling();

    // Check if Google OAuth session is active
    await this.checkSupabaseSession();

    // Permanent persistent auto-login (NEVER logs out or closes)
    if (!this.isAuthenticated) {
      const isOwnerPerm = localStorage.getItem('owner_authenticated_permanently') === 'true';
      const isNative = window.location.origin.includes('localhost') || window.location.origin.includes('capacitor') || (typeof window.Capacitor !== 'undefined');
      const savedPass = localStorage.getItem('owner_password') || ((isOwnerPerm || isNative) ? '0424' : '0424');
      if (savedPass) {
        await this.login(savedPass, true);
      }
    }

    // Process any pending notification click target on app start
    if (window.pendingTargetEstId) {
      const pEstId = window.pendingTargetEstId;
      const pOrderId = window.pendingTargetOrderId;
      window.pendingTargetEstId = null;
      window.pendingTargetOrderId = null;
      setTimeout(() => this.focusEstablishment(pEstId, pOrderId), 500);
    }
  }

  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        if (!this.wakeLock || this.wakeLock.released) {
          this.wakeLock = await navigator.wakeLock.request('screen');
          console.log('🔆 Screen WakeLock active: Dashboard display will stay awake permanently.');
        }
      }
    } catch(err) {
      console.warn('Wake Lock request notice:', err);
    }
  }

  startBackgroundHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      try {
        if (typeof Sound !== 'undefined' && Sound.ctx && Sound.ctx.state === 'suspended') {
          Sound.ctx.resume().catch(() => {});
        }
      } catch(e) {}
    }, 15000);
  }

  async processOwnerSession(user) {
    if (!user || this.isAuthenticated) return;
    this.isAuthenticated = true;

    try {
      const res = await fetch('/api/owner/establishments');
      this.establishments = this.enforceVerifiedGps(await res.json());
      await this.loadOrders();
      
      // UI transitions
      const gate = document.getElementById('login-gate');
      if (gate) gate.classList.add('hidden');

      const panel = document.getElementById('admin-panel');
      if (panel) panel.classList.remove('hidden');
      
      const warningBanner = document.getElementById('backup-warning-banner');
      if (warningBanner) warningBanner.classList.add('hidden');
      
      this.renderTable();
      await this.loadCentralSedeSettings();
      this.initPresence(user.email);
      this.initWebSocket();
      this.requestNotificationPermission();
      this.showToast('👑 Acceso de Dueño verificado con Google');
    } catch (err) {
      console.error(err);
      alert('Error de conexión al cargar los datos.');
    }
  }

  async checkSupabaseSession() {
    if (typeof SupabaseApp === 'undefined') return;
    await SupabaseApp.init();

    if (SupabaseApp.client) {
      SupabaseApp.client.auth.onAuthStateChange(async (event, session) => {
        if (session && session.user && !this.isAuthenticated) {
          await this.processOwnerSession(session.user);
        }
      });
    }

    const session = await SupabaseApp.getCurrentSession();
    if (session && session.user && !this.isAuthenticated) {
      await this.processOwnerSession(session.user);
    }
  }

  async initPresence(email) {
    if (typeof SupabaseApp === 'undefined' || !SupabaseApp.client) return;
    const client = SupabaseApp.client;
    
    // Configurar canal de presence
    const channel = client.channel('online-owners', {
      config: {
        presence: {
          key: email,
        },
      },
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const onlineUsers = Object.keys(state).map(key => state[key][0].email);
      const uniqueUsers = [...new Set(onlineUsers)];
      
      const indicator = document.getElementById('online-owners-indicator');
      const countSpan = document.getElementById('online-owners-count');
      
      if (indicator && countSpan) {
        indicator.classList.remove('hidden');
        countSpan.textContent = `${uniqueUsers.length} activo${uniqueUsers.length !== 1 ? 's' : ''}`;
        indicator.title = `Dueños en línea:\n${uniqueUsers.join('\n')}`;
      }
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ email: email, online_at: new Date().toISOString() });
      }
    });
  }

  async loginWithGoogle() {
    if (typeof SupabaseApp === 'undefined') {
      const autoPass = prompt('👑 Ingresa la Clave Maestra de Dueño (Ej: 0424):');
      if (autoPass) await this.login(autoPass);
      return;
    }
    
    try {
      await SupabaseApp.init();
      if (!SupabaseApp.client) {
        const autoPass = prompt('👑 Ingresa la Clave Maestra de Dueño (Ej: 0424):');
        if (autoPass) await this.login(autoPass);
        return;
      }
      await SupabaseApp.loginWithGoogle('/admin.html');
    } catch (err) {
      console.error(err);
      const autoPass = prompt('⚠️ Para ingresar directamente sin Google, escribe la Clave Maestra (0424):');
      if (autoPass) await this.login(autoPass);
    }
  }

  async login(customPassword = null, isAutoLogin = false) {
    const password = (typeof customPassword === 'string' && customPassword)
      ? customPassword
      : (document.getElementById('admin-pass')?.value || '').trim();

    if (!password) {
      if (!isAutoLogin) alert('⚠️ Por favor ingresa la clave de dueño.');
      return;
    }

    const errorMsg = document.getElementById('login-error');
    if (errorMsg) errorMsg.classList.add('hidden');

    try {
      const response = await fetch('/api/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (response.ok) {
        const data = await response.json();
        this.isAuthenticated = true;
        this.establishments = this.enforceVerifiedGps(data.establishments || []);

        // Save permanent session so it NEVER logs out or expires
        localStorage.setItem('owner_authenticated_permanently', 'true');
        localStorage.setItem('is_platform_owner', 'true');
        localStorage.setItem('owner_password', password);
        try {
          localStorage.setItem('pedigochos_admin_establishments', JSON.stringify(this.establishments));
        } catch(e) {}

        // Load orders for statistics
        await this.loadOrders();

        // UI transitions
        const gate = document.getElementById('login-gate');
        if (gate) gate.classList.add('hidden');

        const panel = document.getElementById('admin-panel');
        if (panel) panel.classList.remove('hidden');

        // Render data
        this.renderTable();
        await this.loadCentralSedeSettings();
        this.initWebSocket();
        this.requestNotificationPermission();
        this.requestWakeLock();
        this.showToast('👑 Sesión de Administrador Permanente Activa');
        
        const warningBanner = document.getElementById('backup-warning-banner');
        if (warningBanner) warningBanner.classList.add('hidden');
      } else {
        if (!isAutoLogin && errorMsg) errorMsg.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Login error:', err);
      // On network failure or offline mode, automatically enter authenticated state
      this.isAuthenticated = true;
      localStorage.setItem('owner_authenticated_permanently', 'true');
      localStorage.setItem('is_platform_owner', 'true');
      localStorage.setItem('owner_password', password || '0424');

      const gate = document.getElementById('login-gate');
      if (gate) gate.classList.add('hidden');
      const panel = document.getElementById('admin-panel');
      if (panel) panel.classList.remove('hidden');

      // Render cached data immediately if available
      this.renderTable();
      this.initWebSocket();
      this.requestNotificationPermission();
      this.requestWakeLock();
      this.showToast('🔄 Conectando con el servidor central...', true);

      // Start automatic retry loop until establishments load from server
      this.startEstablishmentsRetryLoop();
    }
  }

  async fetchEstablishments() {
    try {
      const res = await fetch('/api/owner/establishments');
      if (res.ok) {
        const raw = await res.json();
        if (Array.isArray(raw) && raw.length > 0) {
          this.establishments = this.enforceVerifiedGps(raw);
          try {
            localStorage.setItem('pedigochos_admin_establishments', JSON.stringify(this.establishments));
          } catch(e) {}
          this.renderTable();
          return true;
        }
      }
    } catch(err) {
      console.warn('Retry fetch establishments notice:', err);
    }
    return false;
  }

  startEstablishmentsRetryLoop() {
    if (this.estRetryTimer) clearInterval(this.estRetryTimer);
    this.estRetryTimer = setInterval(async () => {
      const ok = await this.fetchEstablishments();
      if (ok) {
        clearInterval(this.estRetryTimer);
        this.estRetryTimer = null;
        await this.loadOrders();
        await this.loadCentralSedeSettings();
        this.renderTable();
        this.showToast('🟢 Conectado con el servidor central');
      }
    }, 3000);
  }

  startOrdersPolling() {
    if (this.ordersPollTimer) clearInterval(this.ordersPollTimer);
    this.ordersPollTimer = setInterval(() => {
      if (this.isAuthenticated) this.pollOrdersFallback();
    }, 3500);
  }

  async pollOrdersFallback() {
    try {
      const res = await fetch('/api/orders');
      if (!res.ok) return;
      const allOrders = await res.json();
      if (!Array.isArray(allOrders)) return;

      if (!this.initialOrdersLoaded) {
        this.orders = allOrders;
        this.initialOrdersLoaded = true;
        this.renderTable();
        return;
      }

      const brandNew = allOrders.filter(ao => !this.orders.some(o => o.id === ao.id));
      this.orders = allOrders;
      this.renderTable();

      if (brandNew.length > 0) {
        const now = Date.now();
        // Only trigger alarm for truly recent pending orders created within the last 15 minutes
        const activeNewOrders = brandNew.filter(order => {
          const status = (order.status || '').toLowerCase();
          const isPending = status === 'pendiente' || status === 'pending' || status === 'preparando';
          const orderTime = new Date(order.createdAt || order.created_at || order.timestamp || Date.now()).getTime();
          const isRecent = isNaN(orderTime) ? true : (now - orderTime) < (30 * 60 * 1000);
          return isPending && isRecent;
        });

        if (activeNewOrders.length > 0) {
          console.log('🚨 [Admin Polling] Nuevos pedidos entrantes en vivo:', activeNewOrders);
          this.playOrderNotification(activeNewOrders[0]);
        }
      }
    } catch(e) {
      console.warn('Admin orders polling error:', e);
    }
  }

  showAlarmBanner(orderCode, storeName = null, estId = null, orderId = null) {
    this.lastAlarmEstId = estId || this.lastAlarmEstId;
    this.lastAlarmOrderId = orderId || this.lastAlarmOrderId;

    let banner = document.getElementById('admin-alarm-banner');
    const storeLabel = storeName ? `🏪 ${storeName}` : '¡NUEVO PEDIDO ENTRANTE EN LA PLATAFORMA!';
    
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'admin-alarm-banner';
      banner.className = 'kitchen-alarm-banner';
      document.body.appendChild(banner);
    }

    banner.innerHTML = `
      <div class="alarm-banner-inner" onclick="AdminApp.handleAlarmBannerClick();">
        <div class="alarm-banner-left">
          <span class="alarm-siren-icon">🚨</span>
          <div class="alarm-banner-text">
            <div class="alarm-title">${storeLabel} <span class="alarm-order-code">${orderCode ? '#' + orderCode : ''}</span></div>
            <div class="alarm-subtitle">👉 Toca aquí para ver este restaurante y apagar la alarma</div>
          </div>
        </div>
        <button class="alarm-btn-silence" onclick="event.stopPropagation(); if(window.Sound) Sound.stopAlarm(); AdminApp.hideAlarmBanner();">
          🔕 Silenciar
        </button>
      </div>
    `;
    banner.classList.remove('hidden');
  }

  handleAlarmBannerClick() {
    if (window.Sound) Sound.stopAlarm();
    this.hideAlarmBanner();
    if (this.lastAlarmEstId) {
      this.focusEstablishment(this.lastAlarmEstId, this.lastAlarmOrderId);
    }
  }

  hideAlarmBanner() {
    const banner = document.getElementById('admin-alarm-banner');
    if (banner) {
      banner.classList.add('hidden');
    }
  }

  async loadOrders() {
    try {
      const response = await fetch('/api/orders');
      if (response.ok) {
        this.orders = await response.json();
      } else {
        this.orders = [];
      }
    } catch (err) {
      console.error('Error loading orders:', err);
      this.orders = [];
    }
  }

  async logout() {
    if (!confirm('¿Estás seguro de que deseas cerrar sesión? Si sales del panel, dejarás de recibir notificaciones y alarmas sonoras de nuevos pedidos.')) return;
    this.isAuthenticated = false;
    this.establishments = [];
    this.orders = [];
    localStorage.removeItem('owner_authenticated_permanently');
    localStorage.removeItem('is_platform_owner');
    localStorage.removeItem('owner_password');

    if (typeof SupabaseApp !== 'undefined') {
      await SupabaseApp.logout();
    }

    if (this.wakeLock) {
      try { this.wakeLock.release(); } catch(e) {}
    }

    document.getElementById('admin-pass').value = '';
    document.getElementById('login-gate').classList.remove('hidden');
    document.getElementById('admin-panel').classList.add('hidden');
  }

  renderTable() {
    this.updateSaveButtonState();
    this.renderAnalyticsPro();
    const tbody = document.getElementById('keys-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Deduplicate establishments strictly by ID before rendering
    const seenRenderIds = new Set();
    const uniqueEsts = (this.establishments || []).filter(e => {
      if (!e || !e.id) return false;
      const sid = String(e.id).trim();
      if (seenRenderIds.has(sid)) return false;
      seenRenderIds.add(sid);
      return true;
    });
    this.establishments = uniqueEsts;

    if (this.establishments.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
            No hay comercios registrados en la plataforma.
          </td>
        </tr>
      `;
      return;
    }

    this.establishments.forEach(est => {
      const estOrders = this.orders.filter(o => o.establishmentId === est.id || o.establishment_id === est.id);
      const ordersCount = estOrders.length;
      const totalRevenue = estOrders.reduce((sum, o) => sum + (o.total || 0), 0);

      // Find last order details
      let lastOrderHTML = '<span style="color: var(--text-muted); font-size: 11px;">Sin pedidos aún</span>';
      if (estOrders.length > 0) {
        const sortedOrders = [...estOrders].sort((a, b) => new Date(b.createdAt || b.timestamp || b.created_at || 0) - new Date(a.createdAt || a.timestamp || a.created_at || 0));
        const lastOrder = sortedOrders[0];
        
        const rawDate = lastOrder.createdAt || lastOrder.timestamp || lastOrder.created_at;
        const orderDate = rawDate ? new Date(rawDate) : null;
        const timeAgoStr = orderDate ? this.getTimeAgoStr(orderDate) : 'Reciente';

        const statusMap = {
          'pending': { label: '⏳ Pendiente', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' },
          'preparing': { label: '👨‍🍳 En Preparación', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)' },
          'ready': { label: '📦 Listo', color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.15)' },
          'on_the_way': { label: '🛵 En Camino', color: '#06B6D4', bg: 'rgba(6, 182, 212, 0.15)' },
          'completed': { label: '✅ Entregado', color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)' },
          'cancelled': { label: '❌ Cancelado', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)' }
        };

        const statusObj = statusMap[lastOrder.status] || { label: lastOrder.status || 'Registrado', color: '#94A3B8', bg: 'rgba(255,255,255,0.08)' };
        const codeStr = lastOrder.deliveryDetails?.code || lastOrder.orderCode || (lastOrder.id ? lastOrder.id.slice(-4) : '---');

        lastOrderHTML = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-size: 11px; font-weight: 700; color: #334155;">⏱️ ${timeAgoStr}</span>
            <span style="background: ${statusObj.bg}; color: ${statusObj.color}; border: 1px solid ${statusObj.color}; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 800; display: inline-block; width: fit-content;">
              ${statusObj.label} (#${codeStr})
            </span>
          </div>
        `;
      }

      const row = document.createElement('tr');
      row.style.cursor = 'pointer';
      row.onclick = () => AdminApp.showEstablishmentActions(est.id);

      const disabledBadge = est.disabled 
        ? `<span style="background: rgba(239, 68, 68, 0.15); color: #DC2626; border: 1px solid #DC2626; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800; margin-left: 6px;">🚫 DESHABILITADO</span>`
        : '';

      const latDisplay = est.latitude ? parseFloat(est.latitude).toFixed(4) : '7.8145';
      const lngDisplay = est.longitude ? parseFloat(est.longitude).toFixed(4) : '-72.4430';

      const missingPrices = this.getMissingPricesForEstablishment(est);
      const missingPricesBadge = missingPrices.length > 0
        ? `<button type="button" onclick="event.stopPropagation(); AdminApp.openQuickFillPricesModal('${est.id}')" style="background: rgba(245, 158, 11, 0.18); color: #B45309; border: 1.5px solid #F59E0B; font-size: 10.5px; font-weight: 800; padding: 2px 7px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; box-shadow: 0 2px 6px rgba(245,158,11,0.25); animation: pulse 2s infinite;" title="Haz clic para llenar precios pendientes">⚠️ ${missingPrices.length} adicionales sin precio</button>
           <button type="button" onclick="event.stopPropagation(); AdminApp.openClearModifiersModal('${est.id}')" style="background: rgba(239, 68, 68, 0.15); color: #DC2626; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 10.5px; font-weight: 800; padding: 2px 7px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; box-shadow: 0 2px 6px rgba(239,68,68,0.2);" title="Eliminar o limpiar adicionales de este restaurante">🗑️ Limpiar Adicionales</button>`
        : '';

      row.innerHTML = `
        <td class="shop-title-cell" style="font-weight: 700;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">${est.logo || '🏪'}</span>
            <div>
              <span style="font-size: 14px; font-weight: 800; color: #0F172A;">${est.name}</span>
              ${disabledBadge}
            </div>
          </div>
          <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span style="background: rgba(16, 185, 129, 0.15); color: #065F46; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
              📍 ${est.location || 'San Antonio'} (${latDisplay}, ${lngDisplay})
            </span>
            ${missingPricesBadge}
            <button type="button" onclick="event.stopPropagation(); AdminApp.openStoreMapSingle('${est.id}')" style="background: #10B981; color: #FFFFFF; border: none; font-size: 10.5px; font-weight: 800; padding: 3px 10px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; box-shadow: 0 2px 6px rgba(16,185,129,0.3);">
              🗺️ Ver en Mapa
            </button>
          </div>
        </td>
        <td><span class="shop-category-cell">${est.category}</span></td>
        <td style="font-weight: 700; color: #0F172A;">${ordersCount}</td>
        <td>${lastOrderHTML}</td>
        <td style="font-weight: 800; color: var(--primary);">${this.formatPesos(totalRevenue)}</td>
        <td class="shop-key-cell" style="font-family: monospace; font-size: 13px; font-weight: 800; white-space: nowrap;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: #D97706; font-weight: 800;">${est.linkKey}</span>
            <button type="button" onclick="event.stopPropagation(); AdminApp.promptChangeLinkKey('${est.id}', '${est.name.replace(/'/g, "\\'")}', '${est.linkKey}')" title="Cambiar clave de vinculación" style="background: rgba(245, 158, 11, 0.15); color: #B45309; border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 6px; padding: 2px 6px; font-size: 11px; cursor: pointer;">✏️</button>
          </div>
        </td>
        <td style="text-align: center; white-space: nowrap;">
          <button class="btn-goto-kitchen" onclick="event.stopPropagation(); AdminApp.openStoreKitchen('${est.id}')" style="background-color: #F59E0B; color: #1E293B; border: none; font-size: 12px; padding: 6px 12px; border-radius: var(--radius-sm); font-weight: 800; margin: 0 2px; width: auto; display: inline-block; cursor: pointer; box-shadow: 0 2px 6px rgba(245,158,11,0.35);" title="Abrir cocina de este comercio en vivo">
            🍳 Cocina (KDS)
          </button>
          <button class="btn-goto-kitchen" onclick="event.stopPropagation(); AdminApp.openStoreQRModal('${est.id}')" style="background-color: #6366F1; color: #FFFFFF; border: none; font-size: 12px; padding: 6px 12px; border-radius: var(--radius-sm); font-weight: 800; margin: 0 2px; width: auto; display: inline-block; cursor: pointer; box-shadow: 0 2px 6px rgba(99,102,241,0.3);">
            📱 QR & Link
          </button>
          <button class="btn-goto-kitchen" onclick="event.stopPropagation(); AdminApp.openStoreMapSingle('${est.id}')" style="background-color: #10B981; color: #FFFFFF; border: none; font-size: 12px; padding: 6px 12px; border-radius: var(--radius-sm); font-weight: 800; margin: 0 2px; width: auto; display: inline-block; cursor: pointer; box-shadow: 0 2px 6px rgba(16,185,129,0.25);">
            🗺️ Ubicación GPS
          </button>
          <button class="btn-goto-kitchen" onclick="event.stopPropagation(); AdminApp.toggleDisableEstablishment('${est.id}')" style="background-color: ${est.disabled ? '#FEF3C7' : '#F3F4F6'}; color: ${est.disabled ? '#D97706' : '#374151'}; border: 1px solid ${est.disabled ? '#FCD34D' : '#D1D5DB'}; font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm); font-weight: 700; margin: 0 2px; width: auto; display: inline-block; cursor: pointer;">
            ${est.disabled ? '🟢 Habilitar' : '🚫 Deshabilitar'}
          </button>
          <button class="btn-goto-kitchen" onclick="event.stopPropagation(); AdminApp.deleteEstablishment('${est.id}', '${est.name}')" style="background-color: #FEE2E2; color: #991B1B; border: 1px solid #FCA5A5; font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm); font-weight: 700; margin: 0 2px; width: auto; display: inline-block; cursor: pointer;">
            🗑️ Eliminar
          </button>
        </td>
      `;
      tbody.appendChild(row);
    });

    this.loadDriversTable();
    this.loadAdminMasterCatalogTable();
  }

  async loadDriversTable() {
    const tbody = document.getElementById('admin-drivers-table-body');
    if (!tbody) return;

    try {
      const res = await fetch('/api/drivers');
      if (!res.ok) return;
      const drivers = await res.json();

      if (!Array.isArray(drivers) || drivers.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">
              No hay repartidores registrados en el sistema. Registra el primero con el botón azul arriba.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = drivers.map(d => {
        const isOnline = d.status === 'Disponible' || d.status === 'En Camino';
        const statusBadge = d.status === 'En Camino' 
          ? '<span style="background: rgba(59,130,246,0.2); color: #3B82F6; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px;">🛵 En Camino</span>'
          : (d.status === 'Disponible' 
            ? '<span style="background: rgba(16,185,129,0.2); color: #10B981; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px;">🟢 Disponible</span>'
            : '<span style="background: rgba(239,68,68,0.2); color: #EF4444; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px;">🔴 Fuera de Servicio</span>');

        const cleanPhone = (d.phone || '').replace(/\D/g, '');
        const waLink = `https://wa.me/${cleanPhone}`;

        return `
          <tr>
            <td style="font-weight: 800; color: #0F172A;">🛵 ${d.name}</td>
            <td>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 12px; font-weight: 700; color: #334155;">📱 ${d.phone}</span>
                <a href="${waLink}" target="_blank" style="background: rgba(37,211,102,0.18); color: #15803d; border: 1px solid rgba(37,211,102,0.4); font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 6px; text-decoration: none; display: inline-flex; align-items: center; gap: 3px;" title="Chat directo por WhatsApp">
                  💬 Chat
                </a>
              </div>
            </td>
            <td style="font-size: 12px; font-weight: 600; color: #334155;">${d.vehicleType || 'Moto 🛵'}</td>
            <td style="font-family: monospace; font-size: 13px; font-weight: 800; color: #047857;">${d.linkKey}</td>
            <td style="font-weight: 800; color: var(--primary); text-align: center;">${d.totalDeliveries || 0}</td>
            <td>${statusBadge}</td>
            <td style="text-align: center;">
              <div style="display: flex; gap: 6px; justify-content: center;">
                <a href="${waLink}" target="_blank" style="background: rgba(37,211,102,0.2); color: #25D366; border: 1px solid rgba(37,211,102,0.4); font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 8px; text-decoration: none; display: inline-block;">
                  💬 WhatsApp
                </a>
                <a href="/driver.html" target="_blank" style="background: rgba(59,130,246,0.15); color: #3B82F6; border: 1px solid rgba(59,130,246,0.3); font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 8px; text-decoration: none; display: inline-block;">
                  🛵 App Driver
                </a>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch(e) {
      console.warn('Error loading drivers table:', e);
    }
  }

  openRegisterDriverModal() {
    const modal = document.getElementById('admin-register-driver-modal');
    if (!modal) return;
    document.getElementById('reg-driver-name').value = '';
    document.getElementById('reg-driver-phone').value = '';
    document.getElementById('reg-driver-key').value = 'GOCHO-' + Math.floor(1000 + Math.random() * 9000);
    modal.classList.add('active');
    this.checkModalOpenState();
  }

  closeRegisterDriverModal() {
    const modal = document.getElementById('admin-register-driver-modal');
    if (modal) modal.classList.remove('active');
    this.checkModalOpenState();
  }

  async handleRegisterDriverSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('reg-driver-name').value.trim();
    const prefixEl = document.getElementById('reg-driver-prefix');
    const prefix = prefixEl ? prefixEl.value : '+57';
    let rawPhone = document.getElementById('reg-driver-phone').value.trim();
    const vehicleType = document.getElementById('reg-driver-vehicle').value;
    const linkKey = document.getElementById('reg-driver-key').value.trim().toUpperCase();

    const cleanDigits = rawPhone.replace(/\D/g, '').replace(/^0+/, '');
    const phone = rawPhone.startsWith('+') ? rawPhone : `${prefix}${cleanDigits}`;

    try {
      const res = await fetch('/api/drivers/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, vehicleType, linkKey })
      });

      if (res.ok) {
        this.showToast(`✅ Repartidor "${name}" (${phone}) registrado con éxito.`);
        this.closeRegisterDriverModal();
        this.loadDriversTable();
      } else {
        alert('Error al registrar repartidor.');
      }
    } catch(err) {
      console.error(err);
      alert('Error de conexión al registrar repartidor.');
    }
  }

  showEstablishmentActions(id) {
    this.openEstActionModal(id);
  }

  focusEstablishment(estId, orderId = null) {
    if (!estId) return;
    if (window.Sound) Sound.stopAlarm();
    this.hideAlarmBanner();

    // If not authenticated or establishments not loaded yet, save pending
    if (!this.isAuthenticated || !this.establishments || this.establishments.length === 0) {
      window.pendingTargetEstId = estId;
      window.pendingTargetOrderId = orderId;
      return;
    }

    const cleanId = String(estId).trim();
    const est = this.establishments.find(e => String(e.id).trim() === cleanId || (e.name && e.name.toLowerCase().trim() === cleanId.toLowerCase()));
    if (!est) {
      console.warn('focusEstablishment: establishment not found with ID/Name:', estId);
      return;
    }

    // 1. Highlight and scroll smoothly to the store row in the table
    const tbody = document.getElementById('keys-table-body');
    if (tbody) {
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const targetRow = rows.find(r => r.innerHTML.includes(est.id) || r.textContent.includes(est.name));
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetRow.style.transition = 'all 0.4s ease';
        targetRow.style.backgroundColor = 'rgba(255, 94, 58, 0.28)';
        targetRow.style.outline = '3px solid #FF5E3A';
        targetRow.style.borderRadius = '8px';
        setTimeout(() => {
          targetRow.style.backgroundColor = '';
          targetRow.style.outline = '';
        }, 5000);
      }
    }

    // 2. Open establishment action modal directly
    this.openEstActionModal(est.id);

    // 3. If there is a specific order, show the order popup on top
    if (orderId) {
      const order = this.orders.find(o => String(o.id) === String(orderId));
      if (order) {
        this.showNewOrderModal(order, est.name);
      }
    }

    this.showToast(`🏪 Mostrando local: ${est.name}`);
  }

  initModalHistoryNavigation() {
    window.addEventListener('popstate', (e) => {
      const activeModals = Array.from(document.querySelectorAll('.modal-overlay.active'));
      if (activeModals.length > 0) {
        activeModals.sort((a, b) => {
          const zA = parseInt(window.getComputedStyle(a).zIndex) || 0;
          const zB = parseInt(window.getComputedStyle(b).zIndex) || 0;
          return zB - zA;
        });

        const topModal = activeModals[0];
        if (topModal) {
          topModal.classList.remove('active');
          this.checkModalOpenState();
        }
      }
    });
  }

  pushModalState(modalId) {
    if (modalId) {
      window.history.pushState({ modalId: modalId, adminModal: true }, '');
    }
  }

  checkModalOpenState() {
    const anyActive = document.querySelector('.modal-overlay.active');
    if (anyActive) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
  }

  openEstActionModal(id) {
    const est = this.establishments.find(e => e.id === id);
    if (!est) return;

    this.activeShopId = id;
    const nameEl = document.getElementById('action-modal-shop-name');
    if (nameEl) nameEl.innerText = `${est.logo || '🏪'} ${est.name} ${est.disabled ? '(DESHABILITADO)' : ''}`;

    const disableBtn = document.getElementById('btn-toggle-disable-modal');
    if (disableBtn) {
      if (est.disabled) {
        disableBtn.innerText = '🟢 Habilitar Comercio (Mostrar en Marketplace)';
        disableBtn.style.backgroundColor = '#D1FAE5';
        disableBtn.style.color = '#065F46';
        disableBtn.style.borderColor = '#6EE7B7';
      } else {
        disableBtn.innerText = '🚫 Deshabilitar Comercio (Ocultar del Marketplace)';
        disableBtn.style.backgroundColor = '#FEF3C7';
        disableBtn.style.color = '#92400E';
        disableBtn.style.borderColor = '#FCD34D';
      }
    }

    const missingPrices = this.getMissingPricesForEstablishment(est);
    const quickFillBtn = document.getElementById('action-modal-quick-fill-btn');
    if (quickFillBtn) {
      if (missingPrices.length > 0) {
        quickFillBtn.style.display = 'flex';
        quickFillBtn.innerText = `⚡ Llenar Precios Pendientes (${missingPrices.length} adicionales)`;
      } else {
        quickFillBtn.style.display = 'none';
      }
    }

    const modal = document.getElementById('est-action-modal');
    if (modal) modal.classList.add('active');
    this.checkModalOpenState();
  }

  closeEstActionModal() {
    const modal = document.getElementById('est-action-modal');
    if (modal) modal.classList.remove('active');
    this.checkModalOpenState();
  }

  openStoreKitchen(estId) {
    const targetId = estId || this.activeShopId;
    const est = this.establishments.find(e => e.id === targetId);
    if (!est) return;
    this.closeEstActionModal();
    const url = '/kitchen.html?key=' + encodeURIComponent(est.linkKey || '');
    window.open(url, '_blank') || (window.location.href = url);
  }

  viewShopMenu() {
    if (!this.activeShopId) return;
    this.closeEstActionModal();
    const url = '/?shop=' + this.activeShopId;
    window.open(url, '_blank') || (window.location.href = url);
  }

  openEditShopModal() {
    if (!this.activeShopId) return;
    const est = this.establishments.find(e => e.id === this.activeShopId);
    if (!est) return;

    this.closeEstActionModal();

    // Show modal immediately
    const modal = document.getElementById('edit-est-modal');
    if (modal) modal.classList.add('active');
    this.checkModalOpenState();

    this.checkStoreGPSStatus(est);

    try {
      const idInp = document.getElementById('edit-shop-id');
      if (idInp) idInp.value = est.id;
      const nameInp = document.getElementById('edit-shop-name');
      if (nameInp) nameInp.value = est.name;
      const keyInp = document.getElementById('edit-shop-link-key');
      if (keyInp) keyInp.value = est.linkKey || '';
      const descInp = document.getElementById('edit-shop-description');
      if (descInp) descInp.value = est.description || '';
      const locInp = document.getElementById('edit-shop-location');
      if (locInp) locInp.value = est.location || 'San Antonio';
      const delInp = document.getElementById('edit-shop-delivery');
      if (delInp) delInp.value = est.delivery_fee || 0;
      const bannerInput = document.getElementById('edit-shop-banner');
      if (bannerInput) bannerInput.value = est.banner || '';
      const themeInp = document.getElementById('edit-shop-theme');
      if (themeInp) themeInp.value = est.themeColor || '#FF5E3A';
      const disabledInp = document.getElementById('edit-shop-disabled');
      if (disabledInp) disabledInp.checked = Boolean(est.disabled);

      // Initialize GPS map for editing establishment
      setTimeout(() => {
        this.initEditShopGPSMap(est);
      }, 200);

      // Show preparation & delivery times & business hours for all establishments
      const timesGroup = document.getElementById('edit-shop-times-group');
      const prepInput = document.getElementById('edit-shop-prep-time');
      const deliveryTimeInput = document.getElementById('edit-shop-delivery-time');
      const openTimeInput = document.getElementById('edit-shop-open-time');
      const closeTimeInput = document.getElementById('edit-shop-close-time');

      if (timesGroup) {
        timesGroup.style.display = 'grid';
        timesGroup.classList.remove('hidden');
      }
      if (prepInput) prepInput.value = est.prep_time || '';
      if (deliveryTimeInput) deliveryTimeInput.value = est.delivery_time || '';
      if (openTimeInput) openTimeInput.value = est.open_time || '17:00';
      if (closeTimeInput) closeTimeInput.value = est.close_time || '00:00';

      const workingDays = Array.isArray(est.working_days) && est.working_days.length > 0
        ? est.working_days
        : ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

      document.querySelectorAll('input[name="edit-working-day"]').forEach(chk => {
        chk.checked = workingDays.includes(chk.value);
      });

      const select = document.getElementById('edit-shop-logo');
      if (select) {
        select.innerHTML = '';
        const emojis = CATEGORY_EMOJIS[est.category] || ['🏪'];
        emojis.forEach(emoji => {
          const opt = document.createElement('option');
          opt.value = emoji;
          opt.innerText = `${emoji} Icono`;
          if (emoji === est.logo) opt.selected = true;
          select.appendChild(opt);
        });
      }

      // Populate global catalog dropdown for product imports if element exists
      const importSelect = document.getElementById('import-product-select');
      if (importSelect) {
        importSelect.innerHTML = `<option value="">Cargando catálogo...</option>`;
        if (typeof MenuBuilder !== 'undefined' && MenuBuilder.supabase) {
          MenuBuilder.supabase
            .from('products')
            .select('*')
            .order('name', { ascending: true })
            .then(({ data, error }) => {
              if (error) throw error;
              this.globalProductsCache = data || [];
              importSelect.innerHTML = `<option value="">-- Selecciona un producto --</option>`;
              this.globalProductsCache.forEach(prod => {
                const opt = document.createElement('option');
                opt.value = prod.id;
                opt.innerText = `${prod.name} ($${parseFloat(prod.price).toFixed(2)})`;
                importSelect.appendChild(opt);
              });
            })
            .catch(err => {
              console.error(err);
              importSelect.innerHTML = `<option value="">Error cargando catálogo</option>`;
            });
        } else {
          importSelect.innerHTML = `<option value="">Catálogo no disponible</option>`;
        }
      }

      window.activeShopIdForMenu = est.id;
      const builderTitle = document.getElementById('menu-builder-shop-name');
      if (builderTitle) builderTitle.innerText = `🍔 Creador de Menú: ${est.name}`;
      if (typeof window.loadProducts === 'function') {
        window.loadProducts();
      }
    } catch (err) {
      console.error(err);
    }
  }

  closeEditShopModal() {
    const modal = document.getElementById('edit-est-modal');
    if (modal) modal.classList.remove('active');
    this.checkModalOpenState();
  }

  async handleEditShopSubmit(e) {
    e.preventDefault();
    if (!this.activeShopId) return;

    const est = this.establishments.find(e => e.id === this.activeShopId);
    if (!est) return;

    const submitBtn = document.getElementById('btn-submit-edit-shop');
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Guardando Cambios...</span>`;

    const name = document.getElementById('edit-shop-name').value.trim();
    const description = document.getElementById('edit-shop-description').value.trim();
    const location = document.getElementById('edit-shop-location').value;
    const logo = document.getElementById('edit-shop-logo').value;
    const delivery_fee = document.getElementById('edit-shop-delivery').value;
    const themeColor = document.getElementById('edit-shop-theme').value;

    const prep_time = document.getElementById('edit-shop-prep-time').value;
    const delivery_time = document.getElementById('edit-shop-delivery-time').value;
    const open_time = document.getElementById('edit-shop-open-time')?.value || '17:00';
    const close_time = document.getElementById('edit-shop-close-time')?.value || '00:00';

    const logoFile = document.getElementById('edit-shop-logo-file').files[0];
    const bannerFile = document.getElementById('edit-shop-banner-file').files[0];

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

      const disabled = document.getElementById('edit-shop-disabled')?.checked || false;

      const latVal = document.getElementById('edit-shop-latitude')?.value;
      const lngVal = document.getElementById('edit-shop-longitude')?.value;
      const latitude = (latVal !== '' && latVal !== null && latVal !== undefined) ? parseFloat(latVal) : null;
      const longitude = (lngVal !== '' && lngVal !== null && lngVal !== undefined) ? parseFloat(lngVal) : null;

      const payload = {
        isOwner: true,
        name,
        description,
        location,
        logo,
        delivery_fee,
        banner,
        themeColor,
        logoImage,
        disabled,
        latitude,
        longitude,
        location_lat: latitude,
        location_lng: longitude,
        prep_time: prep_time ? parseInt(prep_time) : null,
        delivery_time: delivery_time ? parseInt(delivery_time) : null,
        open_time: open_time,
        close_time: close_time,
        working_days: Array.from(document.querySelectorAll('input[name="edit-working-day"]:checked')).map(c => c.value)
      };

      const newLinkKey = document.getElementById('edit-shop-link-key')?.value.trim().toUpperCase();
      if (newLinkKey) {
        payload.newLinkKey = newLinkKey;
      }

      const res = await fetch(`/api/establishments/${this.activeShopId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        this.showToast('✅ Cambios guardados con éxito.');
        this.closeEditShopModal();
        
        // Reset file inputs
        document.getElementById('edit-shop-logo-file').value = '';
        document.getElementById('edit-shop-banner-file').value = '';
        
        await this.reloadData();
        this.markPendingChanges();
      } else {
        alert('Error al guardar los cambios.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de red al guardar los cambios.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Guardar Cambios</span>`;
    }
  }

  generateRandomLinkKeyForEdit() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const inp = document.getElementById('edit-shop-link-key');
    if (inp) {
      inp.value = result;
      this.showToast(`🔑 Nueva clave generada: ${result}`);
    }
  }

  async promptChangeLinkKey(estId, estName, currentKey) {
    const newKey = prompt(`🔑 Cambiar clave de vinculación para "${estName}":\n\nClave actual: ${currentKey || 'N/A'}\n\nIngresa la nueva clave (letras o números, ej. MIRESTAURANTE o 6MAP9F):`, currentKey || '');
    if (newKey === null) return;
    
    const cleanKey = newKey.trim().toUpperCase();
    if (!cleanKey) {
      alert('La clave de vinculación no puede estar vacía.');
      return;
    }

    try {
      const res = await fetch(`/api/establishments/${estId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          newLinkKey: cleanKey
        })
      });

      if (res.ok) {
        this.showToast(`✅ Clave de vinculación de ${estName} actualizada a: ${cleanKey}`);
        await this.reloadData();
      } else {
        alert('Error al actualizar la clave de vinculación.');
      }
    } catch(err) {
      console.error(err);
      alert('Error de conexión al actualizar la clave.');
    }
  }

  async importGlobalProduct() {
    if (!this.activeShopId) return;
    const select = document.getElementById('import-product-select');
    const prodId = select.value;
    if (!prodId) {
      alert('Por favor, selecciona un producto de la lista para importar.');
      return;
    }

    const selected = this.globalProductsCache.find(p => p.id === prodId);
    if (!selected) return;

    const est = this.establishments.find(e => e.id === this.activeShopId);
    if (!est) return;

    if (!est.products) est.products = [];

    // Check if duplicate
    if (est.products.some(p => p.name.toLowerCase() === selected.name.toLowerCase())) {
      alert(`⚠️ El producto "${selected.name}" ya está en el menú de este establecimiento.`);
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
        this.showToast(`📥 ¡${selected.name} importado con éxito!`);
        
        // Refresh active menu view
        if (window.activeShopIdForMenu === est.id) {
          if (typeof window.loadProducts === 'function') {
            await window.loadProducts();
          }
        }
        this.markPendingChanges();
      } else {
        alert('Error al guardar el producto importado.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al importar el producto.');
    }
  }

  modifyMenuAndTables() {
    if (!this.activeShopId) return;
    const est = this.establishments.find(e => e.id === this.activeShopId);
    if (!est) return;

    this.closeEstActionModal();

    window.activeShopIdForMenu = est.id;
    this.activeFloorTool = 'table'; // Default tool

    // Update titles and subtext
    document.getElementById('designer-modal-shop-name').innerText = `🍔 Taller de Menú y Distribución: ${est.name}`;
    document.getElementById('designer-modal-shop-subtext').innerText = `Diseño de distribución de mesas y carta de comida para ${est.name}`;

    // Open Modal
    const modal = document.getElementById('menu-tables-modal');
    if (modal) modal.classList.add('active');
    this.checkModalOpenState();

    // Switch to default tab (daily specials or previous tab)
    const initialTab = this.activeModalTab || 'daily';
    this.switchModalTab(initialTab);
  }

  switchModalTab(tabId) {
    this.activeModalTab = tabId;
    const tabs = ['daily', 'menu', 'ai', 'tables', 'catalog'];
    tabs.forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      const content = document.getElementById(`tab-content-${t}`);
      if (btn) btn.classList.toggle('active', t === tabId);
      if (content) content.classList.toggle('active', t === tabId);
    });

    const est = this.establishments.find(e => e.id === window.activeShopIdForMenu);
    if (est) this.auditMissingPrices(est);

    if (tabId === 'daily') {
      this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
    } else if (tabId === 'menu') {
      this.renderModalCategories();
      this.renderModalProducts();
    } else if (tabId === 'ai') {
      this.initAIMenuTab();
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

    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
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
          <button type="button" class="btn-neumorphic" onclick="AdminApp.openMenuModal()" style="margin: 0; font-size: 11.5px; padding: 6px 14px; background: var(--accent); color: #121216; font-weight: 800; cursor: pointer;">➕ Asignar Plato a este Día</button>
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
          <button type="button" class="btn-daily-action toggle-active ${isPaused ? 'is-paused' : ''}" onclick="AdminApp.toggleProductStatus('${prod.id}')" title="Pausar o activar plato">
            <span>${isPaused ? '⏸️ Pausado' : '🟢 Activo Hoy'}</span>
          </button>
          <button type="button" class="btn-daily-action" onclick="AdminApp.openDailyOptionsModal('${prod.id}')" style="color: #f59e0b;" title="Editar opciones cambiantes (sopas, ensaladas, etc.)">
            <span>🍲 Opciones</span>
          </button>
          <button type="button" class="btn-daily-action" onclick="AdminApp.openProductSpecsModal('${prod.id}')" title="Editar precio, foto e ingredientes">
            <span>✏️ Editar</span>
          </button>
        </div>
      `;

      grid.appendChild(card);
    });
  }

  async toggleProductStatus(productId) {
    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
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
    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
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
          <input type="text" value="${opt.name || ''}" oninput="AdminApp.updateDailyOptionName(${gIdx}, ${oIdx}, this.value)" placeholder="Nombre del sabor u opción" style="flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 6px; padding: 5px 8px; font-size: 12px;">
          <input type="number" step="0.01" value="${opt.extra_price !== undefined ? opt.extra_price : (opt.price || 0)}" oninput="AdminApp.updateDailyOptionPrice(${gIdx}, ${oIdx}, this.value)" placeholder="+$ extra" style="width: 70px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: #10b981; border-radius: 6px; padding: 5px 6px; font-size: 11.5px; font-weight: bold; text-align: center;">
          <button type="button" onclick="AdminApp.removeDailyOptionItem(${gIdx}, ${oIdx})" style="background: rgba(239, 68, 68, 0.8); border: none; color: #fff; width: 24px; height: 24px; border-radius: 50%; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button>
        </div>
      `).join('');

      gCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <input type="text" value="${group.group_name || ''}" oninput="AdminApp.updateDailyGroupName(${gIdx}, this.value)" placeholder="Título (Ej: Sopa del Día, Ensalada, Proteína)" style="flex: 1; font-weight: 800; color: var(--accent); background: transparent; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 4px 8px; font-size: 12.5px;">
          <select onchange="AdminApp.updateDailyGroupType(${gIdx}, this.value)" style="background: rgba(18,18,22,0.9); color: #fff; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 4px 6px; font-size: 11px;">
            <option value="single" ${group.selection_type === 'single' ? 'selected' : ''}>1 Selección</option>
            <option value="multiple" ${group.selection_type === 'multiple' ? 'selected' : ''}>Múltiple</option>
          </select>
          <button type="button" onclick="AdminApp.removeDailyGroup(${gIdx})" style="background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer;">🗑️</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
          ${optionsListHTML}
        </div>

        <button type="button" onclick="AdminApp.addDailyOptionItem(${gIdx})" style="align-self: flex-start; background: rgba(255,255,255,0.05); color: #cbd5e1; border: 1px dashed rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; margin-top: 4px;">
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
    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
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
    const modal = document.getElementById('menu-tables-modal');
    if (modal) modal.classList.remove('active');
    try { this.closeProductSpecsModal(); } catch(e) { console.error(e); }
    try { this.reloadData(); } catch(e) { console.error(e); }
    this.checkModalOpenState();
  }

  openMenuModal() {
    const shopId = window.activeShopIdForMenu || this.activeShopId;
    if (!shopId) {
      alert('⚠️ Selecciona primero un establecimiento de la lista para agregarle productos.');
      return;
    }
    window.activeShopIdForMenu = shopId;

    // Populate category dropdown inside create product modal
    const select = document.getElementById('form-category');
    if (select) {
      select.innerHTML = '<option value="">-- Selecciona una categoría --</option>';
      const cats = window.categoriesList || [];
      if (cats.length > 0) {
        cats.forEach(cat => {
          const opt = document.createElement('option');
          opt.value = cat.id || cat.slug;
          opt.innerText = cat.name || cat;
          select.appendChild(opt);
        });
      } else if (typeof MenuBuilder !== 'undefined') {
        MenuBuilder.getCategories().then(c => {
          window.categoriesList = c || [];
          select.innerHTML = '<option value="">-- Selecciona una categoría --</option>';
          window.categoriesList.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id || cat.slug;
            opt.innerText = cat.name || cat;
            select.appendChild(opt);
          });
        }).catch(err => console.error(err));
      }
    }

    const modal = document.getElementById('product-modal');
    if (modal) modal.classList.add('active');
    this.checkModalOpenState();
  }

  closeMenuModal() {
    const modal = document.getElementById('product-modal');
    if (modal) modal.classList.remove('active');
    const form = document.getElementById('product-form');
    if (form) form.reset();
    this.checkModalOpenState();
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
    this.renderTablesManager();
  }

  renderTablesManager() {
    const grid = document.getElementById('restaurant-tables-manager-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
    if (!est) return;

    // Ensure est.tables exists
    if (!Array.isArray(est.tables) || est.tables.length === 0) {
      if (Array.isArray(est.layout) && est.layout.length > 0) {
        est.tables = est.layout
          .filter(i => i.type === 'table')
          .map(i => ({
            id: `t-${i.number}`,
            name: `Mesa ${i.number}`,
            number: i.number,
            capacity: 4,
            status: 'Disponible'
          }));
      } else {
        // Default 6 tables if newly created
        est.tables = [1, 2, 3, 4, 5, 6].map(n => ({
          id: `t-${n}`,
          name: `Mesa ${n}`,
          number: n,
          capacity: 4,
          status: 'Disponible'
        }));
      }
    }

    // Sort tables by number/name
    est.tables.sort((a, b) => {
      const numA = parseInt(a.number || a.name || 0, 10);
      const numB = parseInt(b.number || b.name || 0, 10);
      return (isNaN(numA) ? 0 : numA) - (isNaN(numB) ? 0 : numB);
    });

    const origin = window.location.origin;

    est.tables.forEach((table, idx) => {
      const tNum = table.number || (idx + 1);
      const tName = table.name || `Mesa ${tNum}`;
      const directUrl = `${origin}/?store=${encodeURIComponent(est.id)}&mesa=${encodeURIComponent(tNum)}`;
      const qrBoxId = `table-qr-card-box-${idx}`;

      const card = document.createElement('div');
      card.className = 'table-qr-card';
      card.style.cssText = 'background: rgba(18, 18, 24, 0.95); border: 1.5px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.4); position: relative;';

      card.innerHTML = `
        <div style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 800; color: #10B981; background: rgba(16,185,129,0.15); border: 1px solid #10B981; padding: 2px 8px; border-radius: 6px;">🟢 Activa</span>
          <button type="button" onclick="AdminApp.deleteTable('${table.id || tNum}')" title="Eliminar Mesa" style="background: rgba(239,68,68,0.15); border: 1px solid #EF4444; color: #EF4444; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 11px;">✕</button>
        </div>

        <div style="margin-top: -4px;">
          <h4 style="margin: 0; color: #FFF; font-size: 16px; font-weight: 900;">🪑 ${tName}</h4>
          <span style="font-size: 11px; color: var(--text-muted);">Capacidad: ${table.capacity || 4} pers.</span>
        </div>

        <!-- Live QR Code Element -->
        <div id="${qrBoxId}" style="width: 130px; height: 130px; background: #111116; border-radius: 12px; padding: 6px; display: flex; align-items: center; justify-content: center; border: 1.5px solid #FF6B00; box-shadow: 0 0 12px rgba(255,107,0,0.25);">
          <!-- QR Canvas -->
        </div>

        <div style="font-size: 10px; color: #94A3B8; word-break: break-all; max-width: 100%; font-family: monospace; background: rgba(0,0,0,0.3); padding: 4px 6px; border-radius: 6px;">
          /?store=${est.id}&mesa=${tNum}
        </div>

        <div style="display: flex; gap: 6px; width: 100%; margin-top: 4px;">
          <button type="button" onclick="AdminApp.downloadSingleTableQR('${tNum}', '${est.id}')" style="flex: 1; background: linear-gradient(135deg, #FF6B00 0%, #EA580C 100%); color: #FFF; border: none; padding: 7px 8px; border-radius: 8px; font-weight: 800; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; box-shadow: 0 3px 8px rgba(255,107,0,0.3);">
            📥 Descargar
          </button>
          <button type="button" onclick="AdminApp.copyTableDirectLink('${directUrl}')" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #FFF; padding: 7px 10px; border-radius: 8px; font-weight: 800; font-size: 11px; cursor: pointer;" title="Copiar Enlace">
            📋 Copiar
          </button>
        </div>
      `;

      grid.appendChild(card);

      // Generate the QR module inside the card
      setTimeout(() => {
        const qrContainer = document.getElementById(qrBoxId);
        if (qrContainer && typeof QRCode !== 'undefined') {
          qrContainer.innerHTML = '';
          new QRCode(qrContainer, {
            text: directUrl,
            width: 118,
            height: 118,
            colorDark: '#FF6B00',
            colorLight: '#111116',
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      }, 50);
    });
  }

  addNewTablePrompt() {
    this.toggleAddTableForm(true);
  }

  toggleAddTableForm(show) {
    const form = document.getElementById('add-table-quick-form');
    if (!form) return;
    form.style.display = show ? 'block' : 'none';
    if (show) {
      const shopId = window.activeShopIdForMenu || this.activeShopId;
      const est = this.establishments.find(e => e.id === shopId);
      const tables = est && Array.isArray(est.tables) ? est.tables : [];
      const maxNum = tables.reduce((max, t) => Math.max(max, parseInt(t.number || 0, 10) || 0), 0);
      const nextNum = maxNum + 1;
      const numInput = document.getElementById('new-table-number-input');
      if (numInput) {
        numInput.value = nextNum;
        numInput.focus();
      }
    }
  }

  async confirmAddNewTable() {
    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
    if (!est) return;

    const numInput = document.getElementById('new-table-number-input');
    const capInput = document.getElementById('new-table-capacity-input');
    const val = numInput ? numInput.value.trim() : '';
    if (!val) {
      alert('Por favor indica el número o nombre de la mesa.');
      return;
    }

    if (!Array.isArray(est.tables)) est.tables = [];

    const isNum = !isNaN(parseInt(val, 10)) && String(parseInt(val, 10)) === val;
    const tableNumber = isNum ? parseInt(val, 10) : val;
    const tableName = isNum ? `Mesa ${val}` : val;
    const capacity = capInput ? parseInt(capInput.value, 10) || 4 : 4;

    const newTable = {
      id: `t-${Date.now()}`,
      name: tableName,
      number: tableNumber,
      capacity: capacity,
      status: 'Disponible'
    };

    // Check if table already exists
    const exists = est.tables.some(t => String(t.number) === String(tableNumber) || t.name.toLowerCase() === tableName.toLowerCase());
    if (exists) {
      alert(`⚠️ La mesa "${val}" ya existe en el restaurante.`);
      return;
    }

    est.tables.push(newTable);

    // Auto-save to server
    try {
      await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          tables: est.tables
        })
      });
      this.showToast(`✅ ${tableName} agregada con su QR generado`);
      this.toggleAddTableForm(false);
      this.renderTablesManager();
    } catch(e) {
      console.error('Error saving table:', e);
      this.showToast('Error al guardar la mesa');
    }
  }

  async deleteTable(tableIdOrNum) {
    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
    if (!est || !Array.isArray(est.tables)) return;

    if (!confirm('¿Seguro que deseas eliminar esta mesa?')) return;

    est.tables = est.tables.filter(t => t.id !== tableIdOrNum && String(t.number) !== String(tableIdOrNum));

    try {
      await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          tables: est.tables
        })
      });
      this.showToast('🗑️ Mesa eliminada');
      this.renderTablesManager();
    } catch(e) {
      console.error(e);
    }
  }

  copyTableDirectLink(url) {
    navigator.clipboard.writeText(url).then(() => {
      this.showToast('📋 Enlace de la mesa copiado');
    }).catch(() => {
      prompt('Copia este enlace para la mesa:', url);
    });
  }

  downloadSingleTableQR(tableNumberOrName, estId) {
    const est = this.establishments.find(e => e.id === (estId || window.activeShopIdForMenu || this.activeShopId));
    if (!est) return;

    const origin = window.location.origin;
    const directUrl = `${origin}/?store=${encodeURIComponent(est.id)}&mesa=${encodeURIComponent(tableNumberOrName)}`;

    this.renderCustomOrangeQR(directUrl, (qrElement) => {
      const canvas = document.createElement('canvas');
      this.drawStoreQRDisplayCanvas(canvas, est, tableNumberOrName, qrElement);
      
      const link = document.createElement('a');
      link.download = `QR_Mesa_${tableNumberOrName}_${est.name.replace(/\s+/g, '_')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      this.showToast(`📥 Descargando QR de Mesa #${tableNumberOrName}`);
    });
  }

  downloadAllTablesQRBatch() {
    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
    if (!est || !Array.isArray(est.tables) || est.tables.length === 0) {
      alert('No hay mesas registradas en este local.');
      return;
    }

    this.showToast(`📦 Descargando lote de ${est.tables.length} códigos QR...`);
    est.tables.forEach((table, idx) => {
      setTimeout(() => {
        this.downloadSingleTableQR(table.number || (idx + 1), est.id);
      }, idx * 600);
    });
  }

  async loadModalProducts() {
    const est = this.establishments.find(e => e.id === window.activeShopIdForMenu);
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
      card.className = 'admin-product-card-item';
      card.style.background = 'rgba(255, 255, 255, 0.03)';
      card.style.border = '1px solid rgba(255, 255, 255, 0.08)';
      card.style.borderRadius = '16px';
      card.style.padding = '12px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '10px';
      card.style.position = 'relative';

      const imgUrl = prod.image || '/images/burger_royale.jpg';
      const formattedPrice = this.formatPesos(prod.price || 0);

      card.innerHTML = `
        <div style="display: flex; gap: 12px; align-items: center;">
          <img src="${imgUrl}" alt="${prod.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 12px; flex-shrink: 0; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06);" onerror="this.src='/images/burger_royale.jpg'">
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
              <h4 style="color: #ffffff; font-size: 13.5px; margin: 0; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${prod.name}</h4>
              <span style="color: #10B981; font-weight: 800; font-size: 13px; white-space: nowrap;">${formattedPrice}</span>
            </div>
            <p style="font-size: 11px; color: var(--text-muted); line-height: 1.3; margin: 4px 0 0 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${prod.description || 'Sin descripción.'}</p>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; align-items: center; gap: 8px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px; margin-top: auto;">
          <button type="button" class="btn-neumorphic" onclick="event.stopPropagation(); AdminApp.openProductSpecsModal('${prod.id}')" style="margin: 0; padding: 6px 14px; font-size: 11.5px; font-weight: 700; height: auto; display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.06); color: #FFF;">
            <span>✏️</span> Editar
          </button>
          <button type="button" class="btn-neumorphic" onclick="event.stopPropagation(); AdminApp.deleteProductFromModal('${prod.id}')" style="margin: 0; padding: 6px 10px; font-size: 11.5px; color: #EF4444; border-color: rgba(239,68,68,0.3); height: auto;" title="Eliminar producto">
            <span>🗑️</span>
          </button>
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
          .order('name', { ascending: true });
        
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

    const est = this.establishments.find(e => e.id === window.activeShopIdForMenu);
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
        : `<button onclick="AdminApp.importGlobalProductFromModal('${prod.id}')" style="background: var(--accent); color: #121216; font-weight: 800; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.2s;">➕ Agregar a mi Menú</button>`;

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

    const est = this.establishments.find(e => e.id === window.activeShopIdForMenu);
    if (!est) return;

    if (!est.products) est.products = [];

    // Duplicate check
    if (est.products.some(p => p.name.toLowerCase() === selected.name.toLowerCase())) {
      alert(`⚠️ El producto "${selected.name}" ya está en el menú.`);
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
        this.showToast(`📥 ¡${selected.name} importado con éxito!`);
        this.loadModalProducts();
        this.renderImportCatalogTable(this.globalProductsCache);
        this.markPendingChanges();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async deleteGlobalProductFromModal() {
    const select = document.getElementById('modal-import-product-select');
    const prodId = select.value;
    if (!prodId) {
      alert('⚠️ Por favor, selecciona un producto del catálogo para eliminar.');
      return;
    }

    const selected = this.globalProductsCache.find(p => p.id === prodId);
    if (!selected) return;

    if (!confirm(`⚠️ ATENCIÓN: Estás a punto de eliminar permanentemente "${selected.name}" del catálogo GLOBAL de Supabase.\n\nEsto no lo borrará de las tiendas que ya lo importaron, pero nadie más podrá importarlo.\n\n¿Estás seguro?`)) {
      return;
    }

    if (typeof MenuBuilder !== 'undefined' && MenuBuilder.supabase) {
      try {
        const { error } = await MenuBuilder.supabase
          .from('products')
          .delete()
          .eq('id', prodId);
        
        if (error) throw error;
        
        this.showToast(`🗑️ "${selected.name}" eliminado del catálogo global.`);
        await this.loadModalImportCatalog();
      } catch (err) {
        console.error(err);
        alert('Error al eliminar el producto global: ' + err.message);
      }
    }
  }

  async deleteProductFromModal(prodId) {
    if (!prodId) return;

    const shopId = window.activeShopIdForMenu || this.activeShopId;
    if (!shopId) {
      alert('⚠️ No se ha seleccionado un establecimiento activo.');
      return;
    }

    const est = this.establishments.find(e => String(e.id) === String(shopId));
    if (!est) return;

    const prod = (est.products || []).find(p => String(p.id) === String(prodId));
    const prodName = prod ? prod.name : 'este producto';

    if (!confirm(`¿Seguro que deseas eliminar "${prodName}" del menú de ${est.name}?`)) return;

    est.products = (est.products || []).filter(p => String(p.id) !== String(prodId));

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
        this.showToast(`🗑️ "${prodName}" eliminado del menú.`);
        this.loadModalProducts();
        if (typeof this.renderImportCatalogTable === 'function') {
          this.renderImportCatalogTable(this.globalProductsCache || []);
        }
        this.markPendingChanges();
      } else {
        alert('Error al guardar la eliminación del producto.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al eliminar el producto.');
    }
  }

  async importNewProductToActiveShop(newProduct) {
    const shopId = window.activeShopIdForMenu || this.activeShopId;
    if (!shopId) return;

    const est = this.establishments.find(e => String(e.id) === String(shopId));
    if (!est) return;

    if (!est.products) est.products = [];

    const rawPrice = parseFloat(newProduct.price) || 0;

    const newLocalProduct = {
      id: `p-${Date.now()}-${Math.floor(Math.random() * 100)}`,
      name: newProduct.name,
      price: rawPrice,
      description: newProduct.description || '',
      image: newProduct.image_url || newProduct.image || '',
      category: newProduct.category || newProduct.category_id || '',
      category_id: newProduct.category_id || '',
      modifiers: newProduct.modifiers,
      available_days: newProduct.available_days || ['todos'],
      exclusions: newProduct.exclusions ? newProduct.exclusions.map(name => typeof name === 'string' ? { name } : name) : undefined
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
        if (typeof this.loadModalImportCatalog === 'function') {
          this.loadModalImportCatalog();
        }
        if (typeof this.renderDailySpecialsTab === 'function') {
          this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
        }
        this.markPendingChanges();
      }
    } catch (err) {
      console.error('Error importing newly created product:', err);
    }
  }

  async deleteEstablishment(id, name) {
    const code = prompt(`⚠️ ATENCIÓN: Estás a punto de eliminar permanentemente el comercio "${name}".\n\nPor favor, ingresa el código maestro de seguridad 0424 para confirmar:`);
    if (code === null) return;

    if (code !== '0424') {
      alert('❌ Código maestro incorrecto. Operación cancelada.');
      return;
    }

    try {
      const response = await fetch(`/api/establishments/${id}?code=0424`, {
        method: 'DELETE'
      });

      if (response.ok) {
        alert(`🗑️ El establecimiento "${name}" ha sido eliminado del sistema con éxito.`);
        await this.reloadData();
        this.markPendingChanges();
      } else {
        const data = await response.json();
        alert('Error al eliminar establecimiento: ' + (data.error || 'Problema desconocido'));
      }
    } catch (err) {
      console.error(err);
      alert('Error de red al eliminar el establecimiento.');
    }
  }

  async resetBillingHistory() {
    if (!this.activeShopId) return;
    const est = this.establishments.find(e => e.id === this.activeShopId);
    if (!est) return;

    const code = prompt(`⚠️ ATENCIÓN: Estás a punto de resetear e iniciar desde $0 toda la facturación e historial de pedidos del establecimiento "${est.name}".\n\nPor favor, ingresa el código de confirmación 0424 para proceder:`);
    if (code === null) return;

    if (code !== '0424') {
      alert('❌ Código maestro incorrecto. Operación cancelada.');
      return;
    }

    try {
      const response = await fetch(`/api/establishments/${this.activeShopId}/orders/reset?code=0424`, {
        method: 'POST'
      });

      if (response.ok) {
        alert(`🔄 ¡Historial de facturación de "${est.name}" reseteado a $0 con éxito!`);
        this.closeEstActionModal();
        await this.reloadData();
        this.markPendingChanges();
      } else {
        const data = await response.json();
        alert('Error al resetear la facturación: ' + (data.error || 'Problema de red.'));
      }
    } catch (err) {
      console.error(err);
      alert('Error de red al intentar resetear la facturación.');
    }
  }

  async reloadData() {
    try {
      try {
        localStorage.removeItem('pedigochos_disabled_stores');
      } catch(e) {}

      const res = await fetch('/api/owner/establishments');
      this.establishments = this.enforceVerifiedGps(await res.json());
      if (Array.isArray(this.establishments)) {
        this.establishments.forEach(est => {
          est.disabled = Boolean(est.disabled);
        });
      }
      await this.loadOrders();
      this.renderTable();
    } catch (err) {
      console.error('Error reloading admin dashboard data:', err);
    }
  }

  formatPesos(val) {
    if (isNaN(val)) return '$0';
    return '$' + Math.round(val).toLocaleString('de-DE');
  }

  // Form helpers
  handleCategoryChange(category) {
    this.populateLogoSelect(category);
  }

  populateLogoSelect(category) {
    const select = document.getElementById('reg-logo-select');
    select.innerHTML = '';
    const emojis = CATEGORY_EMOJIS[category] || ['🏪'];
    emojis.forEach(emoji => {
      const opt = document.createElement('option');
      opt.value = emoji;
      opt.innerText = `${emoji} Icono`;
      select.appendChild(opt);
    });
  }

  generateRandomLinkKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 6; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('reg-link-key').value = key;
  }

  toggleBannerType(type) {
    const gradGroup = document.getElementById('banner-gradient-group');
    const imgGroup = document.getElementById('banner-image-group');

    if (type === 'gradient') {
      gradGroup.classList.remove('hidden');
      imgGroup.classList.add('hidden');
    } else {
      gradGroup.classList.add('hidden');
      imgGroup.classList.remove('hidden');
    }
  }

  addNewProductRow() {
    const container = document.getElementById('dynamic-products-container');
    const index = container.children.length;

    const row = document.createElement('div');
    row.className = 'reg-product-row';
    row.dataset.index = index;

    row.innerHTML = `
      <button type="button" class="btn-remove-row" onclick="AdminApp.removeProductRow(${index})" style="position: absolute; top: 8px; right: 8px; color: red;">✕</button>
      <div class="form-grid">
        <div class="form-group">
          <label>Nombre del Producto <span class="required">*</span></label>
          <input type="text" class="prod-name" required placeholder="Ej. Coca Cola 1L">
        </div>
        <div class="form-group">
          <label>Precio ($ USD) <span class="required">*</span></label>
          <input type="number" class="prod-price" required step="0.01" min="0" placeholder="Ej. 2.50">
        </div>
      </div>
      <div class="form-group">
        <label>Descripción del Producto (Ingredientes base y detalles) <span class="required">*</span></label>
        <input type="text" class="prod-desc" required placeholder="Ej. Doble carne premium, queso cheddar, lechuga, tomate en pan brioche.">
      </div>
    `;
    container.appendChild(row);
  }

  removeProductRow(index) {
    const container = document.getElementById('dynamic-products-container');
    const rows = Array.from(container.children);
    const target = rows.find(r => parseInt(r.dataset.index, 10) === index);
    if (target) {
      container.removeChild(target);
    }
  }

  async handleRegisterSubmit(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('btn-submit-registration');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = '⏳ Registrando...';
    }

    const name = document.getElementById('reg-name').value.trim();
    const category = document.getElementById('reg-category').value;
    const location = document.getElementById('reg-location').value;
    const description = document.getElementById('reg-description').value.trim();
    const logo = document.getElementById('reg-logo-select').value;
    let bannerType = document.getElementById('reg-banner-type').value;
    const linkKey = document.getElementById('reg-link-key').value.trim().toUpperCase();

    const logoFile = document.getElementById('reg-logo-file').files[0];
    const bannerFile = document.getElementById('reg-banner-file').files[0];

    let logoImage = null;
    let banner = '';
    
    if (bannerType === 'gradient') {
      banner = document.querySelector('input[name="reg-gradient"]:checked').value;
    } else {
      banner = document.getElementById('reg-banner-image').value.trim() || 'linear-gradient(135deg, #1D2671, #C33764)';
    }

    try {
      // 1. Upload custom logo file if selected
      if (logoFile) {
        if (submitBtn) submitBtn.innerText = '📤 Subiendo Logo...';
        logoImage = await MenuBuilder.uploadProductImage(logoFile);
      }

      // 2. Upload cover banner file if selected
      if (bannerFile) {
        if (submitBtn) submitBtn.innerText = '📤 Subiendo Portada...';
        banner = await MenuBuilder.uploadProductImage(bannerFile);
        bannerType = 'image';
      }

      // Parse products (optional)
      const productRows = document.querySelectorAll('.reg-product-row');
      const products = [];
      productRows.forEach((row, i) => {
        const nameInput = row.querySelector('.prod-name');
        const priceInput = row.querySelector('.prod-price');
        const descInput = row.querySelector('.prod-desc');

        const prodName = nameInput ? nameInput.value.trim() : '';
        const prodPrice = priceInput ? parseFloat(priceInput.value) : 0;
        const prodDesc = descInput ? descInput.value.trim() : '';
        
        if (prodName) {
          products.push({
            id: `p-${Date.now()}-${i}`,
            name: prodName,
            price: isNaN(prodPrice) ? 0 : prodPrice,
            description: prodDesc,
            image: DEFAULT_IMAGES[category]
          });
        }
      });

      const payload = {
        name,
        category,
        location,
        description,
        logo,
        bannerType,
        banner,
        linkKey,
        products,
        logoImage
      };

      const response = await fetch('/api/establishments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        this.showToast('✅ Establecimiento registrado con éxito.');
        
        // Reset form
        document.getElementById('reg-est-form').reset();
        document.getElementById('dynamic-products-container').innerHTML = '';
        document.getElementById('reg-logo-file').value = '';
        document.getElementById('reg-banner-file').value = '';
        this.generateRandomLinkKey();

        // Reload data from api
        await this.reloadData();
        this.markPendingChanges();
      } else {
        const errorText = await response.text();
        alert('Error al registrar establecimiento: ' + errorText);
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al servidor.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = '💼 Crear Establecimiento y Registrar';
      }
    }
  }

  openProductSpecsModal(productId) {
    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
    if (!est) return;

    const prod = est.products.find(p => p.id === productId);
    if (!prod) return;

    this.activeSpecsProductId = productId;
    
    // Set title
    const titleEl = document.getElementById('specs-modal-title');
    if (titleEl) titleEl.innerText = `⚙️ Especificaciones: ${prod.name}`;
    const idEl = document.getElementById('specs-product-id');
    if (idEl) idEl.value = productId;

    // Load general product details
    const nameEl = document.getElementById('specs-product-name');
    if (nameEl) nameEl.value = prod.name || '';
    const catEl = document.getElementById('specs-product-category');
    if (catEl) catEl.value = prod.category || '';
    const priceEl = document.getElementById('specs-product-price');
    if (priceEl) priceEl.value = prod.price !== undefined ? prod.price : '';
    const descEl = document.getElementById('specs-product-description');
    if (descEl) descEl.value = prod.description || '';

    // Load exclusions / ingredients
    this.specsIngredients = prod.exclusions ? prod.exclusions.map(e => ({
      name: typeof e === 'object' && e.name ? e.name : String(e),
      price: typeof e === 'object' && e.price !== undefined ? e.price : 500
    })) : [];
    this.renderSpecsIngredients();

    // Load modifier groups
    this.specsGroups = prod.modifiers ? JSON.parse(JSON.stringify(prod.modifiers)) : [];
    this.renderSpecsGroups();

    // Set product image preview & reset file upload input
    const previewImg = document.getElementById('specs-product-image-preview');
    if (previewImg) previewImg.src = prod.image || '/images/burger_royale.jpg';
    const fileInput = document.getElementById('specs-product-image-file');
    if (fileInput) fileInput.value = '';

    // Set available days pills
    if (typeof window.setSelectedDaysToContainer === 'function') {
      window.setSelectedDaysToContainer('specs-available-days-pills', prod.available_days || ['todos']);
    }

    // Open dedicated standalone modal without touching current tab
    const modal = document.getElementById('product-specs-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
  }

  closeProductSpecsModal() {
    const modal = document.getElementById('product-specs-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
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
        <input type="number" value="${ingPrice}" onchange="AdminApp.updateIngredientPrice(${idx}, this.value)" style="width: 70px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 4px; padding: 2px 4px; font-size: 11px; font-weight: bold; text-align: center;" placeholder="Precio">
        <span onclick="AdminApp.removeIngredientOption(${idx})" style="cursor: pointer; color: #ef4444; font-weight: 900; margin-left: 4px;">✕</span>
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
      alert('Este ingrediente ya está listado.');
      return;
    }

    this.specsIngredients.push({
      name: val,
      price: 500
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
      container.innerHTML = `<p style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 10px 0;">No hay grupos de adicionales configurados.</p>`;
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
          <input type="text" value="${group.group_name}" onchange="AdminApp.updateGroupName('${group.group_id}', this.value)" placeholder="Nombre del grupo (ej. Salsas)" style="flex: 1; padding: 6px 10px; font-size: 12.5px; background: rgba(18,18,22,0.6); border: 1px solid rgba(255,255,255,0.08); color: #fff; border-radius: 8px;">
          
          <select onchange="AdminApp.updateGroupType('${group.group_id}', this.value)" style="background: rgba(18,18,22,0.6); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 6px; border-radius: 8px; font-size: 11.5px;">
            <option value="single" ${group.selection_type === 'single' ? 'selected' : ''}>Selección Única</option>
            <option value="multiple" ${group.selection_type === 'multiple' ? 'selected' : ''}>Selección Múltiple</option>
          </select>

          <label style="display: flex; align-items: center; gap: 4px; font-size: 11.5px; cursor: pointer; color: var(--text-muted); margin: 0;">
            <input type="checkbox" ${group.is_required ? 'checked' : ''} onchange="AdminApp.updateGroupRequired('${group.group_id}', this.checked)"> Oblig.
          </label>

          <button type="button" onclick="AdminApp.deleteModifierGroup('${group.group_id}')" style="background: none; border: none; color: #ef4444; font-size: 14px; cursor: pointer; padding: 0; width: auto; height: auto;">🗑️</button>
        </div>

        <div style="border-top: 1px dashed rgba(255,255,255,0.04); padding-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11.5px; color: var(--text-muted); font-weight: 700;">Opciones de Selección</span>
            <button type="button" class="btn-neumorphic" onclick="AdminApp.addOptionToGroup('${group.group_id}')" style="margin: 0; padding: 4px 8px; font-size: 10px; height: 24px;">➕ Opción</button>
          </div>
          <div id="options-list-${group.group_id}" style="display: flex; flex-direction: column; gap: 6px;">
            <!-- Rendered dynamically below -->
          </div>
        </div>
      `;

      const optList = gDiv.querySelector(`#options-list-${group.group_id}`);
      group.options.forEach((opt, oIdx) => {
        const oDiv = document.createElement('div');
        oDiv.style.display = 'flex';
        oDiv.style.gap = '8px';
        oDiv.style.alignItems = 'center';

        oDiv.innerHTML = `
          <input type="text" value="${opt.name}" onchange="AdminApp.updateOptionName('${group.group_id}', '${opt.option_id}', this.value)" placeholder="Opción" style="flex: 1; padding: 4px 8px; font-size: 11.5px; background: rgba(18,18,22,0.4); border: 1px solid rgba(255,255,255,0.05); color: #fff; border-radius: 6px;">
          <input type="number" value="${opt.price}" onchange="AdminApp.updateOptionPrice('${group.group_id}', '${opt.option_id}', this.value)" placeholder="Precio ($)" style="width: 80px; padding: 4px 8px; font-size: 11.5px; background: rgba(18,18,22,0.4); border: 1px solid rgba(255,255,255,0.05); color: #fff; border-radius: 6px;">
          <button type="button" onclick="AdminApp.deleteOptionFromGroup('${group.group_id}', '${opt.option_id}')" style="background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer; padding: 0; width: auto; height: auto;">✕</button>
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

    const est = this.establishments.find(e => e.id === window.activeShopIdForMenu);
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
        this.showToast('Uploading image...');
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
        this.showToast('✅ Especificaciones guardadas correctamente.');
        this.closeProductSpecsModal();
        if (typeof window.loadProducts === 'function') {
          await window.loadProducts();
        }
        if (typeof this.renderDailySpecialsTab === 'function') {
          this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
        }
        if (typeof this.renderModalProducts === 'function') {
          this.renderModalProducts();
        }
        this.markPendingChanges();
      } else {
        alert('Error al guardar especificaciones.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión.');
    }
  }

  markPendingChanges() {
    this.hasPendingChanges = true;
    this.updateSaveButtonState();
  }

  updateSaveButtonState() {
    const btnSave = document.getElementById('btn-cloud-save');
    if (!btnSave) return;
    if (this.hasPendingChanges) {
      btnSave.style.backgroundColor = '#10B981';
      btnSave.style.color = '#FFFFFF';
      btnSave.style.borderColor = '#10B981';
      btnSave.style.boxShadow = '0 0 14px rgba(16, 185, 129, 0.7)';
      btnSave.innerHTML = '🟢 💾 Guardar Cambios Pendientes';
    } else {
      btnSave.style.backgroundColor = '#374151';
      btnSave.style.color = '#9CA3AF';
      btnSave.style.borderColor = '#4B5563';
      btnSave.style.boxShadow = 'none';
      btnSave.innerHTML = '💾 Guardar Cambios';
    }
  }

  async loadLatestVersionFromCloud() {
    try {
      this.showToast('📥 Cargando la última versión desde la nube...');
      const res = await fetch('/api/owner/establishments');
      if (res.ok) {
        this.establishments = this.enforceVerifiedGps(await res.json());
        this.hasPendingChanges = false;
        this.updateSaveButtonState();
        await this.loadOrders();
        this.renderTable();
        try {
          if (this.globalMap) {
            this.initAdminGlobalStoresMap(this.currentGlobalMapFilter || 'all');
          }
        } catch(mErr) {
          console.warn('Map refresh warning on cloud reload:', mErr);
        }
        this.showToast('✅ Última versión cargada exitosamente.');
      } else {
        alert('Error al cargar la última versión desde el servidor.');
      }
    } catch (err) {
      console.error('Error loading latest version:', err);
      alert('Error al sincronizar la última versión: ' + (err.message || err));
    }
  }

  async saveChangesToCloud() {
    try {
      const btnSave = document.getElementById('btn-cloud-save');
      if (btnSave) btnSave.innerText = '⏳ Guardando en Nube...';
      await this.triggerCloudBackup();
      this.hasPendingChanges = false;
      this.updateSaveButtonState();
      this.showToast('✅ Cambios guardados en la nube con éxito.');
    } catch (err) {
      console.error('Error saving changes to cloud:', err);
      this.showToast('⚠️ Error al guardar los cambios en la nube.');
      this.updateSaveButtonState();
    }
  }

  async triggerCloudBackup() {
    try {
      console.log('☁️ Triggering manual cloud save via server...');
      const res = await fetch('/api/cloud/save', { method: 'POST' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('Cloud save failed:', errData.error || res.status);
        this.showToast('❌ Error al guardar el respaldo en la nube.');
      } else {
        console.log('🎉 Cloud save completed successfully!');
      }
    } catch (err) {
      console.error('Error during cloud backup:', err);
      throw err;
    }
  }

  async loadCentralSedeSettings() {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const settings = await res.json();
        const nameInp = document.getElementById('admin-central-sede-name');
        const latInp = document.getElementById('admin-central-sede-lat');
        const lngInp = document.getElementById('admin-central-sede-lng');
        if (nameInp) nameInp.value = settings.central_delivery_name || '';
        if (latInp) latInp.value = (settings.central_delivery_lat !== null && settings.central_delivery_lat !== undefined) ? settings.central_delivery_lat : '';
        if (lngInp) lngInp.value = (settings.central_delivery_lng !== null && settings.central_delivery_lng !== undefined) ? settings.central_delivery_lng : '';
      }
    } catch (err) {
      console.warn('Could not load central sede settings:', err);
    }
  }

  toggleSedeCardCollapse() {
    const body = document.getElementById('admin-sede-card-body');
    const chevron = document.getElementById('sede-card-chevron');
    if (!body) return;

    if (body.style.display === 'none') {
      body.style.display = 'block';
      if (chevron) chevron.style.transform = 'rotate(0deg)';
    } else {
      body.style.display = 'none';
      if (chevron) chevron.style.transform = 'rotate(-90deg)';
    }
  }

  toggleSedeMap() {
    const container = document.getElementById('admin-sede-map-container');
    if (!container) return;

    if (container.classList.contains('hidden')) {
      container.classList.remove('hidden');
      setTimeout(() => {
        this.initSedeMap();
      }, 150);
    } else {
      container.classList.add('hidden');
    }
  }

  initSedeMap() {
    if (typeof L === 'undefined') return;

    const latVal = parseFloat(document.getElementById('admin-central-sede-lat').value) || 7.8131;
    const lngVal = parseFloat(document.getElementById('admin-central-sede-lng').value) || -72.4439;
    const center = [latVal, lngVal];

    if (this.sedeMap) {
      this.sedeMap.setView(center, 15);
      this.sedeMap.invalidateSize();
      if (this.sedeMarker) this.sedeMarker.setLatLng(center);
      return;
    }

    this.sedeMap = L.map('admin-sede-leaflet-map').setView(center, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(this.sedeMap);

    const greenSedeIcon = L.divIcon({
      className: 'custom-sede-marker',
      html: `<div style="background-color: #8B5CF6; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 4px 10px rgba(139, 92, 246, 0.4); border: 2px solid white;">🏛️</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    this.sedeMarker = L.marker(center, { icon: greenSedeIcon, draggable: true }).addTo(this.sedeMap);

    this.sedeMarker.on('dragend', () => {
      const pos = this.sedeMarker.getLatLng();
      document.getElementById('admin-central-sede-lat').value = pos.lat.toFixed(6);
      document.getElementById('admin-central-sede-lng').value = pos.lng.toFixed(6);
    });

    this.sedeMap.on('click', (e) => {
      this.sedeMarker.setLatLng(e.latlng);
      document.getElementById('admin-central-sede-lat').value = e.latlng.lat.toFixed(6);
      document.getElementById('admin-central-sede-lng').value = e.latlng.lng.toFixed(6);
    });
  }

  checkStoreGPSStatus(est) {
    const banner = document.getElementById('store-gps-warning-banner');
    if (!banner) return;
    if (!est || !est.latitude || !est.longitude || isNaN(parseFloat(est.latitude)) || isNaN(parseFloat(est.longitude))) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  captureCurrentStoreGPS() {
    if (!this.activeShopId) {
      alert('Por favor selecciona un restaurante primero.');
      return;
    }
    const est = this.establishments.find(e => e.id === this.activeShopId);
    if (!est) return;

    const btn = document.getElementById('btn-capture-store-gps');
    if (btn) { btn.disabled = true; btn.innerText = '📡 Obteniendo GPS...'; }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          est.latitude = lat;
          est.longitude = lng;
          est.location_lat = lat;
          est.location_lng = lng;

          try {
            localStorage.setItem('store_gps_' + est.id, JSON.stringify({ latitude: lat, longitude: lng }));
          } catch(e) {}

          try {
            await fetch(`/api/establishments/${est.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                latitude: lat,
                longitude: lng,
                location_lat: lat,
                location_lng: lng
              })
            });
            this.showToast(`✅ Ubicación GPS de ${est.name} registrada (${lat.toFixed(4)}, ${lng.toFixed(4)})`);

            // Hide warning notification banner automatically
            const banner = document.getElementById('store-gps-warning-banner');
            if (banner) banner.classList.add('hidden');
          } catch(err) {
            console.error(err);
            alert('Error guardando la ubicación GPS en el servidor.');
          } finally {
            if (btn) { btn.disabled = false; btn.innerText = '📡 Capturar GPS / Registrar Ubicación del Local'; }
          }
        },
        (err) => {
          console.error(err);
          alert('No se pudo acceder al GPS. Asegúrate de permitir el acceso a la ubicación en tu navegador.');
          if (btn) { btn.disabled = false; btn.innerText = '📡 Capturar GPS / Registrar Ubicación del Local'; }
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      alert('Tu navegador no soporta Geolocalización GPS.');
      if (btn) { btn.disabled = false; btn.innerText = '📡 Capturar GPS / Registrar Ubicación del Local'; }
    }
  }

  async toggleDisableEstablishment(id) {
    const est = this.establishments.find(e => e.id === id);
    if (!est) return;

    const newDisabledState = !est.disabled;
    const actionName = newDisabledState ? 'DESHABILITAR' : 'HABILITAR';

    if (!confirm(`¿Estás seguro de que deseas ${actionName} el comercio "${est.name}"?\n\n${newDisabledState ? 'El comercio quedará oculto en el Marketplace para los clientes.' : 'El comercio volverá a ser visible en el Marketplace.'}`)) {
      return;
    }

    try {
      const res = await fetch(`/api/establishments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOwner: true, disabled: newDisabledState })
      });

      if (res.ok) {
        est.disabled = newDisabledState;
        // DO NOT cache in localStorage - server is the authoritative source for disabled state
        this.showToast(`✅ Comercio "${est.name}" ${newDisabledState ? 'deshabilitado' : 'habilitado'} con éxito.`);
        this.closeEstActionModal();
        await this.reloadData();
        this.markPendingChanges();
      } else {
        alert('Error al cambiar el estado del comercio.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al actualizar el estado del comercio.');
    }
  }

  toggleActiveShopDisable() {
    if (this.activeShopId) {
      this.toggleDisableEstablishment(this.activeShopId);
    }
  }

  getTimeAgoStr(date) {
    if (!date || isNaN(date.getTime())) return 'Hace poco';
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Hace un instante';
    if (diffMins < 60) return `Hace ${diffMins} min`;
    if (diffHours < 24) return `Hace ${diffHours}h ${diffMins % 60}m`;
    return `Hace ${diffDays}d (${date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })})`;
  }

  async loadAdminMasterCatalogTable() {
    const tbody = document.getElementById('admin-master-catalog-tbody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">Cargando catálogo maestro...</td></tr>`;

    try {
      if (typeof MenuBuilder !== 'undefined' && MenuBuilder.supabase) {
        const { data, error } = await MenuBuilder.supabase
          .from('products')
          .select('*')
          .order('name', { ascending: true });

        if (error) throw error;
        this.masterProductsCache = data || [];
        this.renderAdminMasterCatalogTable(this.masterProductsCache);
      }
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: #f87171;">Error al cargar el catálogo maestro: ${err.message}</td></tr>`;
    }
  }

  renderAdminMasterCatalogTable(products) {
    const tbody = document.getElementById('admin-master-catalog-tbody');
    if (!tbody) return;

    if (!products || products.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No hay productos en el catálogo maestro.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    products.forEach(prod => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border)';
      
      const imgUrl = prod.image_url || prod.image || '/images/burger_royale.jpg';
      const rawPrice = parseFloat(prod.price) || 0;
      const copPrice = rawPrice < 1000 ? rawPrice * 1000 : rawPrice;
      const formattedPrice = `$${Math.round(copPrice).toLocaleString('de-DE')} COP`;

      tr.innerHTML = `
        <td style="padding: 10px 14px;">
          <img src="${imgUrl}" alt="${prod.name}" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border);" onerror="this.src='/images/burger_royale.jpg'">
        </td>
        <td style="padding: 10px 14px; font-weight: 700; color: #0F172A;">
          ${prod.name}
        </td>
        <td style="padding: 10px 14px;">
          <span style="background: #F1F5F9; color: var(--primary); padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 11px;">${prod.category || 'General'}</span>
        </td>
        <td style="padding: 10px 14px; font-size: 12px; color: var(--text-muted); max-width: 250px;">
          ${prod.description || 'Sin descripción especificada.'}
        </td>
        <td style="padding: 10px 14px; font-weight: 800; color: #10B981;">
          ${formattedPrice}
        </td>
        <td style="padding: 10px 14px; text-align: center;">
          <button onclick="AdminApp.deleteMasterProduct('${prod.id}')" style="background: #EF4444; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 800; cursor: pointer; transition: all 0.2s;" title="Eliminar del catálogo maestro global">
            🗑️ Eliminar
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  filterMasterCatalogTable() {
    const input = document.getElementById('admin-master-catalog-search');
    if (!input || !this.masterProductsCache) return;
    const query = input.value.toLowerCase().trim();

    const filtered = this.masterProductsCache.filter(p => 
      p.name.toLowerCase().includes(query) || 
      (p.category && p.category.toLowerCase().includes(query)) ||
      (p.description && p.description.toLowerCase().includes(query))
    );

    this.renderAdminMasterCatalogTable(filtered);
  }

  openCreateMasterProductModal() {
    const modal = document.getElementById('admin-create-master-product-modal');
    if (modal) modal.classList.add('active');
    this.checkModalOpenState();
  }

  closeCreateMasterProductModal() {
    const modal = document.getElementById('admin-create-master-product-modal');
    if (modal) modal.classList.remove('active');
    this.checkModalOpenState();
  }

  async handleCreateMasterProductSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('master-prod-name').value.trim();
    const category = document.getElementById('master-prod-category').value.trim();
    const rawPrice = parseFloat(document.getElementById('master-prod-price').value);
    const description = document.getElementById('master-prod-desc').value.trim();
    const fileInput = document.getElementById('master-prod-image-file');

    if (!name || !category || isNaN(rawPrice)) {
      alert('Completa los campos obligatorios (*)');
      return;
    }

    const price = rawPrice < 1000 ? rawPrice * 1000 : rawPrice;
    let imageUrl = '/images/burger_royale.jpg';

    const submitBtn = document.getElementById('btn-submit-create-master-prod');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Guardando...';

    try {
      if (fileInput && fileInput.files && fileInput.files[0]) {
        if (typeof MenuBuilder !== 'undefined' && MenuBuilder.uploadProductImage) {
          imageUrl = await MenuBuilder.uploadProductImage(fileInput.files[0]);
        }
      }

      if (typeof MenuBuilder !== 'undefined' && MenuBuilder.supabase) {
        const newProduct = {
          name,
          category,
          price,
          description,
          image_url: imageUrl
        };

        const { error } = await MenuBuilder.supabase
          .from('products')
          .insert([newProduct]);

        if (error) throw error;

        this.showToast(`✅ "${name}" creado con éxito en el catálogo maestro.`);
        this.closeCreateMasterProductModal();
        await this.loadAdminMasterCatalogTable();
      }
    } catch (err) {
      console.error(err);
      alert('Error al crear el producto maestro: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = '💾 Guardar Producto Maestro';
    }
  }

  async deleteMasterProduct(prodId) {
    if (!prodId) return;
    const item = (this.masterProductsCache || []).find(p => p.id === prodId);
    const itemName = item ? item.name : 'este producto';

    if (!confirm(`⚠️ ¿Estás seguro de eliminar permanentemente "${itemName}" del catálogo maestro global?\n\nEsta acción no se puede deshacer.`)) {
      return;
    }

    try {
      if (typeof MenuBuilder !== 'undefined' && MenuBuilder.supabase) {
        const { error } = await MenuBuilder.supabase
          .from('products')
          .delete()
          .eq('id', prodId);

        if (error) throw error;

        this.showToast(`🗑️ "${itemName}" eliminado del catálogo maestro.`);
        await this.loadAdminMasterCatalogTable();
      }
    } catch (err) {
      console.error(err);
      alert('Error al eliminar producto: ' + err.message);
    }
  }

  renderAnalyticsPro() {
    const totalSalesUsdEl = document.getElementById('pro-kpi-sales-usd');
    const totalSalesCopEl = document.getElementById('pro-kpi-sales-cop');
    const totalOrdersEl = document.getElementById('pro-kpi-total-orders');
    const avgTicketEl = document.getElementById('pro-kpi-avg-ticket');
    const topProductsListEl = document.getElementById('pro-top-products-list');
    const salesChartContainerEl = document.getElementById('pro-sales-chart-container');

    if (!totalSalesUsdEl) return;

    let totalUsd = 0;
    let totalCop = 0;
    let totalOrderCount = this.orders ? this.orders.length : 0;
    const productSalesMap = {};

    if (this.orders && Array.isArray(this.orders) && this.orders.length > 0) {
      this.orders.forEach(ord => {
        const orderTotalCop = ord.total || 0;
        totalCop += orderTotalCop;
        const estUsd = orderTotalCop / 4000;
        totalUsd += estUsd;

        if (ord.items && Array.isArray(ord.items)) {
          ord.items.forEach(item => {
            const pName = item.name || item.product_name || 'Producto';
            productSalesMap[pName] = (productSalesMap[pName] || 0) + (item.quantity || 1);
          });
        }
      });
    } else {
      // Sample calculation from establishments for demo
      let prodCount = 0;
      (this.establishments || []).forEach(e => {
        (e.products || []).forEach(p => {
          prodCount++;
          const pName = p.name || 'Producto';
          productSalesMap[pName] = Math.floor(Math.random() * 25) + 5;
        });
      });
      totalOrderCount = Math.max(14, prodCount * 2);
      totalUsd = totalOrderCount * 14.5;
      totalCop = totalUsd * 4000;
    }

    const avgTicket = totalOrderCount > 0 ? (totalUsd / totalOrderCount) : 0;

    totalSalesUsdEl.innerText = `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    totalSalesCopEl.innerText = `${Math.round(totalCop).toLocaleString()} COP`;
    totalOrdersEl.innerText = totalOrderCount.toString();
    avgTicketEl.innerText = `$${avgTicket.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Top Products List
    if (topProductsListEl) {
      topProductsListEl.innerHTML = '';
      const sortedProds = Object.entries(productSalesMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      if (sortedProds.length === 0) {
        topProductsListEl.innerHTML = '<div style="font-size: 11px; color: #94A3B8;">No hay ventas registradas aún.</div>';
      } else {
        const maxVal = sortedProds[0][1] || 1;
        sortedProds.forEach(([name, count], idx) => {
          const pct = Math.round((count / maxVal) * 100);
          const row = document.createElement('div');
          row.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
          row.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; color: #fff;">
              <span>${idx + 1}. ${name}</span>
              <span style="color: #F59E0B;">${count} u.</span>
            </div>
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
              <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #F59E0B, #D97706); border-radius: 3px;"></div>
            </div>
          `;
          topProductsListEl.appendChild(row);
        });
      }
    }

    // Weekly Sales Bar Chart
    if (salesChartContainerEl) {
      salesChartContainerEl.innerHTML = '';
      const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
      const sampleDaysSales = [140, 210, 180, 290, 360, 480, 410];
      const maxSale = Math.max(...sampleDaysSales);

      days.forEach((day, idx) => {
        const val = sampleDaysSales[idx];
        const hPct = Math.round((val / maxSale) * 100);
        const col = document.createElement('div');
        col.style.cssText = 'flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end;';
        col.innerHTML = `
          <span style="font-size: 9px; color: #10B981; font-weight: 800;">$${val}</span>
          <div style="width: 100%; height: ${hPct}%; background: linear-gradient(180deg, #F59E0B 0%, #D97706 100%); border-radius: 4px 4px 0 0;" title="${day}: $${val}"></div>
          <span style="font-size: 10px; color: #94A3B8; font-weight: 700;">${day}</span>
        `;
        salesChartContainerEl.appendChild(col);
      });
    }
  }

  exportExecutiveReport() {
    this.showToast('📄 Generando Reporte Ejecutivo Analytics Pro ($10/mes)...');
    setTimeout(() => {
      alert('📄 REPORTE EJECUTIVO ANALYTICS PRO ($10/MES)\n\n' +
            '• Estado del Plan: ACTIVO ($10/mes)\n' +
            '• Ventas Totales: ' + (document.getElementById('pro-kpi-sales-usd')?.innerText || '$0.00') + '\n' +
            '• Pedidos Totales: ' + (document.getElementById('pro-kpi-total-orders')?.innerText || '0') + '\n' +
            '• Ticket Promedio: ' + (document.getElementById('pro-kpi-avg-ticket')?.innerText || '$0.00') + '\n' +
            '• Hora Pico: 7:00 PM - 9:30 PM\n\n' +
            '¡Reporte generado con éxito!');
    }, 600);
  }

  showToast(message, isError = false) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, isError);
    } else {
      const toast = document.getElementById('toast');
      if (toast) {
        toast.innerText = message;
        toast.classList.remove('hidden');
        toast.classList.add('show');
        setTimeout(() => {
          toast.classList.remove('show');
          toast.classList.add('hidden');
        }, 3000);
      }
    }
  }

  openAllStoresMapModal() {
    const modal = document.getElementById('admin-all-stores-map-modal');
    if (!modal) return;
    modal.classList.add('active');
    this.checkModalOpenState();

    setTimeout(() => {
      this.initAdminGlobalStoresMap();
    }, 250);
  }

  closeAllStoresMapModal() {
    const modal = document.getElementById('admin-all-stores-map-modal');
    if (modal) modal.classList.remove('active');
    this.checkModalOpenState();
  }

  openStoreMapSingle(estId) {
    const est = (this.establishments || []).find(e => String(e.id) === String(estId));
    if (!est) return;

    const modal = document.getElementById('admin-all-stores-map-modal');
    if (!modal) return;
    modal.classList.add('active');
    this.checkModalOpenState();

    setTimeout(() => {
      this.initAdminGlobalStoresMap(this.currentGlobalMapFilter || 'all', est.id);
      setTimeout(() => {
        if (this.globalMap) {
          const item = (this.globalMapMarkers || []).find(m => String(m.estId) === String(est.id));
          if (item && item.marker) {
            const latLng = item.marker.getLatLng();
            const hasGPS = Boolean(est.latitude && est.longitude);
            this.globalMap.setView(latLng, hasGPS ? 16 : 14);
            item.marker.openPopup();
          }
        }
      }, 200);
    }, 250);
  }

  async saveStoreGPS(estId) {
    const item = (this.globalMapMarkers || []).find(m => String(m.estId) === String(estId));
    const est = (this.establishments || []).find(e => String(e.id) === String(estId));
    if (!item || !item.marker || !est) return;

    const pos = item.marker.getLatLng();
    const newLat = parseFloat(pos.lat.toFixed(6));
    const newLng = parseFloat(pos.lng.toFixed(6));

    est.latitude = newLat;
    est.longitude = newLng;
    est.location_lat = newLat;
    est.location_lng = newLng;

    try {
      localStorage.setItem('store_gps_' + est.id, JSON.stringify({ latitude: newLat, longitude: newLng }));
    } catch(e) {}

    this.showToast(`📡 Guardando nueva posición GPS de "${est.name}"...`);

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          latitude: newLat,
          longitude: newLng,
          location_lat: newLat,
          location_lng: newLng
        })
      });

      if (res.ok) {
        this.showToast(`✅ ¡Ubicación de "${est.name}" guardada (${newLat.toFixed(4)}, ${newLng.toFixed(4)})!`);
        this.renderTable();
        this.markPendingChanges();
        this.initAdminGlobalStoresMap(this.currentGlobalMapFilter || 'all', est.id, [newLat, newLng]);
        this.triggerCloudBackup();
      } else {
        this.showToast('⚠️ Error al guardar la ubicación en el servidor.');
      }
    } catch(err) {
      console.error('Error saving moved store position:', err);
      this.showToast('⚠️ Error de conexión al actualizar posición GPS.');
    }
  }

  async removeStoreGPS(estId) {
    const est = (this.establishments || []).find(e => String(e.id) === String(estId));
    if (!est) return;

    const confirmDelete = confirm(`¿Estás seguro de quitar el marcador GPS de "${est.name}" del mapa?\n\n(El restaurante, sus productos y su menú permanecerán intactos sin ningún cambio).`);
    if (!confirmDelete) return;

    est.latitude = null;
    est.longitude = null;
    est.location_lat = null;
    est.location_lng = null;

    try {
      localStorage.removeItem('store_gps_' + est.id);
    } catch(e) {}

    this.showToast(`🗑️ Eliminando marcador GPS de "${est.name}"...`);

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          latitude: null,
          longitude: null,
          location_lat: null,
          location_lng: null
        })
      });

      if (res.ok) {
        this.showToast(`🗑️ Marcador de "${est.name}" eliminado del mapa (restaurante intacto).`);
        this.markPendingChanges();
        this.initAdminGlobalStoresMap(this.currentGlobalMapFilter || 'all');
      } else {
        this.showToast('⚠️ Error al eliminar el marcador en el servidor.');
      }
    } catch(err) {
      console.error('Error removing store GPS position:', err);
      this.showToast('⚠️ Error de conexión al eliminar el marcador GPS.');
    }
  }

  initAdminGlobalStoresMap(filterLoc = 'all', pendingEstId = null, keepCenter = null) {
    this.currentGlobalMapFilter = filterLoc;
    const container = document.getElementById('admin-global-stores-map');
    if (!container || typeof L === 'undefined') return;

    this.enforceVerifiedGps(this.establishments);

    if (this.globalMap) {
      try { this.globalMap.remove(); } catch(e) {}
      this.globalMap = null;
    }
    this.globalMapMarkers = [];

    let centerLat = 7.8145;
    let centerLng = -72.4430;

    let targetEsts = this.establishments || [];
    if (filterLoc !== 'all') {
      targetEsts = targetEsts.filter(e => (e.location || 'San Antonio').toLowerCase().includes(filterLoc.toLowerCase()));
    }

    // Filter targetEsts strictly by unique ID to ensure every store gets its own exact marker
    const seenEstIds = new Set();
    const uniqueTargetEsts = [];

    (targetEsts || []).forEach(est => {
      if (!est || !est.id) return;
      const sId = String(est.id).trim();
      if (!seenEstIds.has(sId)) {
        seenEstIds.add(sId);
        uniqueTargetEsts.push(est);
      }
    });

    targetEsts = uniqueTargetEsts;

    // All stores have guaranteed verified GPS
    const estsToRender = targetEsts;
    const estsWithGPS = targetEsts.filter(e => e.latitude && e.longitude);

    if (estsWithGPS.length > 0) {
      centerLat = estsWithGPS[0].latitude;
      centerLng = estsWithGPS[0].longitude;
    }

    const map = L.map('admin-global-stores-map').setView([centerLat, centerLng], 14);
    this.globalMap = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    setTimeout(() => { if (this.globalMap) this.globalMap.invalidateSize(); }, 150);
    setTimeout(() => { if (this.globalMap) this.globalMap.invalidateSize(); }, 400);
    setTimeout(() => { if (this.globalMap) this.globalMap.invalidateSize(); }, 800);

    const statsText = document.getElementById('admin-map-stats-text');
    if (statsText) {
      statsText.innerHTML = `<span>📡</span> <span>Locales con GPS Registrado: <strong>${estsWithGPS.length}</strong> / <strong>${targetEsts.length}</strong> Comercios</span>`;
    }

    const bounds = L.latLngBounds();

    targetEsts.forEach((est) => {
      const hasSavedGPS = Boolean(est.latitude && est.longitude);
      let lat = hasSavedGPS ? parseFloat(est.latitude) : centerLat;
      let lng = hasSavedGPS ? parseFloat(est.longitude) : centerLng;

      bounds.extend([lat, lng]);

      const emojiIcon = L.divIcon({
        className: 'custom-admin-store-pin',
        html: `
          <div style="background: ${hasSavedGPS ? (est.disabled ? '#EF4444' : '#10B981') : '#F59E0B'}; color: #FFF; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border: 2px solid #FFFFFF;">
            ${est.logo || '🏪'}
          </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19]
      });

      const buildPopupHTML = (e, currentLat, currentLng) => {
        const gmapsLink = `https://www.google.com/maps/search/?api=1&query=${currentLat},${currentLng}`;
        const isSet = Boolean(e.latitude && e.longitude);
        return `
          <div style="min-width: 220px; padding: 4px; font-family: system-ui, -apple-system, sans-serif;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span style="font-size: 24px;">${e.logo || '🏪'}</span>
              <div>
                <strong style="font-size: 14px; color: #0F172A; display: block;">${e.name}</strong>
                <span style="font-size: 11px; color: #64748B;">📍 ${e.location || 'San Antonio'}</span>
              </div>
            </div>
            <div style="margin-bottom: 8px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
              <span style="background: ${e.disabled ? '#FEE2E2' : '#D1FAE5'}; color: ${e.disabled ? '#991B1B' : '#065F46'}; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 10px;">
                ${e.disabled ? '🚫 DESHABILITADO' : '🟢 HABILITADO'}
              </span>
              ${isSet ? '<span style="background: #DBEAFE; color: #1E40AF; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 10px;">📡 GPS FIJADO</span>' : '<span style="background: #FEF3C7; color: #92400E; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 10px;">⚠️ ARRASTRA Y GUARDA</span>'}
            </div>
            <p style="font-size: 10.5px; color: #475569; margin: 4px 0 8px 0; line-height: 1.3; background: #F1F5F9; padding: 6px; border-radius: 6px;">
              📌 Arrastra este pin a la ubicación deseada y presiona el botón verde para guardar.
            </p>
            <button onclick="AdminApp.saveStoreGPS('${e.id}')" style="display: block; width: 100%; text-align: center; background: #10B981; color: #FFFFFF; font-weight: 800; font-size: 11px; padding: 7px 10px; border-radius: 8px; border: none; cursor: pointer; margin-bottom: 6px; box-shadow: 0 2px 6px rgba(16,185,129,0.3); box-sizing: border-box;">
              💾 Guardar Ubicación GPS
            </button>
            ${isSet ? `
            <button onclick="AdminApp.removeStoreGPS('${e.id}')" style="display: block; width: 100%; text-align: center; background: rgba(239, 68, 68, 0.1); color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); font-weight: 800; font-size: 11px; padding: 6px 10px; border-radius: 8px; cursor: pointer; margin-bottom: 6px; box-sizing: border-box;">
              🗑️ Quitar Marcador del Mapa
            </button>
            ` : ''}
            <a href="${gmapsLink}" target="_blank" style="display: block; width: 100%; text-align: center; background: #2563EB; color: #FFFFFF; font-weight: 800; font-size: 11px; padding: 6px 10px; border-radius: 8px; text-decoration: none; box-shadow: 0 2px 6px rgba(37,99,235,0.3); box-sizing: border-box;">
              📍 Abrir en Google Maps
            </a>
          </div>
        `;
      };

      const marker = L.marker([lat, lng], { icon: emojiIcon, draggable: true }).addTo(map);
      marker.bindPopup(buildPopupHTML(est, lat, lng));

      marker.bindTooltip(`<b>${est.name}</b>`, {
        permanent: true,
        direction: 'top',
        className: 'admin-map-pin-label',
        offset: [0, -20]
      });

      marker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        const newLat = parseFloat(pos.lat.toFixed(6));
        const newLng = parseFloat(pos.lng.toFixed(6));

        marker.setPopupContent(buildPopupHTML(est, newLat, newLng));
        marker.openPopup();
        this.showToast(`📌 Pin movido. Presiona "💾 Guardar Ubicación GPS" en la burbuja para confirmar.`);
      });

      this.globalMapMarkers.push({ estId: est.id, marker });
    });

    const selectEl = document.getElementById('admin-map-store-select');
    if (selectEl) {
      selectEl.innerHTML = '<option value="">🔍 Centrar Restaurante...</option>';
      targetEsts.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = `${e.logo || '🏪'} ${e.name}`;
        selectEl.appendChild(opt);
      });
    }

    try {
      if (keepCenter && Array.isArray(keepCenter) && keepCenter.length === 2) {
        map.setView(keepCenter, 16);
      } else if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      } else {
        map.setView([centerLat, centerLng], 14);
      }
    } catch(e) {
      console.warn('Map fitBounds warning:', e);
      map.setView([centerLat, centerLng], 14);
    }

    if (pendingEstId) {
      setTimeout(() => {
        const item = (this.globalMapMarkers || []).find(m => String(m.estId) === String(pendingEstId));
        if (item && item.marker) {
          item.marker.openPopup();
        }
      }, 250);
    }
  }

  focusStoreOnMap(estId) {
    if (!estId) return;
    const item = (this.globalMapMarkers || []).find(m => String(m.estId) === String(estId));
    if (item && item.marker && this.globalMap) {
      const latLng = item.marker.getLatLng();
      this.globalMap.setView(latLng, 16, { animate: true });
      item.marker.openPopup();
    }
  }

  async clearAllStoreGPS() {
    if (!confirm('⚠️ ¿Estás seguro de BORRAR todas las ubicaciones guardadas de todos los restaurantes?\n\nPodrás volver a colocar y guardar cada pin en el mapa libremente desde cero.')) return;

    this.showToast('🗑️ Borrando todas las ubicaciones GPS...');

    try {
      for (const est of this.establishments) {
        est.latitude = null;
        est.longitude = null;
        est.location_lat = null;
        est.location_lng = null;
        try { localStorage.removeItem('store_gps_' + est.id); } catch(e) {}
        await fetch(`/api/establishments/${est.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isOwner: true,
            latitude: null,
            longitude: null,
            location_lat: null,
            location_lng: null
          })
        });
      }

      this.showToast('✅ ¡Todas las ubicaciones han sido borradas! Ahora puedes posicionar los pines libremente.');
      this.renderTable();
      this.initAdminGlobalStoresMap(this.currentGlobalMapFilter || 'all');
      this.triggerCloudBackup();
    } catch(err) {
      console.error(err);
      this.showToast('⚠️ Error al borrar ubicaciones.');
    }
  }

  filterGlobalMapLocation(loc) {
    this.initAdminGlobalStoresMap(loc);
  }

  initEditShopGPSMap(est) {
    const container = document.getElementById('edit-shop-gps-map');
    if (!container || typeof L === 'undefined') return;

    if (this.editShopMap) {
      try { this.editShopMap.remove(); } catch(e) {}
      this.editShopMap = null;
    }

    let lat = (est.latitude && !isNaN(parseFloat(est.latitude))) ? parseFloat(est.latitude) : 7.8145;
    let lng = (est.longitude && !isNaN(parseFloat(est.longitude))) ? parseFloat(est.longitude) : -72.4430;

    const latInp = document.getElementById('edit-shop-latitude');
    const lngInp = document.getElementById('edit-shop-longitude');
    if (latInp) latInp.value = lat.toFixed(6);
    if (lngInp) lngInp.value = lng.toFixed(6);

    const map = L.map('edit-shop-gps-map').setView([lat, lng], 15);
    this.editShopMap = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    setTimeout(() => { if (this.editShopMap) this.editShopMap.invalidateSize(); }, 150);
    setTimeout(() => { if (this.editShopMap) this.editShopMap.invalidateSize(); }, 400);

    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    this.editShopMarker = marker;

    const updateInputs = (newLat, newLng) => {
      if (latInp) latInp.value = newLat.toFixed(6);
      if (lngInp) lngInp.value = newLng.toFixed(6);
    };

    marker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      updateInputs(pos.lat, pos.lng);
    });

    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      updateInputs(e.latlng.lat, e.latlng.lng);
    });
  }

  getCurrentLocationForEditShop() {
    if ('geolocation' in navigator) {
      this.showToast('📡 Capturando ubicación GPS actual...');
      navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const latInp = document.getElementById('edit-shop-latitude');
        const lngInp = document.getElementById('edit-shop-longitude');
        if (latInp) latInp.value = lat.toFixed(6);
        if (lngInp) lngInp.value = lng.toFixed(6);

        if (this.editShopMap && this.editShopMarker) {
          this.editShopMap.setView([lat, lng], 17);
          this.editShopMarker.setLatLng([lat, lng]);
        }
        this.showToast('✅ Ubicación GPS capturada exitosamente.');
      }, (err) => {
        alert('⚠️ No se pudo obtener la ubicación GPS automática. Por favor activa el GPS o selecciona en el mapa.');
      }, { enableHighAccuracy: true });
    } else {
      alert('Tu navegador no soporta geolocalización GPS.');
    }
  }

  initWebSocket() {
    if (this.ws) {
      try { this.ws.close(); } catch(e) {}
    }

    const isNative = window.location.origin.includes('localhost') || window.location.origin.includes('capacitor');
    const wsUrl = isNative 
      ? 'wss://pedigochos.onrender.com' 
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    
    console.log('👑 Admin Owner App connecting to WebSocket:', wsUrl);
    this.ws = new WebSocket(wsUrl);

    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 10000);

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'PONG') return;

        if (data.type === 'GLOBAL_NEW_ORDER' || data.type === 'NEW_ORDER') {
          const order = data.order;
          if (!order) return;

          const exists = this.orders.some(o => o.id === order.id);
          if (!exists) {
            this.orders.push(order);
          } else {
            const idx = this.orders.findIndex(o => o.id === order.id);
            if (idx !== -1) this.orders[idx] = order;
          }

          this.renderTable();
          this.playOrderNotification(order);
        }
      } catch (err) {
        console.error('Error parsing WS message in admin:', err);
      }
    };

    this.ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      console.log('👑 [Admin WS] Conexión cerrada. Reconectando en 2.5s...');
      setTimeout(() => this.initWebSocket(), 2500);
    };
  }

  requestNotificationPermission(silent = true) {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
      try {
        window.Capacitor.Plugins.LocalNotifications.requestPermissions().then(result => {
          if (result.display === 'granted' && !silent) {
            this.showToast('🔔 Notificaciones nativas activadas');
          }
        }).catch(() => {});
      } catch(e) {}
      return;
    }

    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        if (!silent) this.showToast('🔔 Notificaciones de escritorio ya están activadas.');
      } else if (Notification.permission === 'denied') {
        if (!silent) alert('⚠️ Las notificaciones están bloqueadas en tu navegador.\n\nPara activarlas: haz clic en el icono del candado 🔒 junto a la URL en tu navegador y activa la casilla "Notificaciones".');
      } else {
        try {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted' && !silent) {
              this.showToast('✅ ¡Notificaciones de escritorio activadas exitosamente!');
            }
          }).catch(() => {});
        } catch(e) {}
      }
    } else {
      console.log('📱 Entorno nativo/móvil detectado: notificaciones gestionadas por el sistema Android.');
    }
  }

  playOrderNotification(order) {
    // 1. Play persistent scandalous audio alarm for 20 seconds
    if (typeof Sound !== 'undefined') {
      Sound.startPersistentOrderAlarm(20);
    }

    const est = this.establishments.find(e => e.id === order.establishmentId || e.id === order.establishment_id);
    const storeName = est ? est.name : 'Restaurante';
    const customerName = order.customerName || order.deliveryDetails?.name || 'Cliente';
    const orderCode = order.deliveryDetails?.code || (order.id ? order.id.slice(-4) : '####');
    const orderTotal = order.total !== undefined ? `$${parseFloat(order.total).toFixed(2)}` : '';
    const orderType = order.orderType === 'mesa' ? '🍽️ Mesa ' + (order.mesaNumber || order.deliveryDetails?.mesa || '') : '🚴 Delivery';

    const estId = order.establishmentId || order.establishment_id || '';

    // Show top flashing persistent alarm banner with direct store linkage
    this.showAlarmBanner(orderCode, storeName, estId, order.id);

    // 2. Native OS Push Notification (Capacitor or Web)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
      try {
        window.Capacitor.Plugins.LocalNotifications.schedule({
          notifications: [
            {
              title: `🚨 ¡NUEVO PEDIDO RECIBIDO! #${orderCode}`,
              body: `🏪 ${storeName}\n👤 ${customerName} (${orderType})\n💰 Total: ${orderTotal}`,
              id: Math.floor(Math.random() * 1000000),
              schedule: { at: new Date(Date.now() + 100) },
              sound: 'alarm.wav',
              channelId: 'pedigochos_master_alerts',
              smallIcon: 'ic_launcher_foreground',
              extra: {
                establishmentId: estId,
                orderId: order.id,
                storeName: storeName
              }
            }
          ]
        });
      } catch(e) {
        console.warn('Capacitor notification schedule failed:', e);
      }
    } else if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification(`🚨 ¡NUEVO PEDIDO RECIBIDO! #${orderCode}`, {
          body: `🏪 ${storeName}\n👤 ${customerName} (${orderType})\n💰 Total: ${orderTotal}`,
          icon: '/icons/icon-192.png',
          tag: 'order-' + order.id,
          requireInteraction: true,
          data: { establishmentId: estId, orderId: order.id }
        });
        notif.onclick = () => {
          window.focus();
          if (estId) AdminApp.focusEstablishment(estId, order.id);
        };
      } catch(e) {}
    }

    // 3. Display High-Priority 3D Toast Alert in Admin UI
    this.showToast(`🚨 ¡NUEVO PEDIDO! #${orderCode} en ${storeName} - ${customerName} (${orderTotal})`);

    // 4. Show high-priority popup modal with all order details
    this.showNewOrderModal(order, storeName);
  }

  showNewOrderModal(order, storeName) {
    let modal = document.getElementById('admin-new-order-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'admin-new-order-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    const estId = order.establishmentId || order.establishment_id || '';
    const orderCode = order.deliveryDetails?.code || (order.id ? order.id.slice(-4) : '####');
    const customerName = order.customerName || order.deliveryDetails?.name || 'Cliente';
    const phone = order.customerPhone || order.deliveryDetails?.phone || 'Sin teléfono';
    const address = order.deliveryDetails?.address || order.deliveryDetails?.mesa || 'Sin dirección';
    const total = order.total !== undefined ? parseFloat(order.total).toFixed(2) : '0.00';
    const items = order.items || [];

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 460px; border-radius: 24px; border: 2px solid var(--primary); background: #111827; box-shadow: 0 0 35px rgba(255, 94, 58, 0.4); animation: scaleIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
        <div style="background: linear-gradient(135deg, #FF5E3A 0%, #FF2A00 100%); color: #FFF; padding: 18px 20px; border-radius: 22px 22px 0 0; text-align: center; position: relative;">
          <span style="font-size: 36px; display: block; margin-bottom: 4px;">🔔</span>
          <h3 style="margin: 0; font-size: 18px; font-weight: 800;">¡NUEVO PEDIDO RECIBIDO!</h3>
          <span style="background: rgba(0,0,0,0.25); padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 800;">Código #${orderCode}</span>
        </div>
        <div style="padding: 20px; color: #FFF;">
          <div style="background: rgba(255,255,255,0.05); border-radius: 14px; padding: 12px 16px; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.08);">
            <p style="margin: 0 0 6px 0; font-size: 15px; font-weight: 800; color: #FFD700;">🏪 ${storeName}</p>
            <p style="margin: 0 0 4px 0; font-size: 13px;">👤 <strong>Cliente:</strong> ${customerName}</p>
            <p style="margin: 0 0 4px 0; font-size: 13px;">📞 <strong>Teléfono:</strong> ${phone}</p>
            <p style="margin: 0 0 4px 0; font-size: 13px;">📍 <strong>Ubicación/Mesa:</strong> ${address}</p>
            ${(order.deliveryDetails?.latitude && order.deliveryDetails?.longitude) ? `<p style="margin: 0; font-size: 13px;">🗺️ <strong>GPS:</strong> <a href="https://maps.google.com/?q=${order.deliveryDetails.latitude},${order.deliveryDetails.longitude}" target="_blank" style="color: #38BDF8; font-weight: 700; text-decoration: underline;">Abrir en Google Maps</a></p>` : ''}
          </div>
          <div style="margin-bottom: 16px;">
            <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #CBD5E1;">📦 Productos Solicitados:</h4>
            <div style="max-height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;" class="premium-scroll">
              ${items.map(item => `
                <div style="display: flex; justify-content: space-between; font-size: 12.5px; background: rgba(255,255,255,0.04); padding: 7px 10px; border-radius: 8px;">
                  <span>${item.quantity || 1}x ${item.name}</span>
                  <strong style="color: var(--primary);">$${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</strong>
                </div>
              `).join('')}
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255, 94, 58, 0.15); border: 1px solid var(--primary); padding: 12px 16px; border-radius: 14px; margin-bottom: 16px;">
            <span style="font-size: 14px; font-weight: 700;">Total del Pedido:</span>
            <span style="font-size: 20px; font-weight: 800; color: #FFD700;">$${total}</span>
          </div>

          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <button type="button" onclick="if(window.Sound) Sound.stopAlarm(); AdminApp.hideAlarmBanner(); document.getElementById('admin-new-order-modal').style.display='none'; AdminApp.openEstActionModal('${estId}');" class="btn-primary" style="flex: 1; padding: 10px; font-size: 12px; font-weight: 800; border-radius: 10px; cursor: pointer; background: #3B82F6; border: none; color: #FFF;">
              📋 Administrar Comercio
            </button>
            <button type="button" onclick="if(window.Sound) Sound.stopAlarm(); AdminApp.hideAlarmBanner(); document.getElementById('admin-new-order-modal').style.display='none'; AdminApp.openStoreKitchen('${estId}');" class="btn-primary" style="flex: 1; padding: 10px; font-size: 12px; font-weight: 800; border-radius: 10px; cursor: pointer; background: #F59E0B; border: none; color: #1E293B;">
              🍳 Abrir Cocina (KDS)
            </button>
          </div>

          <button type="button" onclick="if(window.Sound) Sound.stopAlarm(); AdminApp.hideAlarmBanner(); document.getElementById('admin-new-order-modal').style.display='none';" class="btn-primary" style="width: 100%; padding: 11px; font-size: 13.5px; font-weight: 800; border-radius: 12px; cursor: pointer; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #FFF;">
            ✅ Cerrar Alerta
          </button>
        </div>
      </div>
    `;
    modal.style.display = 'flex';
  }

  openStoreQRModal(estId) {
    const est = (this.establishments || []).find(e => String(e.id) === String(estId));
    if (!est) return;

    this.currentQREst = est;
    const modal = document.getElementById('admin-store-qr-modal');
    if (!modal) return;

    const titleEl = document.getElementById('qr-modal-title');
    if (titleEl) titleEl.innerText = `📱 Display QR: ${est.name}`;
    
    const tableInp = document.getElementById('qr-modal-table-input');
    if (tableInp) tableInp.value = '';

    this.updateStoreQRDisplay();
    modal.classList.add('active');
    this.checkModalOpenState();
  }

  closeStoreQRModal() {
    const modal = document.getElementById('admin-store-qr-modal');
    if (modal) modal.classList.remove('active');
    this.checkModalOpenState();
  }

  updateStoreQRDisplay() {
    if (!this.currentQREst) return;
    const est = this.currentQREst;
    const tableInp = document.getElementById('qr-modal-table-input');
    const tableNum = tableInp ? tableInp.value.trim() : '';

    const origin = window.location.origin;
    let directUrl = `${origin}/?store=${encodeURIComponent(est.id)}`;
    if (tableNum) {
      directUrl += `&mesa=${encodeURIComponent(tableNum)}`;
    }

    const urlInp = document.getElementById('qr-modal-url-input');
    if (urlInp) urlInp.value = directUrl;

    const canvas = document.getElementById('qr-display-canvas');
    if (!canvas) return;

    // Generate orange QR code modules
    this.renderCustomOrangeQR(directUrl, (qrCanvasOrImg) => {
      this.drawStoreQRDisplayCanvas(canvas, est, tableNum, qrCanvasOrImg);
    });
  }

  renderCustomOrangeQR(directUrl, callback) {
    // 1. Try local QRCode client-side library
    if (typeof QRCode !== 'undefined') {
      try {
        const hiddenDiv = document.getElementById('qr-hidden-generator') || document.createElement('div');
        hiddenDiv.innerHTML = '';
        
        new QRCode(hiddenDiv, {
          text: directUrl,
          width: 580,
          height: 580,
          colorDark: '#FF6B00',
          colorLight: '#111116',
          correctLevel: QRCode.CorrectLevel.M
        });

        // Give a microtask for canvas/img generation
        setTimeout(() => {
          const generatedCanvas = hiddenDiv.querySelector('canvas');
          const generatedImg = hiddenDiv.querySelector('img');
          if (generatedCanvas) {
            callback(generatedCanvas);
          } else if (generatedImg && generatedImg.src) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => callback(img);
            img.src = generatedImg.src;
          } else {
            this.fallbackQRServerImage(directUrl, callback);
          }
        }, 30);
        return;
      } catch (err) {
        console.warn('QRCode JS error, falling back:', err);
      }
    }

    this.fallbackQRServerImage(directUrl, callback);
  }

  fallbackQRServerImage(directUrl, callback) {
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=580x580&data=${encodeURIComponent(directUrl)}&color=FF6B00&bgcolor=111116&margin=0`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => callback(img);
    img.onerror = () => {
      // Offline fallback
      const altUrl = `https://api.qrserver.com/v1/create-qr-code/?size=580x580&data=${encodeURIComponent(directUrl)}&margin=0`;
      const fallbackImg = new Image();
      fallbackImg.crossOrigin = 'anonymous';
      fallbackImg.onload = () => callback(fallbackImg);
      fallbackImg.src = altUrl;
    };
    img.src = qrApiUrl;
  }

  drawStoreQRDisplayCanvas(canvas, est, tableNum, qrElement) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 1200;
    const H = 1200;
    canvas.width = W;
    canvas.height = H;

    // 1. Deep Dark Background
    ctx.fillStyle = '#09090D';
    ctx.fillRect(0, 0, W, H);

    // 2. Symmetrical Orange Cross Beams (Geometric Ray Pattern)
    ctx.save();
    const gradRay = ctx.createLinearGradient(0, 0, W, H);
    gradRay.addColorStop(0, '#FF7A00');
    gradRay.addColorStop(0.5, '#FF5500');
    gradRay.addColorStop(1, '#FF7A00');
    ctx.fillStyle = gradRay;

    // Top-Left Wedge
    ctx.beginPath();
    ctx.moveTo(0, 160);
    ctx.lineTo(160, 0);
    ctx.lineTo(600, 600);
    ctx.closePath();
    ctx.fill();

    // Bottom-Right Wedge
    ctx.beginPath();
    ctx.moveTo(1200, 1040);
    ctx.lineTo(1040, 1200);
    ctx.lineTo(600, 600);
    ctx.closePath();
    ctx.fill();

    // Top-Right Wedge
    ctx.beginPath();
    ctx.moveTo(1040, 0);
    ctx.lineTo(1200, 160);
    ctx.lineTo(600, 600);
    ctx.closePath();
    ctx.fill();

    // Bottom-Left Wedge
    ctx.beginPath();
    ctx.moveTo(0, 1040);
    ctx.lineTo(160, 1200);
    ctx.lineTo(600, 600);
    ctx.closePath();
    ctx.fill();

    // Side Lateral Wedges
    ctx.beginPath();
    ctx.moveTo(0, 420);
    ctx.lineTo(0, 780);
    ctx.lineTo(600, 600);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(1200, 420);
    ctx.lineTo(1200, 780);
    ctx.lineTo(600, 600);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 3. Central Glowing Circle Emblem
    const cx = 600;
    const cy = 600;
    const R = 490;

    ctx.save();
    // Glowing Outer Shadow
    ctx.shadowColor = 'rgba(255, 107, 0, 0.75)';
    ctx.shadowBlur = 45;

    // Inner Circle Body
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    const circleGrad = ctx.createRadialGradient(cx, cy, 60, cx, cy, R);
    circleGrad.addColorStop(0, '#16161D');
    circleGrad.addColorStop(0.75, '#0E0E14');
    circleGrad.addColorStop(1, '#08080C');
    ctx.fillStyle = circleGrad;
    ctx.fill();

    // Main Outer Orange Stroke
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#FF6B00';
    ctx.stroke();
    ctx.restore();

    // Inner Accent Ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 14, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 170, 0, 0.8)';
    ctx.stroke();
    ctx.restore();

    // 4. Four Cardinal Food Badges
    const badges = [
      { x: cx, y: cy - R, icon: '🍔' },
      { x: cx - R, y: cy, icon: '🍽️' },
      { x: cx + R, y: cy, icon: '🥟' },
      { x: cx, y: cy + R, icon: '🥩' }
    ];

    badges.forEach(b => {
      ctx.save();
      // Badge Disc
      ctx.beginPath();
      ctx.arc(b.x, b.y, 44, 0, Math.PI * 2);
      ctx.fillStyle = '#111116';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#FF6B00';
      ctx.shadowColor = 'rgba(255, 107, 0, 0.9)';
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.restore();

      // Emoji Icon
      ctx.save();
      ctx.font = '40px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.icon, b.x, b.y + 2);
      ctx.restore();
    });

    // 5. Top Restaurant Name Header
    ctx.save();
    const rawName = (est.name || 'RESTAURANTE').toUpperCase();
    
    let fontSize = 52;
    if (rawName.length > 18) fontSize = 42;
    if (rawName.length > 25) fontSize = 34;

    ctx.font = `900 ${fontSize}px "Arial Black", "Montserrat", "Impact", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.shadowColor = 'rgba(255, 120, 0, 0.9)';
    ctx.shadowBlur = 24;
    
    const nameGrad = ctx.createLinearGradient(0, 240, 0, 320);
    nameGrad.addColorStop(0, '#FFA726');
    nameGrad.addColorStop(0.5, '#FF7A00');
    nameGrad.addColorStop(1, '#FF5500');
    ctx.fillStyle = nameGrad;
    
    const nameY = tableNum ? 260 : 285;
    ctx.fillText(rawName, cx, nameY);
    ctx.restore();

    // Table Pill Badge (if specified)
    if (tableNum) {
      ctx.save();
      const tableText = `📍 MESA ${tableNum.toUpperCase()}`;
      ctx.font = '900 24px "Montserrat", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const textWidth = ctx.measureText(tableText).width;
      const pillW = textWidth + 38;
      const pillH = 38;
      const pillX = cx - pillW / 2;
      const pillY = 302;

      ctx.fillStyle = 'rgba(254, 240, 138, 0.15)';
      ctx.strokeStyle = '#FCD34D';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(pillX, pillY, pillW, pillH, 19);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FDE047';
      ctx.shadowColor = 'rgba(253, 224, 71, 0.6)';
      ctx.shadowBlur = 10;
      ctx.fillText(tableText, cx, pillY + pillH / 2);
      ctx.restore();
    }

    // 6. Center Vibrant Orange QR Code
    if (qrElement) {
      const qrSize = 580;
      const qrX = cx - qrSize / 2;
      const qrY = tableNum ? 355 : 340;

      // Dark background panel for QR
      ctx.save();
      ctx.fillStyle = '#111116';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 22);
      } else {
        ctx.rect(qrX - 12, qrY - 12, qrSize + 24, qrSize + 24);
      }
      ctx.fill();
      ctx.restore();

      // Draw QR Image/Canvas
      ctx.drawImage(qrElement, qrX, qrY, qrSize, qrSize);
    }

    // 7. Bottom Branding & Call to Action
    ctx.save();
    ctx.font = '900 22px "Montserrat", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFA000';
    ctx.shadowColor = 'rgba(255, 107, 0, 0.7)';
    ctx.shadowBlur = 12;
    ctx.fillText('PEDIGOCHOS • ESCANEA PARA ORDENAR', cx, 985);
    ctx.restore();
  }

  async copyStoreQRUrl() {
    const inp = document.getElementById('qr-modal-url-input');
    if (!inp || !inp.value) return;

    try {
      await navigator.clipboard.writeText(inp.value);
      this.showToast('📋 ¡Enlace directo copiado al portapapeles!');
    } catch(e) {
      inp.select();
      document.execCommand('copy');
      this.showToast('📋 ¡Enlace copiado!');
    }
  }

  openStoreQRInNewTab() {
    const inp = document.getElementById('qr-modal-url-input');
    if (inp && inp.value) {
      window.open(inp.value, '_blank');
    }
  }

  downloadStoreQRImage() {
    if (!this.currentQREst) return;
    const est = this.currentQREst;
    const tableNum = (document.getElementById('qr-modal-table-input')?.value || '').trim();
    const canvas = document.getElementById('qr-display-canvas');
    if (!canvas) return;

    this.showToast('⏳ Generando Display HD...');

    try {
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      const filename = `Display_QR_${(est.name || 'Restaurante').replace(/[^a-zA-Z0-9]/g, '_')}${tableNum ? '_Mesa_' + tableNum : ''}.png`;
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      this.showToast(`✅ ¡Display HD guardado como "${filename}"!`);
    } catch(err) {
      console.error(err);
      window.open(canvas.toDataURL(), '_blank');
    }
  }

  async downloadBatchTableQRs(from = 1, to = 10) {
    if (!this.currentQREst) return;
    const est = this.currentQREst;
    const origin = window.location.origin;

    this.showToast(`📦 Generando lote de displays para Mesas ${from} al ${to}...`);

    for (let table = from; table <= to; table++) {
      const directUrl = `${origin}/?store=${encodeURIComponent(est.id)}&mesa=${encodeURIComponent(table)}`;
      
      await new Promise((resolve) => {
        this.renderCustomOrangeQR(directUrl, (qrElem) => {
          const offCanvas = document.createElement('canvas');
          this.drawStoreQRDisplayCanvas(offCanvas, est, String(table), qrElem);
          
          const dataUrl = offCanvas.toDataURL('image/png', 1.0);
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = `Display_QR_${(est.name || 'Restaurante').replace(/[^a-zA-Z0-9]/g, '_')}_Mesa_${table}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          setTimeout(resolve, 300);
        });
      });
    }

    this.showToast(`✅ ¡Lote de ${to - from + 1} displays para mesas descargado con éxito!`);
  }

  printStoreQRAffiche() {
    if (!this.currentQREst) return;
    const est = this.currentQREst;
    const tableNum = (document.getElementById('qr-modal-table-input')?.value || '').trim();
    const canvas = document.getElementById('qr-display-canvas');
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png', 1.0);

    const printWin = window.open('', '_blank', 'width=700,height=850');
    if (!printWin) {
      alert('⚠️ Por favor permite las ventanas emergentes para imprimir.');
      return;
    }

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Imprimir Display QR - ${est.name}</title>
        <meta charset="utf-8">
        <style>
          @page {
            size: auto;
            margin: 10mm;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #09090D;
            color: #FFFFFF;
            margin: 0;
            padding: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 90vh;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .display-card {
            background: #09090D;
            border-radius: 24px;
            padding: 20px;
            text-align: center;
            max-width: 480px;
            width: 100%;
            box-sizing: border-box;
          }
          .display-card img {
            width: 100%;
            height: auto;
            border-radius: 16px;
            display: block;
            margin: 0 auto;
          }
          .instructions {
            margin-top: 14px;
            font-size: 13px;
            font-weight: 800;
            color: #FFA000;
          }
        </style>
      </head>
      <body>
        <div class="display-card">
          <img src="${dataUrl}" alt="Display QR ${est.name}">
          <div class="instructions">📱 Escanea con tu cámara para ver el menú y pedir</div>
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 500);
          };
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
  }

  // ==========================================
  // AI MENU SCANNER & MISSING PRICES ENGINE
  // ==========================================

  initAIMenuTab() {
    const keyInput = document.getElementById('ai-menu-api-key');
    if (keyInput) {
      const savedKey = localStorage.getItem('pedigochos_gemini_api_key') || '';
      if (savedKey) keyInput.value = savedKey;
    }
    this.selectedAIMenuFileBase64 = null;
    const previewCont = document.getElementById('ai-menu-file-preview-container');
    if (previewCont) previewCont.classList.add('hidden');
    const fileInput = document.getElementById('ai-menu-file-input');
    if (fileInput) fileInput.value = '';
    const textInput = document.getElementById('ai-menu-text-input');
    if (textInput) textInput.value = '';

    const emptyState = document.getElementById('ai-scan-empty-state');
    if (emptyState) emptyState.style.display = 'block';
    const statusCont = document.getElementById('ai-scan-status-container');
    if (statusCont) statusCont.style.display = 'none';
    const resultsCont = document.getElementById('ai-scan-results-container');
    if (resultsCont) {
      resultsCont.classList.add('hidden');
      resultsCont.innerHTML = '';
    }
  }

  openAIScannerForShop(shopId) {
    this.closeEstActionModal();
    window.activeShopIdForMenu = shopId;
    this.openMenuTablesModal(shopId);
    this.switchModalTab('ai');
  }

  handleAIMenuFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const previewCont = document.getElementById('ai-menu-file-preview-container');
    const previewImg = document.getElementById('ai-menu-file-preview');
    const nameLabel = document.getElementById('ai-menu-file-name');

    if (nameLabel) nameLabel.innerText = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.selectedAIMenuFileBase64 = e.target.result;
      if (file.type.startsWith('image/') && previewImg) {
        previewImg.src = e.target.result;
        if (previewCont) previewCont.classList.remove('hidden');
      } else {
        if (previewCont) previewCont.classList.add('hidden');
      }
      this.showToast(`📸 Archivo cargado: ${file.name}`);
    };
    reader.readAsDataURL(file);
  }

  async startAIMenuScan() {
    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
    if (!est) {
      this.showToast('⚠️ Por favor selecciona un comercio primero');
      return;
    }

    const textInput = document.getElementById('ai-menu-text-input')?.value?.trim() || '';
    const fileBase64 = this.selectedAIMenuFileBase64 || '';
    const apiKey = document.getElementById('ai-menu-api-key')?.value?.trim() || '';

    if (apiKey) {
      localStorage.setItem('pedigochos_gemini_api_key', apiKey);
    }

    if (!fileBase64 && !textInput) {
      this.showToast('⚠️ Sube una foto de la carta o escribe el texto del menú');
      return;
    }

    const emptyState = document.getElementById('ai-scan-empty-state');
    const statusCont = document.getElementById('ai-scan-status-container');
    const statusTitle = document.getElementById('ai-scan-status-title');
    const statusDesc = document.getElementById('ai-scan-status-desc');
    const resultsCont = document.getElementById('ai-scan-results-container');

    if (emptyState) emptyState.style.display = 'none';
    if (resultsCont) resultsCont.classList.add('hidden');
    if (statusCont) statusCont.style.display = 'block';

    const steps = [
      { title: '🔍 Leyendo texto y detectando platos...', desc: 'Analizando imágenes, encabezados y precios con Inteligencia Artificial...' },
      { title: '🍳 Organizando categorías y modificadores...', desc: 'Estructurando ingredientes, tamaños y opciones adicionales...' },
      { title: '💵 Auditando precios y detectando adicionales pendientes...', desc: 'Verificando adicionales y notas para el restaurante...' }
    ];

    let stepIdx = 0;
    const stepTimer = setInterval(() => {
      stepIdx = (stepIdx + 1) % steps.length;
      if (statusTitle) statusTitle.innerText = steps[stepIdx].title;
      if (statusDesc) statusDesc.innerText = steps[stepIdx].desc;
    }, 2500);

    try {
      const response = await fetch('/api/ai/parse-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: fileBase64,
          menuText: textInput,
          apiKey: apiKey || localStorage.getItem('pedigochos_gemini_api_key') || '',
          establishmentName: est.name,
          establishmentCategory: est.category
        })
      });

      clearInterval(stepTimer);
      if (statusCont) statusCont.style.display = 'none';

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'No se pudo estructurar el menú');
      }

      this.currentParsedAIMenu = data.menu;
      this.renderAIMenuPreview(data.menu, est);
      this.showToast(`🎉 Menú extraído: ${data.menu.products?.length || 0} platos detectados`);
    } catch (err) {
      clearInterval(stepTimer);
      if (statusCont) statusCont.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
      console.error('Error starting AI scan:', err);
      alert(`⚠️ Error al escanear menú con IA:\n${err.message}\n\nPuedes obtener una clave gratuita de Google en https://aistudio.google.com/app/apikey`);
    }
  }

  renderAIMenuPreview(menu, est) {
    const resultsCont = document.getElementById('ai-scan-results-container');
    if (!resultsCont) return;

    resultsCont.classList.remove('hidden');

    const products = menu.products || [];
    const categories = menu.categories || [];
    const missingCount = menu.missing_prices_count || 0;

    let missingBanner = '';
    if (missingCount > 0) {
      missingBanner = `
        <div style="background: rgba(245, 158, 11, 0.15); border: 1.5px solid #F59E0B; border-radius: 12px; padding: 10px 14px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px;">⚠️</span>
          <div>
            <strong style="color: #FCD34D; font-size: 12.5px;">${missingCount} adicionales o productos detectados sin precio</strong>
            <p style="margin: 0; font-size: 11px; color: #CBD5E1;">Puedes ajustarlos aquí mismo o importarlos y completarlos luego con el botón rápido.</p>
          </div>
        </div>
      `;
    }

    resultsCont.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
        <div>
          <h4 style="margin: 0; color: #FFF; font-size: 14.5px; font-weight: 800;">🎉 Vista Previa del Menú Extraído</h4>
          <span style="font-size: 11.5px; color: var(--accent);">${products.length} platos en ${categories.length} categorías</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="font-size: 11px; color: #CBD5E1; display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" id="ai-replace-menu-checkbox" checked> Reemplazar carta actual
          </label>
        </div>
      </div>

      ${missingBanner}

      <div class="premium-scroll" style="flex: 1; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; margin-bottom: 12px;">
        ${products.map((p, pIdx) => {
          const priceDisplay = p.price > 0 ? `$${p.price.toLocaleString('de-DE')} COP` : '⚠️ Sin Precio';
          const pBadgeColor = p.price > 0 ? '#10B981' : '#F59E0B';
          
          let modifiersBadges = '';
          if (Array.isArray(p.modifiers) && p.modifiers.length > 0) {
            modifiersBadges = p.modifiers.map(m => `
              <div style="margin-top: 4px; padding: 4px 8px; background: rgba(255,255,255,0.04); border-radius: 6px; font-size: 10.5px;">
                <strong style="color: #93C5FD;">🎛️ ${m.group_name}:</strong>
                ${(m.options || []).map(opt => `
                  <span style="color: ${opt.price_pending ? '#FCD34D' : '#FFF'}; margin-right: 6px;">
                    ${opt.name} (${opt.price_pending ? '⚠️ Sin Precio' : (opt.extra_price > 0 ? `+$${opt.extra_price.toLocaleString('de-DE')}` : '+$0')})
                  </span>
                `).join('')}
              </div>
            `).join('');
          }

          return `
            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px 12px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <div>
                  <div style="font-weight: 800; font-size: 13px; color: #FFF;">${p.name}</div>
                  <span style="font-size: 10.5px; color: var(--text-muted);">${p.category || 'General'}</span>
                  ${p.description ? `<p style="font-size: 11px; color: #94A3B8; margin: 2px 0 0 0;">${p.description}</p>` : ''}
                </div>
                <div style="text-align: right; flex-shrink: 0;">
                  <span style="font-size: 12px; font-weight: 800; color: ${pBadgeColor};">${priceDisplay}</span>
                </div>
              </div>
              ${modifiersBadges}
            </div>
          `;
        }).join('')}
      </div>

      <div style="display: flex; gap: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px;">
        <button type="button" class="btn-neumorphic" onclick="AdminApp.initAIMenuTab()" style="margin: 0; padding: 8px 14px; font-size: 12px;">🔄 Reintentar</button>
        <button type="button" onclick="AdminApp.confirmImportAIMenu()" style="flex: 1; padding: 10px 18px; border-radius: 10px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: #FFF; border: none; font-weight: 800; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 4px 12px rgba(160,185,129,0.35);">
          <span>💾 Confirmar e Importar Carta Completa</span>
        </button>
      </div>
    `;
  }

  async confirmImportAIMenu() {
    if (!this.currentParsedAIMenu || !Array.isArray(this.currentParsedAIMenu.products)) {
      this.showToast('⚠️ No hay menú procesado para importar');
      return;
    }

    const shopId = window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === shopId);
    if (!est) return;

    const replaceExisting = document.getElementById('ai-replace-menu-checkbox')?.checked ?? true;

    // Format new products with unique identifiers
    const formattedProducts = this.currentParsedAIMenu.products.map(p => {
      const prodId = 'prod-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
      let modifiers = [];
      if (Array.isArray(p.modifiers)) {
        modifiers = p.modifiers.map((m, mIdx) => ({
          group_id: `g-${mIdx}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          group_name: m.group_name || 'Opciones',
          selection_type: m.selection_type || 'multiple',
          required: !!m.required,
          options: (m.options || []).map((opt, oIdx) => ({
            id: `opt-${mIdx}-${oIdx}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            option_id: `opt-${mIdx}-${oIdx}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            name: opt.name || 'Opción',
            extra_price: parseFloat(opt.extra_price) || 0,
            price_pending: opt.price_pending === true || (!opt.extra_price && m.group_name?.toLowerCase().includes('adic'))
          }))
        }));
      }

      return {
        id: prodId,
        name: p.name || 'Producto',
        category: p.category || 'General',
        description: p.description || '',
        price: parseFloat(p.price) || 0,
        price_pending: p.price_pending === true || parseFloat(p.price) <= 0,
        image: p.image || '/images/burger_royale.jpg',
        exclusions: (p.exclusions || []).map(e => (typeof e === 'object' ? e : { name: String(e) })),
        modifiers: modifiers
      };
    });

    if (replaceExisting) {
      est.products = formattedProducts;
    } else {
      if (!Array.isArray(est.products)) est.products = [];
      formattedProducts.forEach(fp => {
        if (!est.products.some(ep => ep.name.toLowerCase() === fp.name.toLowerCase())) {
          est.products.push(fp);
        }
      });
    }

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          products: est.products
        })
      });

      if (!res.ok) throw new Error('Error al guardar en el servidor');

      this.showToast(`🎉 ¡Menú de ${est.name} actualizado con éxito!`);
      this.markPendingChanges();
      this.renderTable();
      this.loadModalProducts();

      // Switch to standard menu tab
      this.switchModalTab('menu');

      // Check if missing prices exist to trigger prompt
      const missing = this.getMissingPricesForEstablishment(est);
      if (missing.length > 0) {
        setTimeout(() => {
          this.openQuickFillPricesModal(est.id);
        }, 500);
      }
    } catch (err) {
      console.error(err);
      alert('Error al guardar el menú en el servidor: ' + err.message);
    }
  }

  getMissingPricesForEstablishment(est) {
    if (!est || !Array.isArray(est.products)) return [];
    const missing = [];
    const modifierMap = new Map();

    est.products.forEach(p => {
      // 1. Check if product itself has no price
      if (p.price_pending === true || !p.price || parseFloat(p.price) <= 0) {
        missing.push({
          type: 'product',
          productId: p.id,
          productName: p.name,
          category: p.category || 'Carta',
          name: p.name,
          currentPrice: p.price || 0,
          productNames: [p.name]
        });
      }

      // 2. Check modifiers/additions and group by modifier name
      if (Array.isArray(p.modifiers)) {
        p.modifiers.forEach(m => {
          if (Array.isArray(m.options)) {
            m.options.forEach(opt => {
              const isPending = opt.price_pending === true || (m.group_name?.toLowerCase().includes('adic') && (!opt.extra_price || parseFloat(opt.extra_price) <= 0));
              if (isPending) {
                const groupLabel = (m.group_name || 'Adicionales').trim();
                const optLabel = (opt.name || 'Opción').trim();
                const key = `${groupLabel.toLowerCase()}:::${optLabel.toLowerCase()}`;

                if (!modifierMap.has(key)) {
                  modifierMap.set(key, {
                    type: 'modifier',
                    groupName: groupLabel,
                    optionName: optLabel,
                    name: `${groupLabel} ➔ ${optLabel}`,
                    currentPrice: opt.extra_price || 0,
                    category: p.category || 'Carta',
                    productNames: [p.name],
                    targets: [{
                      productId: p.id,
                      productName: p.name,
                      groupId: m.group_id,
                      optionId: opt.id || opt.option_id
                    }]
                  });
                } else {
                  const existing = modifierMap.get(key);
                  if (!existing.productNames.includes(p.name)) {
                    existing.productNames.push(p.name);
                  }
                  existing.targets.push({
                    productId: p.id,
                    productName: p.name,
                    groupId: m.group_id,
                    optionId: opt.id || opt.option_id
                  });
                  if (!existing.currentPrice && opt.extra_price > 0) {
                    existing.currentPrice = opt.extra_price;
                  }
                }
              }
            });
          }
        });
      }
    });

    // Add all unique grouped modifiers
    modifierMap.forEach(item => {
      missing.push(item);
    });

    return missing;
  }

  auditMissingPrices(est) {
    if (!est) return;
    const missing = this.getMissingPricesForEstablishment(est);
    const banner = document.getElementById('missing-prices-alert-banner');
    const textEl = document.getElementById('missing-prices-alert-text');

    if (banner) {
      if (missing.length > 0) {
        banner.classList.remove('hidden');
        if (textEl) textEl.innerText = `Tienes ${missing.length} adicionales/platos sin precio en ${est.name}`;
      } else {
        banner.classList.add('hidden');
      }
    }
  }

  openQuickFillPricesModal(shopId) {
    const targetId = shopId || window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === targetId);
    if (!est) return;

    this.activeShopIdForQuickFill = est.id;

    const nameEl = document.getElementById('quick-fill-shop-name');
    if (nameEl) nameEl.innerText = `🏪 ${est.name}`;

    const missing = this.getMissingPricesForEstablishment(est);
    const listCont = document.getElementById('quick-fill-items-list');

    if (listCont) {
      if (missing.length === 0) {
        listCont.innerHTML = `
          <div style="text-align: center; padding: 24px; color: #10B981;">
            <span style="font-size: 32px; display: block; margin-bottom: 6px;">✅</span>
            <strong style="font-size: 14px;">¡Todos los productos y adicionales tienen precio!</strong>
          </div>
        `;
      } else {
        listCont.innerHTML = missing.map((item, idx) => {
          let appliesToText = '';
          if (item.type === 'product') {
            appliesToText = `Plato completo (${item.category || 'Carta'})`;
          } else if (item.productNames && item.productNames.length > 1) {
            const preview = item.productNames.slice(0, 3).join(', ');
            const remaining = item.productNames.length - 3;
            appliesToText = `🔄 Aplica a ${item.productNames.length} platos: ${preview}${remaining > 0 ? ` +${remaining} más` : ''}`;
          } else if (item.productNames && item.productNames.length === 1) {
            appliesToText = `Plato: ${item.productNames[0]} (${item.category || 'Carta'})`;
          } else {
            appliesToText = item.category || 'Carta';
          }

          return `
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); padding: 10px 14px; border-radius: 12px; gap: 12px; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 180px;">
                <div style="font-weight: 800; font-size: 13px; color: #FFF;">${item.name}</div>
                <div style="font-size: 11px; color: #94A3B8; margin-top: 2px;">${appliesToText}</div>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <div style="display: flex; align-items: center; gap: 4px; width: 130px;">
                  <span style="color: #FCD34D; font-weight: 800; font-size: 13px;">$</span>
                  <input type="number" step="500" min="0" placeholder="Ej: 3000" data-idx="${idx}" class="quick-fill-input" value="${item.currentPrice > 0 ? item.currentPrice : ''}" style="width: 100%; padding: 6px 8px; border-radius: 8px; background: rgba(18,18,22,0.9); border: 1.5px solid #F59E0B; color: #FFF; font-weight: 800; font-size: 13px;">
                </div>
                <button type="button" onclick="event.stopPropagation(); AdminApp.deleteSpecificMissingModifier(${idx})" class="btn-neumorphic" style="margin: 0; padding: 6px 9px; height: 32px; color: #EF4444; border-color: rgba(239,68,68,0.35); background: rgba(239,68,68,0.12); font-size: 12px; cursor: pointer;" title="Eliminar este adicional sin precio de los platos">
                  🗑️
                </button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    this.currentQuickFillItems = missing;

    const modal = document.getElementById('quick-fill-prices-modal');
    if (modal) modal.classList.add('active');
    this.checkModalOpenState();
  }

  async deleteSpecificMissingModifier(idx) {
    const est = this.establishments.find(e => e.id === this.activeShopIdForQuickFill);
    if (!est || !Array.isArray(this.currentQuickFillItems)) return;

    const item = this.currentQuickFillItems[idx];
    if (!item) return;

    if (!confirm(`¿Eliminar "${item.name}" de todos los platos donde aparece?`)) return;

    if (item.type === 'product') {
      est.products = (est.products || []).filter(p => p.id !== item.productId);
    } else if (item.type === 'modifier') {
      const optNameTarget = (item.optionName || '').trim().toLowerCase();
      const groupNameTarget = (item.groupName || '').trim().toLowerCase();

      (est.products || []).forEach(prod => {
        if (Array.isArray(prod.modifiers)) {
          prod.modifiers.forEach(group => {
            if (Array.isArray(group.options)) {
              group.options = group.options.filter(o => {
                const isTarget = item.targets && item.targets.some(t => t.productId === prod.id && (t.optionId === o.id || t.optionId === o.option_id));
                const nameMatch = (o.name || '').trim().toLowerCase() === optNameTarget;
                return !isTarget && !nameMatch;
              });
            }
          });
          prod.modifiers = prod.modifiers.filter(group => Array.isArray(group.options) && group.options.length > 0);
        }
      });
    }

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
        this.showToast(`✅ "${item.name}" eliminado de los platos.`);
        this.openQuickFillPricesModal(est.id);

        if (typeof window.loadProducts === 'function') await window.loadProducts();
        if (typeof this.loadModalProducts === 'function') this.loadModalProducts();
        if (typeof this.renderModalProducts === 'function') this.renderModalProducts();
        if (typeof this.renderDailySpecialsTab === 'function') {
          this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
        }
        if (typeof this.renderTable === 'function') {
          this.renderTable();
        }
        if (typeof this.auditMissingPrices === 'function') {
          this.auditMissingPrices(est);
        }
      } else {
        alert('Error al guardar cambios.');
      }
    } catch (err) {
      console.error(err);
      alert('Error al eliminar adicional.');
    }
  }

  async deleteMissingModifiersAll() {
    const est = this.establishments.find(e => e.id === this.activeShopIdForQuickFill);
    if (!est || !Array.isArray(this.currentQuickFillItems) || this.currentQuickFillItems.length === 0) return;

    if (!confirm(`¿Eliminar TODOS los ${this.currentQuickFillItems.length} adicionales/platos sin precio de "${est.name}"?`)) return;

    const missingModifiers = this.currentQuickFillItems.filter(i => i.type === 'modifier');
    const missingProducts = this.currentQuickFillItems.filter(i => i.type === 'product').map(p => p.productId);

    if (missingProducts.length > 0) {
      est.products = (est.products || []).filter(p => !missingProducts.includes(p.id));
    }

    const optNamesToDelete = new Set(missingModifiers.map(m => (m.optionName || '').trim().toLowerCase()));

    (est.products || []).forEach(prod => {
      if (Array.isArray(prod.modifiers)) {
        prod.modifiers.forEach(group => {
          if (Array.isArray(group.options)) {
            group.options = group.options.filter(o => {
              const nameKey = (o.name || '').trim().toLowerCase();
              const isUnpriced = optNamesToDelete.has(nameKey) || o.price_pending === true || !o.extra_price || o.extra_price === 0;
              return !optNamesToDelete.has(nameKey) && !isUnpriced;
            });
          }
        });
        prod.modifiers = prod.modifiers.filter(group => Array.isArray(group.options) && group.options.length > 0);
      }
    });

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
        document.getElementById('quick-fill-prices-modal')?.classList.remove('active');
        this.showToast(`✅ Se eliminaron todos los adicionales sin precio.`);

        if (typeof window.loadProducts === 'function') await window.loadProducts();
        if (typeof this.loadModalProducts === 'function') this.loadModalProducts();
        if (typeof this.renderModalProducts === 'function') this.renderModalProducts();
        if (typeof this.renderDailySpecialsTab === 'function') {
          this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
        }
        if (typeof this.renderTable === 'function') {
          this.renderTable();
        }
        if (typeof this.auditMissingPrices === 'function') {
          this.auditMissingPrices(est);
        }
      } else {
        alert('Error al guardar cambios.');
      }
    } catch (err) {
      console.error(err);
      alert('Error al eliminar adicionales.');
    }
  }

  async saveQuickFillPrices() {
    const est = this.establishments.find(e => e.id === this.activeShopIdForQuickFill);
    if (!est || !Array.isArray(this.currentQuickFillItems)) return;

    const inputs = document.querySelectorAll('.quick-fill-input');
    inputs.forEach(inp => {
      const idx = parseInt(inp.getAttribute('data-idx'));
      const val = parseFloat(inp.value) || 0;
      const item = this.currentQuickFillItems[idx];
      if (!item) return;

      if (item.type === 'product') {
        const prod = (est.products || []).find(p => p.id === item.productId);
        if (prod) {
          prod.price = val;
          prod.price_pending = false;
        }
      } else if (item.type === 'modifier') {
        const optNameTarget = (item.optionName || '').trim().toLowerCase();
        const groupNameTarget = (item.groupName || '').trim().toLowerCase();

        // 1. Update all explicit targets
        if (Array.isArray(item.targets)) {
          item.targets.forEach(tgt => {
            const prod = (est.products || []).find(p => p.id === tgt.productId);
            if (prod && Array.isArray(prod.modifiers)) {
              const modGroup = prod.modifiers.find(m => m.group_id === tgt.groupId || (m.group_name || '').trim().toLowerCase() === groupNameTarget);
              if (modGroup && Array.isArray(modGroup.options)) {
                const opt = modGroup.options.find(o => (o.id === tgt.optionId || o.option_id === tgt.optionId || (o.name || '').trim().toLowerCase() === optNameTarget));
                if (opt) {
                  opt.extra_price = val;
                  opt.price_pending = false;
                }
              }
            }
          });
        }

        // 2. Global bulk update across ALL dishes in the establishment with matching modifier option name
        (est.products || []).forEach(prod => {
          if (Array.isArray(prod.modifiers)) {
            prod.modifiers.forEach(m => {
              const mNameLower = (m.group_name || '').trim().toLowerCase();
              if (mNameLower === groupNameTarget || mNameLower.includes('adic') || groupNameTarget.includes('adic')) {
                if (Array.isArray(m.options)) {
                  m.options.forEach(opt => {
                    if ((opt.name || '').trim().toLowerCase() === optNameTarget) {
                      opt.extra_price = val;
                      opt.price_pending = false;
                    }
                  });
                }
              }
            });
          }
        });
      }
    });

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          products: est.products
        })
      });

      if (!res.ok) throw new Error('Error al guardar precios');

      this.showToast(`✅ Precios actualizados en todos los platos de ${est.name}`);
      this.markPendingChanges();
      this.renderTable();
      this.auditMissingPrices(est);
      this.loadModalProducts();

      const modal = document.getElementById('quick-fill-prices-modal');
      if (modal) modal.classList.remove('active');
      this.checkModalOpenState();
    } catch (err) {
      console.error(err);
      alert('Error al guardar precios: ' + err.message);
    }
  }

  // ==========================================
  // PIZZA CRUSTS MANAGER (ADMIN)
  // ==========================================

  openPizzaCrustsManagerModal(shopId) {
    const targetId = shopId || window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === targetId);
    if (!est) {
      this.showToast('⚠️ Por favor selecciona un comercio primero');
      return;
    }

    this.activeShopIdForCrusts = est.id;

    const nameEl = document.getElementById('pizza-crusts-shop-name');
    if (nameEl) nameEl.innerText = `🍕 ${est.name}`;

    const defaultCrusts = [
      { id: 'tradicional', name: 'Borde Tradicional (Sin relleno)', price: 0, icon: '🥖', description: 'Masa clásica crujiente' },
      { id: 'queso', name: 'Borde de Queso Mozzarella', price: 5000, icon: '🧀', description: 'Relleno de queso derretido' },
      { id: 'salchicha', name: 'Borde de Salchicha', price: 6000, icon: '🌭', description: 'Relleno de salchicha parrillera' },
      { id: 'bocadillo_queso', name: 'Borde de Bocadillo con Queso', price: 6000, icon: '🍯', description: 'Dulce de guayaba con queso' },
      { id: 'queso_crema', name: 'Borde de Queso Crema / Cheddar', price: 6000, icon: '🧀', description: 'Queso crema suave' }
    ];

    if (!Array.isArray(est.pizza_crusts) || est.pizza_crusts.length === 0) {
      this.editingPizzaCrusts = JSON.parse(JSON.stringify(defaultCrusts));
    } else {
      this.editingPizzaCrusts = JSON.parse(JSON.stringify(est.pizza_crusts));
      const hasTrad = this.editingPizzaCrusts.some(c => (c.name || '').toLowerCase().includes('tradicional'));
      if (!hasTrad) this.editingPizzaCrusts.unshift(defaultCrusts[0]);
    }

    this.renderPizzaCrustsManagerList();

    const modal = document.getElementById('pizza-crusts-manager-modal');
    if (modal) modal.classList.add('active');
    this.checkModalOpenState();
  }

  renderPizzaCrustsManagerList() {
    const listCont = document.getElementById('pizza-crusts-list');
    if (!listCont || !Array.isArray(this.editingPizzaCrusts)) return;

    if (this.editingPizzaCrusts.length === 0) {
      listCont.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #94A3B8; font-size: 13px;">
          No hay bordes configurados. Usa el formulario de arriba para añadir uno.
        </div>
      `;
      return;
    }

    listCont.innerHTML = this.editingPizzaCrusts.map((crust, idx) => {
      const isTrad = (crust.name || '').toLowerCase().includes('tradicional');
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); padding: 10px 12px; border-radius: 12px; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
            <span style="font-size: 20px;">${crust.icon || '🧀'}</span>
            <input type="text" class="crust-name-input" data-idx="${idx}" value="${crust.name}" style="flex: 1; background: rgba(18,18,22,0.8); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: #FFF; font-weight: 700; font-size: 12.5px; padding: 6px 10px;">
          </div>
          <div style="display: flex; align-items: center; gap: 6px; width: 130px;">
            <span style="color: #FCD34D; font-weight: 800; font-size: 13px;">$</span>
            <input type="number" step="500" min="0" class="crust-price-input" data-idx="${idx}" value="${crust.price || 0}" ${isTrad ? 'readonly' : ''} style="width: 100%; padding: 6px 8px; border-radius: 8px; background: rgba(18,18,22,0.9); border: 1.5px solid ${isTrad ? 'rgba(255,255,255,0.1)' : '#F59E0B'}; color: #FFF; font-weight: 800; font-size: 12.5px;">
          </div>
          <div>
            ${isTrad ? `
              <span style="font-size: 10.5px; color: #10B981; font-weight: 800; padding: 4px 6px;">Base</span>
            ` : `
              <button type="button" onclick="AdminApp.removePizzaCrust(${idx})" style="background: rgba(239, 68, 68, 0.2); border: 1px solid #EF4444; color: #FCA5A5; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer;" title="Eliminar borde">
                🗑️
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  addNewPizzaCrust() {
    const nameInput = document.getElementById('new-crust-name');
    const priceInput = document.getElementById('new-crust-price');
    const iconInput = document.getElementById('new-crust-icon');

    const name = nameInput?.value?.trim();
    const price = parseFloat(priceInput?.value) || 0;
    const icon = iconInput?.value?.trim() || (name?.toLowerCase().includes('salchicha') ? '🌭' : (name?.toLowerCase().includes('bocadillo') ? '🍯' : (name?.toLowerCase().includes('choc') ? '🍫' : '🧀')));

    if (!name) {
      this.showToast('⚠️ Escribe el nombre del borde');
      return;
    }

    if (!Array.isArray(this.editingPizzaCrusts)) {
      this.editingPizzaCrusts = [];
    }

    this.editingPizzaCrusts.push({
      id: 'crust-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: name,
      price: price,
      icon: icon,
      description: ''
    });

    if (nameInput) nameInput.value = '';
    if (priceInput) priceInput.value = '';
    if (iconInput) iconInput.value = '';

    this.renderPizzaCrustsManagerList();
    this.showToast(`➕ Borde "${name}" añadido a la lista`);
  }

  removePizzaCrust(idx) {
    if (!Array.isArray(this.editingPizzaCrusts) || !this.editingPizzaCrusts[idx]) return;
    this.editingPizzaCrusts.splice(idx, 1);
    this.renderPizzaCrustsManagerList();
    this.showToast(`🗑️ Borde eliminado`);
  }

  async savePizzaCrusts() {
    const est = this.establishments.find(e => e.id === this.activeShopIdForCrusts);
    if (!est || !Array.isArray(this.editingPizzaCrusts)) return;

    // Sync from inputs in DOM
    const nameInputs = document.querySelectorAll('.crust-name-input');
    const priceInputs = document.querySelectorAll('.crust-price-input');

    nameInputs.forEach(inp => {
      const idx = parseInt(inp.getAttribute('data-idx'));
      if (this.editingPizzaCrusts[idx]) {
        this.editingPizzaCrusts[idx].name = inp.value.trim() || this.editingPizzaCrusts[idx].name;
      }
    });

    priceInputs.forEach(inp => {
      const idx = parseInt(inp.getAttribute('data-idx'));
      if (this.editingPizzaCrusts[idx]) {
        this.editingPizzaCrusts[idx].price = parseFloat(inp.value) || 0;
      }
    });

    est.pizza_crusts = this.editingPizzaCrusts;

    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkKey: est.linkKey,
          isOwner: true,
          pizza_crusts: est.pizza_crusts
        })
      });

      if (!res.ok) throw new Error('Error al guardar bordes');

      this.showToast(`✅ Bordes de pizza guardados para ${est.name}`);
      this.markPendingChanges();

      const modal = document.getElementById('pizza-crusts-manager-modal');
      if (modal) modal.classList.remove('active');
      this.checkModalOpenState();
    } catch (err) {
      console.error(err);
      alert('Error al guardar bordes: ' + err.message);
    }
  }

  // --- Limpieza y Eliminación Selectiva / Masiva de Adicionales ---
  clearCurrentProductModifiers() {
    if (!confirm('¿Eliminar todos los grupos de opciones y adicionales de este plato?')) return;
    this.specsGroups = [];
    this.renderSpecsGroups();
  }

  openClearModifiersModal(shopId) {
    const targetId = shopId || window.activeShopIdForMenu || this.activeShopId;
    const est = this.establishments.find(e => e.id === targetId);
    if (!est) {
      alert('Por favor selecciona o abre un restaurante primero.');
      return;
    }

    this.activeShopIdForClearModifiers = est.id;

    const nameEl = document.getElementById('clear-modifiers-shop-name');
    if (nameEl) nameEl.innerText = `🏪 ${est.name}`;

    const searchInp = document.getElementById('clear-modifiers-search-input');
    if (searchInp) searchInp.value = '';

    this.renderClearModifiersDishList();

    const modal = document.getElementById('clear-modifiers-modal');
    if (modal) modal.classList.add('active');
    if (typeof this.checkModalOpenState === 'function') this.checkModalOpenState();
  }

  renderClearModifiersDishList() {
    const est = this.establishments.find(e => e.id === this.activeShopIdForClearModifiers);
    const listCont = document.getElementById('clear-modifiers-dish-list');
    if (!est || !listCont) return;

    const searchVal = (document.getElementById('clear-modifiers-search-input')?.value || '').toLowerCase().trim();
    const products = est.products || [];

    const filtered = products.filter(p => {
      if (!searchVal) return true;
      return (p.name || '').toLowerCase().includes(searchVal) || (p.category || '').toLowerCase().includes(searchVal);
    });

    if (filtered.length === 0) {
      listCont.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
          No se encontraron platos con el criterio de búsqueda.
        </div>
      `;
      return;
    }

    listCont.innerHTML = filtered.map(prod => {
      const groupsCount = Array.isArray(prod.modifiers) ? prod.modifiers.length : 0;
      let totalOptions = 0;
      if (groupsCount > 0) {
        prod.modifiers.forEach(g => {
          totalOptions += Array.isArray(g.options) ? g.options.length : 0;
        });
      }

      const hasModifiers = groupsCount > 0;
      const statusBadge = hasModifiers
        ? `<span style="background: rgba(239, 68, 68, 0.15); color: #FCA5A5; border: 1px solid rgba(239, 68, 68, 0.3); padding: 2px 7px; border-radius: 6px; font-size: 10.5px; font-weight: 800;">🎛️ ${groupsCount} grupo${groupsCount > 1 ? 's' : ''} (${totalOptions} opciones)</span>`
        : `<span style="color: #64748B; font-size: 11px; font-style: italic;">(Sin adicionales)</span>`;

      const formattedPrice = this.formatPesos ? this.formatPesos(prod.price || 0) : `$${(prod.price || 0).toLocaleString('es-CO')}`;

      return `
        <label style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 10px 14px; border-radius: 12px; gap: 12px; cursor: pointer; transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
          <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
            <input type="checkbox" class="clear-mod-dish-checkbox" value="${prod.id}" ${hasModifiers ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #EF4444; cursor: pointer; flex-shrink: 0;">
            <img src="${prod.image || '/images/burger_royale.jpg'}" alt="${prod.name}" style="width: 38px; height: 38px; border-radius: 8px; object-fit: cover; background: #111; flex-shrink: 0;" onerror="this.src='/images/burger_royale.jpg'">
            <div style="min-width: 0; flex: 1;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <strong style="color: #FFF; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${prod.name}</strong>
                <span style="color: #94A3B8; font-size: 11px;">(${prod.category || 'Carta'})</span>
              </div>
              <div style="font-size: 11px; color: #10B981; font-weight: 700; margin-top: 2px;">${formattedPrice}</div>
            </div>
          </div>
          <div style="flex-shrink: 0;">
            ${statusBadge}
          </div>
        </label>
      `;
    }).join('');
  }

  filterClearModifiersList() {
    this.renderClearModifiersDishList();
  }

  toggleAllClearModifiersCheckboxes(checked) {
    const checkboxes = document.querySelectorAll('.clear-mod-dish-checkbox');
    checkboxes.forEach(cb => { cb.checked = checked; });
  }

  async executeClearModifiersSelected() {
    const est = this.establishments.find(e => e.id === this.activeShopIdForClearModifiers);
    if (!est) return;

    const checkboxes = document.querySelectorAll('.clear-mod-dish-checkbox:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);

    if (selectedIds.length === 0) {
      alert('Por favor selecciona al menos 1 plato para eliminar sus adicionales.');
      return;
    }

    const clearExclusions = document.getElementById('clear-scope-exclusions')?.checked || false;
    const msg = clearExclusions
      ? `¿Estás seguro de eliminar los adicionales Y las exclusiones de los ${selectedIds.length} platos seleccionados?`
      : `¿Estás seguro de eliminar todos los adicionales de los ${selectedIds.length} platos seleccionados?`;

    if (!confirm(msg)) return;

    let modifiedCount = 0;
    (est.products || []).forEach(p => {
      if (selectedIds.includes(p.id)) {
        p.modifiers = [];
        if (clearExclusions) {
          p.exclusions = [];
        }
        modifiedCount++;
      }
    });

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
        document.getElementById('clear-modifiers-modal')?.classList.remove('active');
        if (typeof this.showToast === 'function') {
          this.showToast(`✅ Se limpiaron los adicionales de ${modifiedCount} platos.`);
        } else {
          alert(`✅ Se limpiaron los adicionales de ${modifiedCount} platos.`);
        }

        if (typeof window.loadProducts === 'function') await window.loadProducts();
        if (typeof this.renderModalProducts === 'function') this.renderModalProducts();
        if (typeof this.renderDailySpecialsTab === 'function') {
          this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
        }
        this.markPendingChanges();
      } else {
        alert('Error al guardar cambios en el servidor.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al eliminar adicionales.');
    }
  }

  async executeClearModifiersAll() {
    const est = this.establishments.find(e => e.id === this.activeShopIdForClearModifiers);
    if (!est) return;

    const clearExclusions = document.getElementById('clear-scope-exclusions')?.checked || false;
    const msg = clearExclusions
      ? `⚠️ ATENCIÓN: ¿Estás seguro de eliminar los ADICIONALES y EXCLUSIONES de TODOS los platos de "${est.name}"?`
      : `⚠️ ATENCIÓN: ¿Estás seguro de eliminar TODOS los grupos de adicionales de TODOS los platos de "${est.name}"?`;

    if (!confirm(msg)) return;

    let modifiedCount = 0;
    (est.products || []).forEach(p => {
      p.modifiers = [];
      if (clearExclusions) {
        p.exclusions = [];
      }
      modifiedCount++;
    });

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
        document.getElementById('clear-modifiers-modal')?.classList.remove('active');
        if (typeof this.showToast === 'function') {
          this.showToast(`✅ Se eliminaron los adicionales de todos los platos (${modifiedCount}).`);
        } else {
          alert(`✅ Se eliminaron los adicionales de todos los platos (${modifiedCount}).`);
        }

        if (typeof window.loadProducts === 'function') await window.loadProducts();
        if (typeof this.renderModalProducts === 'function') this.renderModalProducts();
        if (typeof this.renderDailySpecialsTab === 'function') {
          this.renderDailySpecialsTab(this.selectedDailyDay || 'todos');
        }
        this.markPendingChanges();
      } else {
        alert('Error al guardar cambios en el servidor.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al eliminar adicionales.');
    }
  }
}

const AdminApp = new AdminController();
window.AdminApp = AdminApp;

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

document.addEventListener('DOMContentLoaded', () => {
  AdminApp.init();
});
