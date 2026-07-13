/* Superadmin Platform Owner Portal Logic (admin.js) */

const CATEGORY_EMOJIS = {
  comidas: ['🍔', '🍕', '🌯', '🫓', '🌽', '🍞', '🥖', '🍣', '🌮', '🍜', '🍰', '☕'],
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
    this.addNewProductRow();
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
          const res = await fetch('/api/establishments');
          this.establishments = await res.json();
          await this.loadOrders();
          
          // UI transitions
          document.getElementById('login-gate').classList.add('hidden');
          document.getElementById('admin-panel').classList.remove('hidden');
          
          this.renderTable();
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
        <td class="shop-title-cell" style="font-weight: 700;">${est.logo || '🏪'} ${est.name}</td>
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
    document.getElementById('edit-shop-delivery').value = est.delivery_fee || 0;
    document.getElementById('edit-shop-banner').value = est.banner || '';
    document.getElementById('edit-shop-theme').value = est.themeColor || '#FF5E3A';

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

    const name = document.getElementById('edit-shop-name').value.trim();
    const description = document.getElementById('edit-shop-description').value.trim();
    const logo = document.getElementById('edit-shop-logo').value;
    const delivery_fee = document.getElementById('edit-shop-delivery').value;
    const banner = document.getElementById('edit-shop-banner').value.trim();
    const themeColor = document.getElementById('edit-shop-theme').value;

    const payload = {
      isOwner: true,
      name,
      description,
      logo,
      delivery_fee,
      banner,
      themeColor
    };

    try {
      const res = await fetch(`/api/establishments/${this.activeShopId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        this.showToast('✅ Cambios guardados con éxito.');
        this.closeEditShopModal();
        await this.reloadData();
      } else {
        alert('Error al guardar los cambios.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de red al guardar los cambios.');
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
      } else {
        const data = await response.json();
        alert('Error al eliminar establecimiento: ' + (data.error || 'Problema desconocido'));
      }
    } catch (err) {
      console.error(err);
      alert('Error de red al eliminar el establecimiento.');
    }
  }

  async reloadData() {
    try {
      const res = await fetch('/api/establishments');
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
    if (rows.length <= 1) {
      alert('Debes incluir al menos un producto.');
      return;
    }
    const target = rows.find(r => parseInt(r.dataset.index, 10) === index);
    if (target) {
      container.removeChild(target);
    }
  }

  async handleRegisterSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('reg-name').value.trim();
    const category = document.getElementById('reg-category').value;
    const description = document.getElementById('reg-description').value.trim();
    const logo = document.getElementById('reg-logo-select').value;
    const bannerType = document.getElementById('reg-banner-type').value;
    const linkKey = document.getElementById('reg-link-key').value.trim().toUpperCase();

    let banner = '';
    if (bannerType === 'gradient') {
      banner = document.querySelector('input[name="reg-gradient"]:checked').value;
    } else {
      banner = document.getElementById('reg-banner-image').value.trim() || 'linear-gradient(135deg, #1D2671, #C33764)';
    }

    // Parse products
    const productRows = document.querySelectorAll('.reg-product-row');
    const products = [];
    productRows.forEach((row, i) => {
      const prodName = row.querySelector('.prod-name').value.trim();
      const prodPrice = parseFloat(row.querySelector('.prod-price').value);
      const prodDesc = row.querySelector('.prod-desc').value.trim();
      
      products.push({
        id: `p-${Date.now()}-${i}`,
        name: prodName,
        price: prodPrice,
        description: prodDesc,
        image: DEFAULT_IMAGES[category]
      });
    });

    const payload = {
      name,
      category,
      description,
      logo,
      bannerType,
      banner,
      linkKey,
      products
    };

    try {
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
        this.addNewProductRow();
        this.generateRandomLinkKey();

        // Reload data from api
        await this.reloadData();
      } else {
        alert('Error al registrar establecimiento.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al servidor.');
    }
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
}

const AdminApp = new AdminController();
window.AdminApp = AdminApp;

document.addEventListener('DOMContentLoaded', () => {
  AdminApp.init();
});
