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
  ferreterias: '/images/destornilladores.jpg'
};

class AdminController {
  constructor() {
    this.establishments = [];
    this.orders = [];
    this.isAuthenticated = false;
  }

  async init() {
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

  async checkSupabaseSession() {
    if (typeof SupabaseApp === 'undefined') return;
    await SupabaseApp.init();
    const session = await SupabaseApp.getCurrentSession();
    
    if (session && session.user) {
      const user = session.user;
      const roleData = await SupabaseApp.getUserRole(user.email);
      
      if (roleData && roleData.role === 'owner') {
        this.isAuthenticated = true;
        
        // Load all establishments and orders
        try {
          const res = await fetch('/api/owner/establishments');
          this.establishments = await res.json();
          await this.loadOrders();
          
          // UI transitions
          document.getElementById('login-gate').classList.add('hidden');
          document.getElementById('admin-panel').classList.remove('hidden');
          
          const warningBanner = document.getElementById('backup-warning-banner');
          if (warningBanner) warningBanner.classList.add('hidden');
          
          this.renderTable();
          this.initPresence(user.email);
          this.showToast('👑 Acceso de Dueño verificado con Google');
        } catch (err) {
          console.error(err);
          alert('Error de conexión al cargar los datos.');
        }
      } else {
        alert('Tu cuenta de Google (' + user.email + ') no tiene permisos de Dueño de la Plataforma (owner).');
        await SupabaseApp.logout();
      }
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
    if (typeof SupabaseApp === 'undefined') return;
    await SupabaseApp.loginWithGoogle();
  }

  async login(customPassword = null) {
    const password = customPassword || document.getElementById('admin-pass').value.trim();
    if (!password) {
      alert('Introduce la contraseña.');
      return;
    }

    const errorMsg = document.getElementById('login-error');
    errorMsg.classList.add('hidden');

    try {
      const response = await fetch('/api/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (response.ok) {
        const data = await response.json();
        this.isAuthenticated = true;
        this.establishments = data.establishments;

        localStorage.setItem('is_platform_owner', 'true');
        localStorage.setItem('owner_password', password);

        // Load orders for statistics
        await this.loadOrders();

        // UI transitions
        document.getElementById('login-gate').classList.add('hidden');
        document.getElementById('admin-panel').classList.remove('hidden');

        // Render data
        this.renderTable();
        this.showToast('👑 Acceso de Dueño verificado con éxito');
        
        const warningBanner = document.getElementById('backup-warning-banner');
        if (warningBanner) warningBanner.classList.remove('hidden');
      } else {
        if (!customPassword) {
          errorMsg.classList.remove('hidden');
        } else {
          this.logout();
        }
      }
    } catch (e) {
      console.error(e);
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
    const tbody = document.getElementById('keys-table-body');
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
      const estOrders = this.orders.filter(o => o.establishmentId === est.id);
      const ordersCount = estOrders.length;
      const totalRevenue = estOrders.reduce((sum, o) => sum + (o.total || 0), 0);

      const row = document.createElement('tr');
      row.style.cursor = 'pointer';
      row.onclick = () => AdminApp.showEstablishmentActions(est.id);

      row.innerHTML = `
        <td class="shop-title-cell" style="font-weight: 700;">
          ${est.logo || '🏪'} ${est.name}
          <span style="font-size: 11px; color: var(--text-muted); display: block; margin-top: 4px; font-weight: normal;">📍 ${est.location || 'San Antonio'}</span>
        </td>
        <td><span class="shop-category-cell">${est.category}</span></td>
        <td style="font-weight: 600;">${ordersCount}</td>
        <td style="font-weight: 700; color: var(--primary);">${this.formatPesos(totalRevenue)}</td>
        <td class="shop-key-cell" style="font-family: monospace; font-size: 13px; font-weight: 700;">${est.linkKey}</td>
        <td style="text-align: center;">
          <button class="btn-goto-kitchen" onclick="event.stopPropagation(); AdminApp.deleteEstablishment('${est.id}', '${est.name}')" style="background-color: #FEE2E2; color: #991B1B; border: 1px solid #FCA5A5; font-size: 12px; padding: 6px 12px; border-radius: var(--radius-sm); font-weight: 700; margin: 0; width: auto; display: inline-block; cursor: pointer;">
            🗑️ Eliminar
          </button>
        </td>
      `;
      tbody.appendChild(row);
    });
  }

  showEstablishmentActions(id) {
    const est = this.establishments.find(e => e.id === id);
    if (!est) return;

    this.activeShopId = id;
    const nameEl = document.getElementById('action-modal-shop-name');
    if (nameEl) nameEl.innerText = `${est.logo || '🏪'} ${est.name}`;

    document.getElementById('est-action-modal').classList.add('active');
  }

  closeEstActionModal() {
    document.getElementById('est-action-modal').classList.remove('active');
  }

  viewShopMenu() {
    if (!this.activeShopId) return;
    this.closeEstActionModal();
    window.open(window.location.origin + '/?shop=' + this.activeShopId, '_blank');
  }

  openEditShopModal() {
    if (!this.activeShopId) return;
    const est = this.establishments.find(e => e.id === this.activeShopId);
    if (!est) return;

    this.closeEstActionModal();

    document.getElementById('edit-shop-id').value = est.id;
    document.getElementById('edit-shop-name').value = est.name;
    document.getElementById('edit-shop-description').value = est.description || '';
    document.getElementById('edit-shop-location').value = est.location || 'San Antonio';
    document.getElementById('edit-shop-delivery').value = est.delivery_fee || 0;
    const bannerInput = document.getElementById('edit-shop-banner');
    if (bannerInput) bannerInput.value = est.banner || '';
    document.getElementById('edit-shop-theme').value = est.themeColor || '#FF5E3A';

    // Show preparation & delivery times only for comidas category
    const timesGroup = document.getElementById('edit-shop-times-group');
    const prepInput = document.getElementById('edit-shop-prep-time');
    const deliveryTimeInput = document.getElementById('edit-shop-delivery-time');

    if (est.category === 'comidas') {
      timesGroup.classList.remove('hidden');
      prepInput.value = est.prep_time || '';
      deliveryTimeInput.value = est.delivery_time || '';
    } else {
      timesGroup.classList.add('hidden');
      prepInput.value = '';
      deliveryTimeInput.value = '';
    }

    const select = document.getElementById('edit-shop-logo');
    select.innerHTML = '';
    const emojis = CATEGORY_EMOJIS[est.category] || ['🏪'];
    emojis.forEach(emoji => {
      const opt = document.createElement('option');
      opt.value = emoji;
      opt.innerText = `${emoji} Icono`;
      if (emoji === est.logo) opt.selected = true;
      select.appendChild(opt);
    });

    // Populate global catalog dropdown for product imports
    const importSelect = document.getElementById('import-product-select');
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

    document.getElementById('edit-est-modal').classList.add('active');

    // Also select this shop dynamically in the Menu Builder below
    if (typeof window.activeShopIdForMenu !== 'undefined') {
      window.activeShopIdForMenu = est.id;
      const builderTitle = document.getElementById('menu-builder-shop-name');
      if (builderTitle) builderTitle.innerText = `🍔 Creador de Menú: ${est.name}`;
      if (typeof window.loadProducts === 'function') {
        window.loadProducts();
      }
    }
  }

  closeEditShopModal() {
    document.getElementById('edit-est-modal').classList.remove('active');
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
        prep_time: prep_time ? parseInt(prep_time) : null,
        delivery_time: delivery_time ? parseInt(delivery_time) : null
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
    document.getElementById('menu-tables-modal').classList.add('active');

    // Initialize Layout Grid & Catalog
    this.renderFloorGrid();
    this.loadModalProducts();
    this.loadModalImportCatalog();
  }

  closeMenuTablesModal() {
    document.getElementById('menu-tables-modal').classList.remove('active');
    this.closeProductSpecsModal();
    this.reloadData();
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
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto;">
          <span style="color: var(--accent); font-weight: 700; font-size: 11px;">$${parseFloat(prod.price).toFixed(2)}</span>
          <button onclick="event.stopPropagation(); deleteProductFromModal('${prod.id}')" style="background: rgba(239, 68, 68, 0.9); border: none; border-radius: 50%; color: #fff; width: 20px; height: 20px; font-size: 9px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 700;">✕</button>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  async loadModalImportCatalog() {
    const importSelect = document.getElementById('modal-import-product-select');
    if (!importSelect) return;

    importSelect.innerHTML = `<option value="">Cargando...</option>`;
    
    if (typeof MenuBuilder !== 'undefined' && MenuBuilder.supabase) {
      try {
        const { data, error } = await MenuBuilder.supabase
          .from('products')
          .select('*')
          .order('name', { ascending: true });
        
        if (error) throw error;
        this.globalProductsCache = data || [];
        importSelect.innerHTML = `<option value="">-- Selecciona --</option>`;
        this.globalProductsCache.forEach(prod => {
          const opt = document.createElement('option');
          opt.value = prod.id;
          opt.innerText = `${prod.name} ($${parseFloat(prod.price).toFixed(2)})`;
          importSelect.appendChild(opt);
        });
      } catch (err) {
        console.error(err);
        importSelect.innerHTML = `<option value="">Error cargando</option>`;
      }
    } else {
      importSelect.innerHTML = `<option value="">No disponible</option>`;
    }
  }

  async importGlobalProductFromModal() {
    const select = document.getElementById('modal-import-product-select');
    const prodId = select.value;
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
        select.value = '';
        this.loadModalProducts();
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
    if (!confirm('¿Seguro que deseas eliminar este producto de la carta del local?')) return;

    const est = this.establishments.find(e => e.id === window.activeShopIdForMenu);
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
        this.showToast('Producto eliminado del local.');
        this.loadModalProducts();
        await this.triggerCloudBackup();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async importNewProductToActiveShop(newProduct) {
    if (!window.activeShopIdForMenu) return;
    const est = this.establishments.find(e => e.id === window.activeShopIdForMenu);
    if (!est) return;

    if (!est.products) est.products = [];

    const newLocalProduct = {
      id: `p-${Date.now()}-${Math.floor(Math.random() * 100)}`,
      name: newProduct.name,
      price: parseFloat(newProduct.price),
      description: newProduct.description || '',
      image: newProduct.image_url,
      modifiers: newProduct.modifiers,
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
        this.loadModalImportCatalog();
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
        alert('Error al registrar establecimiento.');
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

    // Load exclusions / ingredients
    this.specsIngredients = prod.exclusions ? prod.exclusions.map(e => e.name) : [];
    this.renderSpecsIngredients();

    // Load modifier groups
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
      container.innerHTML = `<span style="font-size: 11.5px; color: var(--text-muted);">Sin ingredientes listados (se permiten todas las opciones por defecto)</span>`;
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
        <span onclick="AdminApp.removeIngredientOption(${idx})" style="cursor: pointer; color: #ef4444; font-weight: 900;">✕</span>
      `;
      container.appendChild(tag);
    });
  }

  addIngredientOption() {
    const input = document.getElementById('new-ingredient-input');
    const val = input.value.trim();
    if (!val) return;

    if (this.specsIngredients.includes(val)) {
      alert('Este ingrediente ya está listado.');
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

    // Filter exclusions
    prod.exclusions = this.specsIngredients.map((name, i) => ({
      id: `ex-${i}`,
      name: name
    }));

    // Save modifiers groups
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
}

const AdminApp = new AdminController();
window.AdminApp = AdminApp;

document.addEventListener('DOMContentLoaded', () => {
  AdminApp.init();
});
