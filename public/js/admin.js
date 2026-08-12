/* Superadmin Platform Owner Portal Logic (admin.js) */

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

class AdminController {
  constructor() {
    this.establishments = [];
    this.orders = [];
    this.isAuthenticated = false;
  }

  async init() {
    this.initModalHistoryNavigation();
    this.populateLogoSelect('comidas');
    this.generateRandomLinkKey();

    // Check if Google OAuth session is active
    await this.checkSupabaseSession();

    // Silent login check (legacy) if not authenticated via Google
    if (!this.isAuthenticated) {
      const savedPass = localStorage.getItem('owner_password');
      if (savedPass) {
        await this.login(savedPass);
      }
    }
  }

  async processOwnerSession(user) {
    if (!user || this.isAuthenticated) return;
    this.isAuthenticated = true;

    try {
      const res = await fetch('/api/owner/establishments');
      this.establishments = await res.json();
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
      alert('⚠️ El cliente de autenticación no está listo.');
      return;
    }
    
    try {
      await SupabaseApp.init();
      if (!SupabaseApp.client) {
        const autoPass = prompt('⚠️ Supabase Google OAuth no está configurado en las variables de entorno del servidor. Ingresa la Clave Maestra de Dueño:');
        if (autoPass) {
          await this.login(autoPass);
        }
        return;
      }
      await SupabaseApp.loginWithGoogle('/admin.html');
    } catch (err) {
      console.error(err);
      alert('Error al conectar con Google OAuth: ' + (err.message || err));
    }
  }

  async login(customPassword = null) {
    const password = (typeof customPassword === 'string' && customPassword)
      ? customPassword
      : (document.getElementById('admin-pass')?.value || '').trim();

    if (!password) {
      alert('⚠️ Por favor ingresa la clave de dueño.');
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
        this.establishments = data.establishments || [];

        localStorage.setItem('is_platform_owner', 'true');
        localStorage.setItem('owner_password', password);

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
        this.showToast('👑 Acceso de Dueño verificado con éxito');
        
        const warningBanner = document.getElementById('backup-warning-banner');
        if (warningBanner) warningBanner.classList.remove('hidden');
      } else {
        if (errorMsg) errorMsg.classList.remove('hidden');
        localStorage.removeItem('owner_password');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al servidor.');
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
    this.isAuthenticated = false;
    this.establishments = [];
    this.orders = [];
    localStorage.removeItem('is_platform_owner');
    localStorage.removeItem('owner_password');

    if (typeof SupabaseApp !== 'undefined') {
      await SupabaseApp.logout();
    }

    document.getElementById('admin-pass').value = '';
    document.getElementById('login-gate').classList.remove('hidden');
    document.getElementById('admin-panel').classList.add('hidden');
  }

  renderTable() {
    this.renderAnalyticsPro();
    const tbody = document.getElementById('keys-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

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
            <span style="font-size: 11px; font-weight: 700; color: #FFF;">⏱️ ${timeAgoStr}</span>
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
        ? `<span style="background: rgba(239, 68, 68, 0.2); color: #EF4444; border: 1px solid #EF4444; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800; margin-left: 6px;">🚫 DESHABILITADO</span>`
        : '';

      row.innerHTML = `
        <td class="shop-title-cell" style="font-weight: 700;">
          ${est.logo || '🏪'} ${est.name} ${disabledBadge}
          <div style="margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">📍 ${est.location || 'San Antonio'}</span>
            <button type="button" onclick="event.stopPropagation(); AdminApp.openStoreMapSingle('${est.id}')" style="background: rgba(16, 185, 129, 0.12); color: #059669; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;">
              🗺️ GPS
            </button>
          </div>
        </td>
        <td><span class="shop-category-cell">${est.category}</span></td>
        <td style="font-weight: 600;">${ordersCount}</td>
        <td>${lastOrderHTML}</td>
        <td style="font-weight: 700; color: var(--primary);">${this.formatPesos(totalRevenue)}</td>
        <td class="shop-key-cell" style="font-family: monospace; font-size: 13px; font-weight: 700;">${est.linkKey}</td>
        <td style="text-align: center; white-space: nowrap;">
          <button class="btn-goto-kitchen" onclick="event.stopPropagation(); AdminApp.openStoreMapSingle('${est.id}')" style="background-color: #E0E7FF; color: #3730A3; border: 1px solid #A5B4FC; font-size: 12px; padding: 6px 10px; border-radius: var(--radius-sm); font-weight: 700; margin: 0 2px; width: auto; display: inline-block; cursor: pointer;">
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
            <td style="font-weight: 800; color: #FFF;">🛵 ${d.name}</td>
            <td>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 12px; font-weight: 700; color: #E2E8F0;">📱 ${d.phone}</span>
                <a href="${waLink}" target="_blank" style="background: rgba(37,211,102,0.18); color: #25D366; border: 1px solid rgba(37,211,102,0.4); font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 6px; text-decoration: none; display: inline-flex; align-items: center; gap: 3px;" title="Chat directo por WhatsApp">
                  💬 Chat
                </a>
              </div>
            </td>
            <td style="font-size: 12px;">${d.vehicleType || 'Moto 🛵'}</td>
            <td style="font-family: monospace; font-size: 13px; font-weight: 800; color: #10B981;">${d.linkKey}</td>
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

    const modal = document.getElementById('est-action-modal');
    if (modal) modal.classList.add('active');
    this.checkModalOpenState();
  }

  closeEstActionModal() {
    const modal = document.getElementById('est-action-modal');
    if (modal) modal.classList.remove('active');
    this.checkModalOpenState();
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
        await this.triggerCloudBackup();
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
        await this.triggerCloudBackup();
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

    // Initialize Layout Grid & Catalog
    this.renderFloorGrid();
    this.loadModalProducts();
    this.loadModalImportCatalog();
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
    const canvas = document.getElementById('floor-grid-canvas');
    if (!canvas) return;

    const est = this.establishments.find(e => e.id === window.activeShopIdForMenu);
    if (!est) return;

    const layout = est.layout || [];
    canvas.innerHTML = '';

    // Render a 10x10 floor grid
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell-item';
        
        // Find if cell contains anything
        const item = layout.find(item => item.x === x && item.y === y);

        // Core Neumorphic styling for grid cells
        cell.style.width = '100%';
        cell.style.height = '100%';
        cell.style.transition = 'all 0.15s ease';
        cell.style.display = 'flex';
        cell.style.flexDirection = 'column';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.borderRadius = '6px';
        cell.style.fontSize = '12px';
        cell.style.cursor = 'pointer';

        if (item) {
          if (item.type === 'wall') {
            cell.style.background = '#374151';
            cell.style.border = '1px solid rgba(255,255,255,0.1)';
            cell.innerHTML = '<span style="font-size: 14px;">🧱</span>';
          } else if (item.type === 'table') {
            cell.style.background = 'var(--accent)';
            cell.style.border = '1px solid var(--accent)';
            cell.style.color = '#121216';
            cell.style.fontWeight = '900';
            cell.innerHTML = `<span style="font-size: 11px; line-height: 1;">🪑</span><span style="font-size: 8.5px; margin-top: 1px; font-weight:800;">#${item.number}</span>`;
          }
        } else {
          cell.style.background = 'rgba(255,255,255,0.02)';
          cell.style.border = '1px solid rgba(255,255,255,0.04)';
          
          // Subtle hover state
          cell.onmouseover = () => { cell.style.background = 'rgba(255,255,255,0.06)'; };
          cell.onmouseout = () => { cell.style.background = 'rgba(255,255,255,0.02)'; };
        }

        cell.onclick = () => this.handleCellClick(x, y);
        canvas.appendChild(cell);
      }
    }
  }

  async handleCellClick(x, y) {
    const est = this.establishments.find(e => e.id === window.activeShopIdForMenu);
    if (!est) return;

    if (!est.layout) est.layout = [];

    // Filter out existing element at coordinates
    est.layout = est.layout.filter(item => !(item.x === x && item.y === y));

    if (this.activeFloorTool === 'wall') {
      est.layout.push({ x, y, type: 'wall' });
    } else if (this.activeFloorTool === 'table') {
      // Calculate max table number to set next sequential number
      const maxNum = est.layout.filter(c => c.type === 'table').reduce((max, c) => Math.max(max, c.number || 0), 0);
      const number = maxNum + 1;
      est.layout.push({ x, y, type: 'table', number });
    }

    // Auto-save layout updates to db.json
    try {
      const res = await fetch(`/api/establishments/${est.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isOwner: true,
          layout: est.layout,
          // Sync legacy tables array from tables defined in layout grid
          tables: est.layout
            .filter(item => item.type === 'table')
            .map(item => ({
              id: `t-${item.number}`,
              name: `Mesa ${item.number}`,
              number: item.number,
              status: 'Disponible'
            }))
        })
      });

      if (res.ok) {
        this.renderFloorGrid();
        await this.triggerCloudBackup();
      } else {
        console.error('Failed to save layout to server');
      }
    } catch (err) {
      console.error(err);
    }
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
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 4px;">
          <span style="color: var(--accent); font-weight: 700; font-size: 12px;">$${parseFloat(prod.price).toFixed(2)}</span>
          <button type="button" onclick="event.stopPropagation(); event.preventDefault(); AdminApp.deleteProductFromModal('${prod.id}')" style="background: #EF4444; border: none; border-radius: 50%; color: #fff; width: 32px; height: 32px; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800; box-shadow: 0 2px 6px rgba(239, 68, 68, 0.4); transition: transform 0.1s; -webkit-tap-highlight-color: transparent;" title="Eliminar producto">✕</button>
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
        await this.triggerCloudBackup();
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
        await this.triggerCloudBackup();
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
        await this.triggerCloudBackup();
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
        await this.triggerCloudBackup();
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
        await this.triggerCloudBackup();
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
      const res = await fetch('/api/owner/establishments');
      this.establishments = await res.json();
      if (Array.isArray(this.establishments)) {
        let disabledMap = {};
        try {
          disabledMap = JSON.parse(localStorage.getItem('pedigochos_disabled_stores') || '{}');
        } catch(e) {}
        this.establishments.forEach(est => {
          if (disabledMap[est.id] !== undefined) {
            est.disabled = Boolean(disabledMap[est.id]);
          } else {
            est.disabled = Boolean(est.disabled);
          }
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
        await this.triggerCloudBackup();
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
    const est = this.establishments.find(e => e.id === window.activeShopIdForMenu);
    if (!est) return;

    const prod = est.products.find(p => p.id === productId);
    if (!prod) return;

    this.activeSpecsProductId = productId;
    
    // Set title
    document.getElementById('specs-modal-title').innerText = `⚙️ Especificaciones: ${prod.name}`;
    document.getElementById('specs-product-id').value = productId;

    // Load general product details
    document.getElementById('specs-product-name').value = prod.name || '';
    document.getElementById('specs-product-category').value = prod.category || '';
    document.getElementById('specs-product-price').value = prod.price !== undefined ? prod.price : '';
    document.getElementById('specs-product-description').value = prod.description || '';

    // Load exclusions / ingredients
    this.specsIngredients = prod.exclusions ? prod.exclusions.map(e => ({
      name: e.name,
      price: e.price !== undefined ? e.price : 500
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
        await this.triggerCloudBackup();
      } else {
        alert('Error al guardar especificaciones.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión.');
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
        this.showToast('❌ Error al guardar el respaldo en la nube.');
      } else {
        console.log('🎉 Cloud backup of db.json completed successfully!');
        this.showToast('☁️ Respaldo en la nube guardado con éxito.');
      }
    } catch (err) {
      console.error('Error during cloud backup:', err);
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
        try {
          let disabledMap = JSON.parse(localStorage.getItem('pedigochos_disabled_stores') || '{}');
          disabledMap[id] = newDisabledState;
          localStorage.setItem('pedigochos_disabled_stores', JSON.stringify(disabledMap));
        } catch(e) {}

        this.showToast(`✅ Comercio "${est.name}" ${newDisabledState ? 'deshabilitado' : 'habilitado'} con éxito.`);
        this.closeEstActionModal();
        await this.reloadData();
        await this.triggerCloudBackup();
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

    this.openAllStoresMapModal();
    setTimeout(() => {
      if (this.globalMap) {
        let lat = est.latitude ? parseFloat(est.latitude) : 7.8145;
        let lng = est.longitude ? parseFloat(est.longitude) : -72.4430;
        if (!est.latitude || !est.longitude) {
          if ((est.location || '').includes('Ureña')) {
            lat = 7.9170; lng = -72.4400;
          } else if ((est.location || '').includes('Cristóbal')) {
            lat = 7.7669; lng = -72.2250;
          }
        }
        this.globalMap.setView([lat, lng], 16);
        const item = (this.globalMapMarkers || []).find(m => String(m.estId) === String(est.id));
        if (item && item.marker) item.marker.openPopup();
      }
    }, 400);
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

    this.showToast(`📡 Guardando nueva ubicación exacta de "${est.name}" en la nube...`);

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
        this.showToast(`✅ ¡Ubicación de "${est.name}" fijada y guardada en la nube con éxito!`);
        await this.triggerCloudBackup();
        this.initAdminGlobalStoresMap(this.currentGlobalMapFilter || 'all');
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
        await this.triggerCloudBackup();
        this.initAdminGlobalStoresMap(this.currentGlobalMapFilter || 'all');
      } else {
        this.showToast('⚠️ Error al eliminar el marcador en el servidor.');
      }
    } catch(err) {
      console.error('Error removing store GPS position:', err);
      this.showToast('⚠️ Error de conexión al eliminar el marcador GPS.');
    }
  }

  initAdminGlobalStoresMap(filterLoc = 'all') {
    this.currentGlobalMapFilter = filterLoc;
    const container = document.getElementById('admin-global-stores-map');
    if (!container || typeof L === 'undefined') return;

    if (this.globalMap) {
      this.globalMap.remove();
      this.globalMap = null;
    }
    this.globalMapMarkers = [];

    let centerLat = 7.8145;
    let centerLng = -72.4430;

    let targetEsts = this.establishments || [];
    if (filterLoc !== 'all') {
      targetEsts = targetEsts.filter(e => (e.location || 'San Antonio').toLowerCase().includes(filterLoc.toLowerCase()));
    }

    // Filter duplicates by ID and by normalized Name to guarantee unique markers on map
    const seenEstIds = new Set();
    const seenEstNames = new Set();
    const uniqueTargetEsts = [];

    (targetEsts || []).forEach(est => {
      if (!est || !est.id) return;
      const sId = String(est.id).trim();
      const normName = (est.name || '').trim().toLowerCase();
      if (!seenEstIds.has(sId) && (!normName || !seenEstNames.has(normName))) {
        seenEstIds.add(sId);
        if (normName) seenEstNames.add(normName);
        uniqueTargetEsts.push(est);
      }
    });

    targetEsts = uniqueTargetEsts;

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

    const statsText = document.getElementById('admin-map-stats-text');
    if (statsText) {
      statsText.innerHTML = `<span>📡</span> <span>Locales con GPS Registrado: <strong>${estsWithGPS.length}</strong> / <strong>${targetEsts.length}</strong> Comercios</span>`;
    }

    const bounds = L.latLngBounds();
    const usedCoords = new Set();

    targetEsts.forEach((est, idx) => {
      let lat = est.latitude ? parseFloat(est.latitude) : null;
      let lng = est.longitude ? parseFloat(est.longitude) : null;

      if (!lat || !lng) {
        const offsetLat = (idx % 5 - 2) * 0.004;
        const offsetLng = (Math.floor(idx / 5) - 2) * 0.004;
        if ((est.location || '').includes('Ureña')) {
          lat = 7.9170 + offsetLat;
          lng = -72.4400 + offsetLng;
        } else if ((est.location || '').includes('Cristóbal')) {
          lat = 7.7669 + offsetLat;
          lng = -72.2250 + offsetLng;
        } else {
          lat = 7.8145 + offsetLat;
          lng = -72.4430 + offsetLng;
        }
      }

      // Slightly offset if two different stores have identical lat/lng coordinates
      let coordKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      let jitterCount = 0;
      while (usedCoords.has(coordKey) && jitterCount < 10) {
        jitterCount++;
        lat += 0.00018;
        lng += 0.00018;
        coordKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      }
      usedCoords.add(coordKey);

      bounds.extend([lat, lng]);

      const emojiIcon = L.divIcon({
        className: 'custom-admin-store-pin',
        html: `
          <div style="background: ${est.disabled ? '#EF4444' : '#10B981'}; color: #FFF; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border: 2px solid #FFFFFF;">
            ${est.logo || '🏪'}
          </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19]
      });

      const buildPopupHTML = (e, currentLat, currentLng) => {
        const gmapsLink = `https://www.google.com/maps/search/?api=1&query=${currentLat},${currentLng}`;
        const hasSavedGPS = Boolean(e.latitude && e.longitude);
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
              ${hasSavedGPS ? '<span style="background: #DBEAFE; color: #1E40AF; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 10px;">📡 GPS FIJO</span>' : '<span style="background: #FEF3C7; color: #92400E; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 10px;">⚠️ SIN GPS REGISTRADO</span>'}
            </div>
            <p style="font-size: 10.5px; color: #475569; margin: 4px 0 8px 0; line-height: 1.3; background: #F1F5F9; padding: 6px; border-radius: 6px;">
              📌 Arrastra este pin a la ubicación deseada y presiona el botón verde para guardar en la nube.
            </p>
            <button onclick="AdminApp.saveStoreGPS('${e.id}')" style="display: block; width: 100%; text-align: center; background: #10B981; color: #FFFFFF; font-weight: 800; font-size: 11px; padding: 7px 10px; border-radius: 8px; border: none; cursor: pointer; margin-bottom: 6px; box-shadow: 0 2px 6px rgba(16,185,129,0.3); box-sizing: border-box;">
              💾 Guardar Ubicación GPS
            </button>
            ${hasSavedGPS ? `
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

      marker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        const newLat = parseFloat(pos.lat.toFixed(6));
        const newLng = parseFloat(pos.lng.toFixed(6));

        marker.setPopupContent(buildPopupHTML(est, newLat, newLng));
        marker.openPopup();
        this.showToast(`📌 Pin movido. Presiona "💾 Guardar Esta Ubicación GPS" en la burbuja para confirmar.`);
      });

      this.globalMapMarkers.push({ estId: est.id, marker });
    });

    if (targetEsts.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  filterGlobalMapLocation(loc) {
    this.initAdminGlobalStoresMap(loc);
  }

  initEditShopGPSMap(est) {
    const container = document.getElementById('edit-shop-gps-map');
    if (!container || typeof L === 'undefined') return;

    if (this.editShopMap) {
      this.editShopMap.remove();
      this.editShopMap = null;
    }

    let lat = est.latitude ? parseFloat(est.latitude) : 7.8145;
    let lng = est.longitude ? parseFloat(est.longitude) : -72.4430;

    const latInp = document.getElementById('edit-shop-latitude');
    const lngInp = document.getElementById('edit-shop-longitude');
    if (latInp) latInp.value = est.latitude !== undefined && est.latitude !== null ? est.latitude : '';
    if (lngInp) lngInp.value = est.longitude !== undefined && est.longitude !== null ? est.longitude : '';

    const map = L.map('edit-shop-gps-map').setView([lat, lng], 15);
    this.editShopMap = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

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

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log('👑 Admin Owner App connecting to WebSocket:', wsUrl);
    this.ws = new WebSocket(wsUrl);

    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 20000);

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
      setTimeout(() => this.initWebSocket(), 5000);
    };
  }

  requestNotificationPermission() {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        this.showToast('🔔 Notificaciones de escritorio ya están activadas.');
      } else if (Notification.permission === 'denied') {
        alert('⚠️ Las notificaciones están bloqueadas en tu navegador.\n\nPara activarlas: haz clic en el icono del candado 🔒 junto a la URL en tu navegador y activa la casilla "Notificaciones".');
      } else {
        try {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              this.showToast('✅ ¡Notificaciones de escritorio activadas exitosamente!');
            }
          }).catch(() => {});
        } catch(e) {}
      }
    } else {
      alert('⚠️ Tu navegador no soporta notificaciones de escritorio.');
    }
  }

  playOrderNotification(order) {
    // 1. Play loud multi-tone audio alarm
    if (typeof Sound !== 'undefined' && Sound.playOrderAlarm) {
      Sound.playOrderAlarm();
    } else if (typeof Sound !== 'undefined' && Sound.playBell) {
      Sound.playBell();
    }

    const est = this.establishments.find(e => e.id === order.establishmentId || e.id === order.establishment_id);
    const storeName = est ? est.name : 'Restaurante';
    const customerName = order.customerName || order.deliveryDetails?.name || 'Cliente';
    const orderCode = order.deliveryDetails?.code || (order.id ? order.id.slice(-4) : '####');
    const orderTotal = order.total !== undefined ? `$${parseFloat(order.total).toFixed(2)}` : '';
    const orderType = order.orderType === 'mesa' ? '🍽️ Mesa ' + (order.mesaNumber || order.deliveryDetails?.mesa || '') : '🚴 Delivery';

    // 2. Native OS Push Notification
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`🚨 ¡NUEVO PEDIDO RECIBIDO! #${orderCode}`, {
          body: `🏪 ${storeName}\n👤 ${customerName} (${orderType})\n💰 Total: ${orderTotal}`,
          icon: '/icons/icon-192.png',
          tag: 'order-' + order.id,
          requireInteraction: true
        });
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

    const orderCode = order.deliveryDetails?.code || (order.id ? order.id.slice(-4) : '####');
    const customerName = order.customerName || order.deliveryDetails?.name || 'Cliente';
    const phone = order.customerPhone || order.deliveryDetails?.phone || 'Sin teléfono';
    const address = order.deliveryDetails?.address || order.deliveryDetails?.mesa || 'Sin dirección';
    const total = order.total !== undefined ? parseFloat(order.total).toFixed(2) : '0.00';
    const items = order.items || [];

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 440px; border-radius: 24px; border: 2px solid var(--primary); background: #111827; box-shadow: 0 0 35px rgba(255, 94, 58, 0.4); animation: scaleIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
        <div style="background: linear-gradient(135deg, #FF5E3A 0%, #FF2A00 100%); color: #FFF; padding: 18px 20px; border-radius: 22px 22px 0 0; text-align: center; position: relative;">
          <span style="font-size: 36px; display: block; margin-bottom: 4px;">🔔</span>
          <h3 style="margin: 0; font-size: 18px; font-weight: 800;">¡NUEVO PEDIDO RECIBIDO!</h3>
          <span style="background: rgba(0,0,0,0.25); padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 800;">Código #${orderCode}</span>
        </div>
        <div style="padding: 20px; color: #FFF;">
          <div style="background: rgba(255,255,255,0.05); border-radius: 14px; padding: 12px 16px; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.08);">
            <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 800; color: #FFD700;">🏪 ${storeName}</p>
            <p style="margin: 0 0 4px 0; font-size: 13px;">👤 <strong>Cliente:</strong> ${customerName}</p>
            <p style="margin: 0 0 4px 0; font-size: 13px;">📞 <strong>Teléfono:</strong> ${phone}</p>
            <p style="margin: 0; font-size: 13px;">📍 <strong>Ubicación/Mesa:</strong> ${address}</p>
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
          <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255, 94, 58, 0.15); border: 1px solid var(--primary); padding: 12px 16px; border-radius: 14px; margin-bottom: 18px;">
            <span style="font-size: 14px; font-weight: 700;">Total del Pedido:</span>
            <span style="font-size: 20px; font-weight: 800; color: #FFD700;">$${total}</span>
          </div>
          <button type="button" onclick="document.getElementById('admin-new-order-modal').style.display='none'" class="btn-primary" style="width: 100%; padding: 12px; font-size: 14px; font-weight: 800; border-radius: 14px; cursor: pointer; background: linear-gradient(135deg, #FF5E3A 0%, #FF2A00 100%); border: none; color: #FFF;">
            ✅ Entendido / Cerrar Alerta
          </button>
        </div>
      </div>
    `;
    modal.style.display = 'flex';
  }
}

const AdminApp = new AdminController();
window.AdminApp = AdminApp;

document.addEventListener('DOMContentLoaded', () => {
  AdminApp.init();
});
