/* Customer Marketplace App Logic */

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
  ferreterias: '/images/pack_frutas.jpg' // Falls back gracefully
};

const VERIFIED_STORE_GPS_MARKETPLACE = {
  'mak-pizza-1784350135697': { latitude: 7.8138, longitude: -72.4420 },
  'shawarma-dunes-1784412375653': { latitude: 7.8150, longitude: -72.4438 },
  'la-casa-de-los-batidos-1786157702318': { latitude: 7.8140, longitude: -72.4430 },
  'patacon-fire-1786157840794': { latitude: 7.8152, longitude: -72.4428 },
  'latinos-burguer-1786162629597': { latitude: 7.8160, longitude: -72.4450 },
  'm-ster-cachapa-1785973083758': { latitude: 7.8148, longitude: -72.4455 },
  'tanos-resto-bar-1786032587502': { latitude: 7.8145, longitude: -72.4435 },
  'sabor-venezolano-arepas-1784413922154': { latitude: 7.8135, longitude: -72.4432 },
  'carritos-de-manuel-1784411690116': { latitude: 7.8128, longitude: -72.4451 },
  'boby-burgers-1784410785941': { latitude: 7.8142, longitude: -72.4445 },
  'gema-pop-1785968399832': { latitude: 7.8122, longitude: -72.4435 },
  'frutyheladosgourmet-1786228530112': { latitude: 7.8130, longitude: -72.4425 },
  'zeus-burger-1786252888630': { latitude: 7.8158, longitude: -72.4430 },
  'boki-arepas-1784927442087': { latitude: 7.8155, longitude: -72.4440 },
  'burger-grill-puente-sucre--1784935634396': { latitude: 7.8172, longitude: -72.4425 },
  'muchos-burguer-1784912818841': { latitude: 7.8125, longitude: -72.4440 },
  'luchos-burguer-1784912818841': { latitude: 7.8125, longitude: -72.4440 },
  'makpizza': { latitude: 7.8138, longitude: -72.4420 },
  'shawarmadunes': { latitude: 7.8150, longitude: -72.4438 },
  'lacasadelosbatidos': { latitude: 7.8140, longitude: -72.4430 },
  'pataconfire': { latitude: 7.8152, longitude: -72.4428 },
  'latinosburguer': { latitude: 7.8160, longitude: -72.4450 },
  'mistercachapa': { latitude: 7.8148, longitude: -72.4455 },
  'mstercachapa': { latitude: 7.8148, longitude: -72.4455 },
  'tanosrestobar': { latitude: 7.8145, longitude: -72.4435 },
  'thanosrestobar': { latitude: 7.8145, longitude: -72.4435 },
  'saborvenezolanoarepas': { latitude: 7.8135, longitude: -72.4432 },
  'karritosdemanuel': { latitude: 7.8128, longitude: -72.4451 },
  'carritosdemanuel': { latitude: 7.8128, longitude: -72.4451 },
  'bobyburgers': { latitude: 7.8142, longitude: -72.4445 },
  'gemapop': { latitude: 7.8122, longitude: -72.4435 },
  'frutyheladosgourmet': { latitude: 7.8130, longitude: -72.4425 },
  'zeusburger': { latitude: 7.8158, longitude: -72.4430 },
  'bokiarepas': { latitude: 7.8155, longitude: -72.4440 },
  'burgergrillpuentesucre': { latitude: 7.8172, longitude: -72.4425 },
  'muchosburguer': { latitude: 7.8125, longitude: -72.4440 },
  'luchosburger': { latitude: 7.8125, longitude: -72.4440 }
};

class MarketplaceController {
  constructor() {
    this.establishments = [];
    this.currentCategory = 'comidas';
    this.selectedEstablishment = null;
    this.cart = {
      establishment: null,
      items: [] // { product, quantity }
    };
    this.orderType = 'delivery'; // 'delivery' or 'mesa'
    this.currentLocation = localStorage.getItem('selected_location') || 'San Antonio';
    
    // Leaflet map instance variables
    this.leafMap = null;
    this.leafMarker = null;
    this.selectedLatitude = null;
    this.selectedLongitude = null;
    this.calculatedDistanceKm = null;
    
    // Default location coordinates (fallback center coordinate zones)
    this.locationCenters = {
      'San Antonio': [7.8131, -72.4439],
      'Ureña': [7.9221, -72.4419],
      'San Cristóbal': [7.7667, -72.2292]
    };

    this.activeCoupon = null;
    this.gochoPoints = parseInt(localStorage.getItem('gocho_points') || '0', 10);
    this.currentCategory = null; // Default to no category selected on home entry
    this.paymentMethod = 'Efectivo'; // Default payment method: 'Efectivo' or 'Transferencia'
    this.isTrackingMinimized = false; // Whether active order tracking is minimized
  }

  async init() {
    // Clear any lingering redirect flag
    localStorage.removeItem('redirect_after_google_login');

    // Always reset URL query parameters so user enters clean Home view
    if (window.location.search || window.location.hash) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Set initial history state
    window.history.replaceState({ view: 'home' }, '');
    window.addEventListener('popstate', (e) => this.handlePopState(e));

    await this.loadSystemSettings();
    await this.loadEstablishments();
    await this.loadPromotions();
    this.initWebSocket();
    
    // Update active location display in header on startup
    const display = document.getElementById('active-location-display');
    if (display) display.innerText = this.currentLocation;

    this.currentCategory = null;
    window.activeFoodTypeFilter = null;
    
    // Remove active class from main category cards on entry
    document.querySelectorAll('.category-card-delivercity').forEach(card => {
      card.classList.remove('active');
    });

    this.renderEstablishments();
    this.updateCartBadge();
    await this.checkSupabaseSession();
    this.checkActiveOrderTracking();
    this.updateGochoPointsDisplay();
    this.initPushNotifications();
    this.initOfflineSync();

    // Show location selector tutorial if visiting for the first time
    if (!localStorage.getItem('location_tutorial_seen')) {
      setTimeout(() => {
        this.showLocationTutorial();
      }, 1000);
    }
  }

  initWebSocket() {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${protocol}//${window.location.host}`);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ESTABLISHMENT_UPDATED' && data.establishment) {
            const updated = data.establishment;
            const index = this.establishments.findIndex(e => e.id === updated.id);
            if (index !== -1) {
              this.establishments[index] = { ...this.establishments[index], ...updated };
              this.renderEstablishments();
              if (this.selectedEstablishment && this.selectedEstablishment.id === updated.id) {
                this.openEstablishment(updated.id);
              }
            }
          }
        } catch (e) {
          console.error(e);
        }
      };
    } catch (err) {
      console.error(err);
    }
  }

  async checkSupabaseSession() {
    if (typeof SupabaseApp === 'undefined') return;
    await SupabaseApp.init();
    const session = await SupabaseApp.getCurrentSession();
    const container = document.getElementById('auth-status-container');
    if (!container) return;

    if (session && session.user) {
      const user = session.user;
      container.innerHTML = `
        <span style="font-size: 12px; color: var(--text-main); font-weight: 700; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 4px;">
          👤 ${user.user_metadata.full_name || user.email.split('@')[0]}
        </span>
        <button class="btn-notification" onclick="MarketplaceApp.logout()" title="Cerrar Sesión" style="background: none; border: none; font-size: 16px; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; width: auto; height: auto; margin: 0;">
          🚪
        </button>
      `;
    } else {
      container.innerHTML = `
        <button class="btn-notification" onclick="MarketplaceApp.loginWithGoogle()" title="Iniciar Sesión" style="background-color: var(--primary); color: #fff; padding: 6px 12px; font-size: 12px; font-weight: 700; width: auto; height: auto; border-radius: 20px; box-shadow: 0 2px 5px rgba(255, 94, 58, 0.25);">
          🔑 Ingresar
        </button>
      `;
    }
  }

  async loginWithGoogle() {
    if (typeof SupabaseApp === 'undefined') return;
    await SupabaseApp.loginWithGoogle();
  }

  async logout() {
    if (typeof SupabaseApp === 'undefined') return;
    await SupabaseApp.logout();
    window.location.reload();
  }

  async loadEstablishments() {
    try {
      // Clear any stale localStorage disabled state - server disabled_stores.json is authoritative
      try { localStorage.removeItem('pedigochos_disabled_stores'); } catch(e) {}

      const res = await fetch('/api/establishments');
      this.establishments = await res.json();
      if (Array.isArray(this.establishments)) {
        this.establishments.forEach(est => {
          // Server already applies disabled_stores.json in readDB(), trust it directly
          est.disabled = Boolean(est.disabled);

          // Enforce immutable verified GPS
          const id = String(est.id || '').trim();
          const normName = (est.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
          const coords = VERIFIED_STORE_GPS_MARKETPLACE[id] || VERIFIED_STORE_GPS_MARKETPLACE[normName] || (est.latitude && est.longitude ? { latitude: est.latitude, longitude: est.longitude } : { latitude: 7.8145, longitude: -72.4430 });
          est.latitude = parseFloat(coords.latitude);
          est.longitude = parseFloat(coords.longitude);
          est.location_lat = est.latitude;
          est.location_lng = est.longitude;

          // Clear stale client localStorage GPS overrides
          try {
            localStorage.removeItem('store_gps_' + est.id);
          } catch(e) {}
        });
      }
    } catch (e) {
      console.error('Error fetching establishments:', e);
      this.showToast('Error de conexión al cargar comercios');
    }
  }

  async loadPromotions() {
    try {
      const res = await fetch('/api/promotions');
      const promos = await res.json();
      const container = document.getElementById('daily-promotions-container');
      const section = document.getElementById('daily-promotions-section');
      if (!container || !section) return;

      if (!Array.isArray(promos) || promos.length === 0) {
        section.classList.add('hidden');
        return;
      }

      const now = Date.now();
      container.innerHTML = promos.map(p => {
        const expiresMs = new Date(p.expiresAt || p.expires_at || (new Date(p.createdAt).getTime() + 24*60*60*1000)).getTime();
        const diffMs = Math.max(0, expiresMs - now);
        const hoursLeft = Math.floor(diffMs / (1000 * 60 * 60));
        const minsLeft = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        const origPrice = p.originalPrice || p.promoPrice;
        const discountPct = origPrice > p.promoPrice ? Math.round(((origPrice - p.promoPrice) / origPrice) * 100) : 0;
        const discountBadge = discountPct > 0 ? `<span style="background: #EF4444; color: #FFF; font-size: 10px; font-weight: 900; padding: 2px 6px; border-radius: 8px; position: absolute; top: 8px; left: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">- ${discountPct}% OFF</span>` : '';

        return `
          <div onclick="MarketplaceApp.openPromoDirectly('${p.id}', '${p.establishmentId}', '${p.productId}')" style="min-width: 220px; max-width: 220px; background: rgba(30, 41, 59, 0.95); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 14px; overflow: hidden; cursor: pointer; flex-shrink: 0; position: relative; scroll-snap-align: start; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: transform 0.2s ease;">
            <div style="width: 100%; height: 110px; position: relative; background: #000;">
              <img src="${p.image}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='/images/burger_royale.jpg'">
              ${discountBadge}
              <span style="position: absolute; bottom: 6px; right: 6px; background: rgba(15, 23, 42, 0.85); color: #FCA5A5; font-size: 9.5px; font-weight: 800; padding: 2px 6px; border-radius: 10px; border: 1px solid rgba(239,68,68,0.4);">
                ⏱️ ${hoursLeft}h ${minsLeft}m
              </span>
            </div>
            <div style="padding: 10px;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <span style="font-size: 14px;">${p.establishmentLogo || '🏪'}</span>
                <span style="font-size: 11px; font-weight: 700; color: #94A3B8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.establishmentName}</span>
              </div>
              <h5 style="margin: 0 0 4px 0; font-size: 13px; font-weight: 800; color: #FFF; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.title}</h5>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 6px;">
                <div>
                  ${origPrice > p.promoPrice ? `<span style="font-size: 10.5px; color: #64748B; text-decoration: line-through; display: block;">$${Math.round(origPrice).toLocaleString('de-DE')}</span>` : ''}
                  <span style="font-size: 13.5px; font-weight: 900; color: #10B981;">$${Math.round(p.promoPrice).toLocaleString('de-DE')} COP</span>
                </div>
                <span style="background: rgba(239,68,68,0.2); color: #F87171; border: 1px solid rgba(239,68,68,0.4); border-radius: 20px; font-size: 10px; font-weight: 800; padding: 4px 8px;">🔥 Ver Promo</span>
              </div>
            </div>
          </div>
        `;
      }).join('');

      section.classList.remove('hidden');
    } catch(e) {
      console.warn('Error loading daily promos:', e);
    }
  }

  async openPromoDirectly(promoId, establishmentId, productId) {
    const est = this.establishments.find(e => e.id === establishmentId);
    if (!est) return;
    
    // Open store view
    this.openEstablishment(establishmentId);

    // After store renders, open product details modal directly!
    setTimeout(() => {
      if (typeof this.openProductModal === 'function') {
        this.openProductModal(productId);
      }
    }, 350);
  }

  // Navigation
  selectCategory(category) {
    this.currentCategory = category;
    window.activeFoodTypeFilter = null; // Always reset filter so Food Categories Grid shows first for comidas
    
    // Update active class in categories tabs (DeliverCity style)
    document.querySelectorAll('.category-card-delivercity').forEach(card => {
      if (card.dataset.category === category) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    this.renderEstablishments();
  }

  showFoodCategoriesGrid() {
    window.activeFoodTypeFilter = null;
    this.renderEstablishments();
  }

  goHome(pushState = true) {
    this.selectedEstablishment = null;
    this.currentCategory = null;
    window.activeFoodTypeFilter = null;

    // Reset URL query parameters (clear ?shop=... or #...)
    if (window.location.search || window.location.hash) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    document.getElementById('establishment-view').classList.remove('active');
    document.getElementById('home-view').classList.add('active');

    // Remove active state from main category cards
    document.querySelectorAll('.category-card-delivercity').forEach(card => {
      card.classList.remove('active');
    });
    
    // Reset global theme to default
    document.documentElement.style.setProperty('--primary', '#FF5E3A');
    document.documentElement.style.setProperty('--primary-hover', '#E04A27');
    
    this.renderEstablishments();
    this.setActiveMobileTab('home');

    this.closeAllModals();

    if (pushState) {
      window.history.pushState({ view: 'home' }, '');
    }
  }

  openEstablishment(estId, pushState = true) {
    const est = this.establishments.find(e => e.id === estId);
    if (!est) return;

    this.selectedEstablishment = est;

    if (!this.isEstablishmentOpen(est)) {
      this.showToast(`🔴 Local CERRADO (${this.formatTime12h(est.open_time)} - ${this.formatTime12h(est.close_time)}). Puedes explorar la carta.`);
    }

    if (pushState) {
      window.history.pushState({ view: 'establishment', estId: estId }, '');
    }

    // Apply custom accent theme color
    if (est.themeColor) {
      document.documentElement.style.setProperty('--primary', est.themeColor);
      // Darken accent color for hover state
      const darken = (hex, pct) => {
        hex = hex.replace(/^\s*#|\s*$/g, '');
        if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
        let r = parseInt(hex.substr(0, 2), 16),
            g = parseInt(hex.substr(2, 2), 16),
            b = parseInt(hex.substr(4, 2), 16);
        r = Math.max(0, Math.min(255, r - r * (pct / 100)));
        g = Math.max(0, Math.min(255, g - g * (pct / 100)));
        b = Math.max(0, Math.min(255, b - b * (pct / 100)));
        return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
      };
      document.documentElement.style.setProperty('--primary-hover', darken(est.themeColor, 12));
    } else {
      document.documentElement.style.setProperty('--primary', '#FF5E3A');
      document.documentElement.style.setProperty('--primary-hover', '#E04A27');
    }

    // Set header details
    const bannerDiv = document.getElementById('est-banner');
    const isImageBanner = est.banner && (est.banner.startsWith('http') || est.banner.startsWith('/') || est.bannerType === 'image');
    
    if (isImageBanner) {
      bannerDiv.style.background = `linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url('${est.banner}')`;
      bannerDiv.style.backgroundSize = 'cover';
      bannerDiv.style.backgroundPosition = 'center';
    } else {
      bannerDiv.style.background = est.banner || 'linear-gradient(135deg, #1F2937, #111827)';
    }

    const logoDiv = document.getElementById('est-logo');
    if (est.logoImage) {
      logoDiv.innerHTML = `<img src="${est.logoImage}" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else {
      logoDiv.innerHTML = est.logo || '🏪';
    }
    document.getElementById('est-name').innerText = est.name;
    document.getElementById('est-desc').innerText = est.description || '';
    
    // Category mapping
    const categoryEmojis = {
      comidas: '🍔 Comida',
      farmacias: '💊 Farmacia',
      mercados: '🛒 Mercado',
      ferreterias: '🛠️ Ferretería'
    };
    const categoryBadge = document.getElementById('est-category-badge');
    categoryBadge.innerText = categoryEmojis[est.category] || est.category;
    categoryBadge.className = 'est-badge ' + est.category;

    // Delivery time (minutes)
    const deliverySpan = document.querySelector('.est-delivery-time');
    if (deliverySpan) {
      deliverySpan.innerText = this.getFormattedDeliveryTime(est);
    }

    // High traffic banner in store header
    let highTrafficBanner = document.getElementById('est-high-traffic-banner');
    if (!highTrafficBanner) {
      highTrafficBanner = document.createElement('div');
      highTrafficBanner.id = 'est-high-traffic-banner';
      const headerInfo = document.querySelector('.establishment-header .est-info') || document.querySelector('.establishment-header');
      if (headerInfo) headerInfo.appendChild(highTrafficBanner);
    }

    if (est && est.isHighTraffic) {
      const extra = est.extraPrepTime || 20;
      highTrafficBanner.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.92); border: 1.5px solid #F59E0B; color: #FFFFFF; padding: 12px 16px; border-radius: 14px; font-weight: 700; font-size: 12.5px; margin-top: 14px; display: flex; align-items: center; gap: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.5); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);">
          <span style="font-size: 22px; flex-shrink: 0;">🚨</span>
          <span style="line-height: 1.4;"><strong style="color: #FCD34D; font-size: 13px;">Tráfico Alto en Cocina:</strong> El tiempo estimado de entrega aumenta en <strong style="color: #FEF08A;">+${extra} min</strong> debido a la alta afluencia de personas en el local.</span>
        </div>
      `;
      highTrafficBanner.style.display = 'block';
    } else if (highTrafficBanner) {
      highTrafficBanner.style.display = 'none';
    }

    // Closed store banner in store header
    let closedStoreBanner = document.getElementById('est-closed-store-banner');
    if (!closedStoreBanner) {
      closedStoreBanner = document.createElement('div');
      closedStoreBanner.id = 'est-closed-store-banner';
      const headerInfo = document.querySelector('.establishment-header .est-info') || document.querySelector('.establishment-header');
      if (headerInfo) headerInfo.appendChild(closedStoreBanner);
    }

    const isOpen = this.isEstablishmentOpen(est);
    if (!isOpen) {
      closedStoreBanner.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.92); border: 1.5px solid #EF4444; color: #FFFFFF; padding: 12px 16px; border-radius: 14px; font-weight: 700; font-size: 12.5px; margin-top: 14px; display: flex; align-items: center; gap: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.5); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);">
          <span style="font-size: 22px; flex-shrink: 0;">🔴</span>
          <span style="line-height: 1.4;"><strong style="color: #FCA5A5; font-size: 13px;">Restaurante Cerrado:</strong> Horario de Atención: <strong style="color: #FEF08A;">${this.formatTime12h(est.open_time)} a ${this.formatTime12h(est.close_time)}</strong>. Puedes consultar el menú pero los pedidos están desactivados fuera de horario.</span>
        </div>
      `;
      closedStoreBanner.style.display = 'block';
    } else if (closedStoreBanner) {
      closedStoreBanner.style.display = 'none';
    }

    // Render internal categories and products
    this.renderInternalCategories(est);
    this.renderProducts(est.products);

    // Switch views
    document.getElementById('home-view').classList.remove('active');
    document.getElementById('establishment-view').classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  getFormattedDeliveryTime(est) {
    if (!est) return '⏱️ 20-30 min';
    let minTime = est.prep_time || 15;
    let maxTime = est.delivery_time || 25;
    const isHigh = Boolean(est.isHighTraffic);
    const extra = (est.extraPrepTime && parseInt(est.extraPrepTime)) || 20;

    if (isHigh) {
      minTime += extra;
      maxTime += extra;
      return `⏱️ ${minTime}-${maxTime} min (🚨 Tráfico Alto)`;
    } else {
      return `⏱️ ${minTime}-${maxTime} min`;
    }
  }

  renderFoodBubbleCarousel() {
    const container = document.getElementById('food-type-filters-container');
    if (!container) return;

    if (this.currentCategory !== 'comidas') {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    container.className = 'food-bubbles-wrapper premium-scroll';

    const foodCategories = [
      { id: 'all', name: 'Todos', icon: '⭐' },
      { id: 'hamburguesas', name: 'Burgers', icon: '🍔' },
      { id: 'perros', name: 'Perros', icon: '🌭' },
      { id: 'pizzas', name: 'Pizzas', icon: '🍕' },
      { id: 'patacones', name: 'Patacones', icon: '🍌' },
      { id: 'arepas', name: 'Arepas', icon: '🫓' },
      { id: 'cachapas', name: 'Cachapas', icon: '🌽' },
      { id: 'sushi', name: 'Sushi', icon: '🍣' },
      { id: 'mariscos', name: 'Mariscos', icon: '🦐' },
      { id: 'sandwiches', name: 'Sándwiches', icon: '🥪' },
      { id: 'pepitos', name: 'Pepitos', icon: '🥖' },
      { id: 'alitas', name: 'Alitas', icon: '🍗' },
      { id: 'salchipapas', name: 'Salchipapas', icon: '🍟' },
      { id: 'picadas', name: 'Parrillas', icon: '🍖' },
      { id: 'bebidas', name: 'Bebidas', icon: '🥤' },
      { id: 'postres', name: 'Postres', icon: '🍰' }
    ];

    const activeFilter = window.activeFoodTypeFilter || 'all';

    container.innerHTML = `
      <div class="food-bubbles-container">
        ${foodCategories.map(cat => {
          const isActive = activeFilter === cat.id;
          return `
            <div class="bubble-story-item ${isActive ? 'active' : ''}" onclick="MarketplaceApp.filterRestaurantsByFoodType('${cat.id}')">
              <div class="bubble-ring">
                <div class="bubble-inner">
                  ${cat.icon}
                </div>
              </div>
              <span class="bubble-label">${cat.name}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Legacy fallback grid
  renderFoodCategoriesGrid() {
    this.renderFoodBubbleCarousel();
  }

  // Render lists
  renderEstablishments(filtered = null, isDirectFilter = false) {
    const grid = document.getElementById('establishments-grid');
    if (!grid) return;

    const viewAllBtn = document.querySelector('.btn-view-all');

    // If no category is selected (initial home state)
    if (!this.currentCategory && !filtered && !isDirectFilter) {
      const titleEl = document.getElementById('establishments-title');
      if (titleEl) titleEl.innerText = '👇 Selecciona una Categoría arriba para explorar';
      const container = document.getElementById('food-type-filters-container');
      if (container) container.style.display = 'none';
      if (viewAllBtn) viewAllBtn.style.display = 'none';

      grid.style.cssText = 'display: block; width: 100%;';
      grid.innerHTML = `
        <div class="cart-empty-state" style="grid-column: 1 / -1; padding: 36px 20px; text-align: center; background: rgba(255,255,255,0.03); border: 1px dashed rgba(255,255,255,0.1); border-radius: 20px;">
          <span style="font-size: 42px; display: block; margin-bottom: 10px;">👆</span>
          <h3 style="font-size: 16px; font-weight: 800; color: #ffffff; margin: 0 0 6px 0;">¡Bienvenido a Rapi Gochos!</h3>
          <p style="font-size: 13px; color: #94A3B8; margin: 0; line-height: 1.4;">Presiona una de las categorías arriba (<strong>Restaurantes, Farmacias, Mercados o Ferreterías</strong>) para ver los comercios disponibles.</p>
        </div>
      `;
      return;
    }

    if (viewAllBtn) {
      viewAllBtn.style.display = (this.currentCategory === 'comidas') ? 'inline-flex' : 'none';
    }

    grid.style.cssText = ''; // restore standard grid layout
    this.renderFoodBubbleCarousel();

    const categoryNames = {
      'all': '✨ Todos los Restaurantes',
      'hamburguesas': '🍔 Hamburguesas',
      'perros': '🌭 Perros Calientes',
      'pizzas': '🍕 Pizzas',
      'patacones': '🍌 Patacones',
      'arepas': '🫓 Arepas',
      'cachapas': '🌽 Cachapas',
      'sushi': '🍣 Sushi & Asiatica',
      'mariscos': '🦐 Mariscos & Pescado',
      'sandwiches': '🥪 Sándwiches',
      'pepitos': '🥖 Pepitos / Baguettes',
      'alitas': '🍗 Alitas & Chicken',
      'salchipapas': '🍟 Salchipapas',
      'picadas': '🍖 Picadas & Parrillas',
      'bebidas': '🥤 Bebidas / Batidos',
      'postres': '🍰 Postres / Helados'
    };

    let displayTitle = '';
    if (filtered || window.activeFoodTypeFilter) {
      const activeLabel = categoryNames[window.activeFoodTypeFilter] || (window.activeFoodTypeFilter ? this.capitalize(window.activeFoodTypeFilter) : 'Resultados');
      displayTitle = `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 10px;">
          <span>${activeLabel}</span>
          <button type="button" onclick="MarketplaceApp.filterRestaurantsByFoodType('all')" style="background: rgba(255, 94, 58, 0.15); color: var(--primary); border: 1px solid var(--primary); padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; white-space: nowrap;">
            ⭐ Ver Todos
          </button>
        </div>
      `;
    } else {
      displayTitle = this.capitalize(this.currentCategory);
    }
    const titleEl = document.getElementById('establishments-title');
    if (titleEl) titleEl.innerHTML = displayTitle;

    // Get session seed for fair play rotation
    const rawList = filtered || this.establishments.filter(e => !e.disabled && e.category === this.currentCategory && (e.location === this.currentLocation || !e.location));
    const list = this.shuffleWithSeed(rawList, this.getSessionSeed());

    // Render Featured Horizontal Carousel
    this.renderFeaturedCarousel();

    grid.innerHTML = '';

    if (list.length === 0) {
      grid.innerHTML = `
        <div class="cart-empty-state" style="grid-column: 1 / -1;">
          <span>🏪</span>
          <p>No hay comercios registrados en esta categoría aún.</p>
          <button class="btn-secondary" style="margin-top: 12px;" onclick="MarketplaceApp.openRegisterModal()">¡Sé el primero!</button>
        </div>
      `;
      return;
    }

    list.forEach(est => {
      const card = document.createElement('div');
      card.className = 'est-row-card';
      const isOpen = this.isEstablishmentOpen(est);

      if (!isOpen) {
        card.style.opacity = '0.75';
        card.style.filter = 'grayscale(0.3)';
      }

      card.onclick = () => this.openEstablishment(est.id);

      // Determine representation photo
      const photoUrl = est.logoImage || (est.products && est.products[0] ? est.products[0].image : null);
      let imgHTML = '';
      if (photoUrl) {
        imgHTML = `<img src="${photoUrl}" alt="${est.name}" style="object-fit: cover; width: 100%; height: 100%;" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex'">`;
      }

      const deliveryTimeStr = this.getFormattedDeliveryTime(est);

      const closedBadge = !isOpen 
        ? `<span style="background: rgba(239, 68, 68, 0.2); color: #EF4444; border: 1px solid #EF4444; padding: 2px 5px; border-radius: 6px; font-size: 9.5px; font-weight: 800; position: absolute; top: 6px; right: 6px; z-index: 2;">🔴 Cerrado</span>`
        : '';

      const highTrafficBadge = est.isHighTraffic 
        ? `<span style="background: #dc2626; color: #ffffff; padding: 2px 5px; border-radius: 6px; font-size: 9.5px; font-weight: 800; position: absolute; top: 6px; left: 6px; z-index: 2;">🚨 Tráfico Alto</span>` 
        : '';

      const ratingVal = est.avgRating ? parseFloat(est.avgRating).toFixed(1) : '4.9';
      const totalRev = est.totalReviews !== undefined ? est.totalReviews : Math.floor(10 + Math.random() * 25);

      card.innerHTML = `
        <div class="est-row-img-wrapper" style="border-radius: 10px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); height: 95px; position: relative;">
          ${imgHTML}
          <div class="est-row-img-placeholder hidden">${est.logo || '🏪'}</div>
          ${closedBadge}
          ${highTrafficBadge}
        </div>
        <div class="est-row-info" style="display: flex; flex-direction: column; gap: 4px; margin-top: 6px;">
          <div class="est-row-header-flex" style="display: flex; justify-content: space-between; align-items: center; gap: 4px;">
            <h4 style="font-size: 13px; font-weight: 800; color: #FFF; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${est.name}</h4>
            <div class="est-row-rating" onclick="event.stopPropagation(); MarketplaceApp.openReviewsListModal('${est.id}')" style="font-size: 10px; font-weight: 800; color: #FFCC00; background: rgba(255, 204, 0, 0.15); border: 1px solid rgba(255, 204, 0, 0.3); padding: 1px 6px; border-radius: 6px; flex-shrink: 0; cursor: pointer;">
              ⭐ ${ratingVal} (${totalRev})
            </div>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${this.capitalize(est.category)} • ${est.description.split('.')[0] || est.description}
          </div>
          <div class="est-row-details-row" style="display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; margin-top: 2px;">
            <span>${deliveryTimeStr}</span>
            <span class="free-delivery" style="background: rgba(59, 130, 246, 0.15); color: #3B82F6; border: 1px solid #3B82F6; padding: 1px 5px; border-radius: 6px; font-size: 9.5px; font-weight: 800;">${isOpen ? '🚲 ' + this.formatPesos(est.delivery_fee || 5000) : '🔴 Cerrado'}</span>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  getSessionSeed() {
    let seed = sessionStorage.getItem('pedigochos_session_seed');
    if (!seed) {
      seed = Date.now().toString() + '_' + Math.floor(Math.random() * 100000);
      sessionStorage.setItem('pedigochos_session_seed', seed);
    }
    return seed;
  }

  regenerateSessionSeed() {
    const newSeed = Date.now().toString() + '_' + Math.floor(Math.random() * 100000);
    sessionStorage.setItem('pedigochos_session_seed', newSeed);
    return newSeed;
  }

  seededRandom(seedStr) {
    let h = 0;
    for (let i = 0; i < (seedStr || 'default').length; i++) {
      h = Math.imul(31, h) + seedStr.charCodeAt(i) | 0;
    }
    return function() {
      h = Math.imul(h ^ (h >>> 15), h | 1);
      h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
      return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
    };
  }

  shuffleWithSeed(array, seedStr) {
    if (!array || !Array.isArray(array)) return [];
    const arr = [...array];
    const rng = this.seededRandom(seedStr);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  renderFeaturedCarousel() {
    const container = document.getElementById('featured-carousel-container');
    const section = document.getElementById('featured-carousel-section');
    if (!container || !section) return;

    if (!this.establishments || this.establishments.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    container.innerHTML = '';

    // Shuffle featured items with session seed (excluding disabled stores)
    const activeEsts = (this.establishments || []).filter(e => !e.disabled);
    const featuredShuffled = this.shuffleWithSeed(activeEsts, this.getSessionSeed()).slice(0, 6);

    featuredShuffled.forEach(est => {
      const card = document.createElement('div');
      card.style.cssText = 'min-width: 200px; width: 200px; flex-shrink: 0; background: rgba(18, 18, 24, 0.95); border: 1px solid rgba(255, 94, 58, 0.2); border-radius: 14px; padding: 8px 10px; cursor: pointer; scroll-snap-align: start; transition: transform 0.2s, border-color 0.2s; display: flex; align-items: center; gap: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
      const isOpen = this.isEstablishmentOpen(est);

      if (!isOpen) {
        card.style.opacity = '0.75';
        card.style.filter = 'grayscale(0.3)';
      }

      card.onclick = () => this.openEstablishment(est.id);

      const photoUrl = est.logoImage || (est.products && est.products[0] ? est.products[0].image : null);
      let imgHTML = '';
      if (photoUrl) {
        imgHTML = `<img src="${photoUrl}" alt="${est.name}" style="object-fit: cover; width: 100%; height: 100%;" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex'">`;
      }

      card.innerHTML = `
        <div style="width: 54px; height: 54px; border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.04); display: flex; align-items: center; justify-content: center; flex-shrink: 0; position: relative; border: 1px solid rgba(255,255,255,0.1);">
          ${imgHTML}
          <div class="hidden" style="font-size: 22px;">${est.logo || '🏪'}</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
            <h5 style="margin: 0; font-size: 12px; font-weight: 800; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${est.name}</h5>
            <span style="font-size: 9.5px; color: #FFCC00; font-weight: 800; flex-shrink: 0;">★ 0.0</span>
          </div>
          <div style="font-size: 10px; color: var(--accent); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">✨ Destacado</div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 9.5px; margin-top: 2px;">
            <span style="color: #3B82F6; font-weight: 800;">🚲 ${this.formatPesos(est.delivery_fee || 5000)}</span>
            <span style="color: #94A3B8;">${this.getFormattedDeliveryTime(est)}</span>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  }

  renderFoodTypeFilterButtons() {
    const container = document.getElementById('food-type-filters-container');
    if (!container) return;

    if (this.currentCategory !== 'comidas' || !window.activeFoodTypeFilter) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    container.innerHTML = '';

    const foodTypes = [
      { id: 'all', name: '✨ Todos', icon: '🍽️' },
      { id: 'hamburguesas', name: 'Hamburguesas', icon: '🍔' },
      { id: 'perros', name: 'Perros Calientes', icon: '🌭' },
      { id: 'pizzas', name: 'Pizzas', icon: '🍕' },
      { id: 'patacones', name: 'Patacones', icon: '🍌' },
      { id: 'arepas', name: 'Arepas', icon: '🫓' },
      { id: 'cachapas', name: 'Cachapas', icon: '🌽' },
      { id: 'sushi', name: 'Sushi', icon: '🍣' },
      { id: 'mariscos', name: 'Mariscos', icon: '🦐' },
      { id: 'sandwiches', name: 'Sándwiches', icon: '🥪' },
      { id: 'pepitos', name: 'Pepitos', icon: '🥖' },
      { id: 'alitas', name: 'Alitas', icon: '🍗' },
      { id: 'salchipapas', name: 'Salchipapas', icon: '🍟' },
      { id: 'picadas', name: 'Picadas', icon: '🍖' },
      { id: 'bebidas', name: 'Bebidas', icon: '🥤' },
      { id: 'postres', name: 'Postres', icon: '🍰' }
    ];

    foodTypes.forEach(ft => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = window.activeFoodTypeFilter === ft.id;
      btn.className = `food-type-chip ${isActive ? 'active' : ''}`;
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 20px;
        font-size: 12.5px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        border: 1px solid ${isActive ? '#ff5e3a' : 'rgba(0,0,0,0.08)'};
        background: ${isActive ? '#ff5e3a' : '#ffffff'};
        color: ${isActive ? '#ffffff' : '#334155'};
        box-shadow: ${isActive ? '0 4px 12px rgba(255, 94, 58, 0.3)' : '0 2px 4px rgba(0,0,0,0.04)'};
        transition: all 0.2s ease;
        flex-shrink: 0;
      `;
      btn.innerHTML = `<span>${ft.icon}</span> <span>${ft.name}</span>`;
      btn.onclick = (e) => {
        e.preventDefault();
        window.activeFoodTypeFilter = ft.id;
        this.filterRestaurantsByFoodType(ft.id);
      };
      container.appendChild(btn);
    });
  }

  filterRestaurantsByFoodType(foodTypeId) {
    if (!foodTypeId) {
      this.showFoodCategoriesGrid();
      return;
    }

    window.activeFoodTypeFilter = foodTypeId;
    const allEsts = this.establishments.filter(e => e.category === 'comidas' && (e.location === this.currentLocation || !e.location));

    if (foodTypeId === 'all') {
      this.renderEstablishments(allEsts, true);
      return;
    }

    const term = foodTypeId.toLowerCase();
    const filtered = allEsts.filter(est => {
      const nameMatch = (est.name || '').toLowerCase().includes(term);
      const descMatch = (est.description || '').toLowerCase().includes(term);
      const productMatch = est.products && est.products.some(p => {
        const pName = (p.name || '').toLowerCase();
        const pCat = (p.category || p.category_id || '').toLowerCase();
        const pDesc = (p.description || '').toLowerCase();
        return pName.includes(term) || pCat.includes(term) || pDesc.includes(term);
      });

      let aliasMatch = false;
      if (term === 'hamburguesas') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/hamburguesa|burguer|burger/i) !== null;
      } else if (term === 'perros') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/perro|hotdog|salchicha/i) !== null;
      } else if (term === 'pizzas') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/pizza|pizzeria|pizzería/i) !== null;
      } else if (term === 'patacones') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/patacon|patacones|platano|plátano/i) !== null;
      } else if (term === 'arepas') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/arepa|arepas|pepiada/i) !== null;
      } else if (term === 'cachapas') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/cachapa|cachapas|jocote|jocoto|choclo/i) !== null;
      } else if (term === 'sushi') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/sushi|roll|maki|niguiri|tempura|asiatica/i) !== null;
      } else if (term === 'mariscos') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/marisco|mariscos|pescado|camaron|camarones|calamar|paella/i) !== null;
      } else if (term === 'sandwiches') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/sandwich|sandwiches|sándwich|sanduche|club house|sub/i) !== null;
      } else if (term === 'pepitos') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/pepito|pepitos|baguette|pan/i) !== null;
      } else if (term === 'alitas') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/alita|alitas|wings|chicken|pollo/i) !== null;
      } else if (term === 'salchipapas') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/salchipapa|salchipapas|entradas|raciones/i) !== null;
      } else if (term === 'picadas') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/picada|picadas|parrilla|carne/i) !== null;
      } else if (term === 'bebidas') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/bebida|jugo|batido|frappe|soda|malta|refresco|merengada|malteada/i) !== null;
      } else if (term === 'postres') {
        aliasMatch = (est.name + ' ' + est.description).toLowerCase().match(/postre|dulce|torta|helado|marquesa|copa|paleta|brownie/i) !== null;
      }

      return nameMatch || descMatch || productMatch || aliasMatch;
    });

    this.renderEstablishments(filtered.length > 0 ? filtered : allEsts, true);
  }

  renderInternalCategories(est) {
    const listContainer = document.getElementById('internal-categories-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    // Collect all unique category names from products
    const rawCategories = {};
    if (est.products) {
      est.products.forEach(p => {
        // Try to identify category
        let catName = 'Otros';
        if (p.category) {
          catName = p.category;
        } else if (p.category_id) {
          // Find matching category in global categoriesList if loaded
          const found = (window.categoriesList || []).find(c => c.id === p.category_id);
          if (found) catName = found.name;
        }
        
        if (!rawCategories[catName]) {
          // Attempt to find a representative image for this category
          rawCategories[catName] = p.image || null;
        }
      });
    }

    const categories = Object.keys(rawCategories);
    if (categories.length <= 1) {
      // Hide category bar if there's only one category or none
      listContainer.parentElement.style.display = 'none';
      return;
    }
    listContainer.parentElement.style.display = 'block';

    // Add 'Todos' option first
    const allBtn = document.createElement('div');
    allBtn.className = 'internal-category-card active';
    allBtn.onclick = () => this.filterInternalCategory('all', allBtn);
    
    // Representative image for all
    const allImg = est.products && est.products.length > 0 && est.products[0].image ? est.products[0].image : DEFAULT_IMAGES[est.category];
    allBtn.innerHTML = `
      <div class="internal-category-img">
        <img src="${allImg}" alt="Todos">
      </div>
      <span>Todos</span>
    `;
    listContainer.appendChild(allBtn);

    // Add specific categories
    categories.forEach(cat => {
      const catBtn = document.createElement('div');
      catBtn.className = 'internal-category-card';
      catBtn.onclick = () => this.filterInternalCategory(cat, catBtn);

      const catImg = rawCategories[cat];
      
      // Extract emoji prefix if present in the category name (e.g. "🥤 Batidos" -> emoji = "🥤", name = "Batidos")
      const emojiMatch = cat.match(/^([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF])\s*(.*)$/);
      let displayEmoji = '';
      let displayLabel = cat;
      
      if (emojiMatch) {
        displayEmoji = emojiMatch[1];
        displayLabel = emojiMatch[2];
      }

      let imgHTML = '';
      if (catImg) {
        imgHTML = `<img src="${catImg}" alt="${cat}">`;
      } else {
        imgHTML = `<div style="font-size: 26px; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05);">${displayEmoji || '🍽️'}</div>`;
      }

      catBtn.innerHTML = `
        <div class="internal-category-img">
          ${imgHTML}
        </div>
        <span>${displayLabel}</span>
      `;
      listContainer.appendChild(catBtn);
    });
  }

  filterInternalCategory(categoryName, element) {
    if (!this.selectedEstablishment) return;

    // Toggle active classes
    document.querySelectorAll('.internal-category-card').forEach(btn => btn.classList.remove('active'));
    element.classList.add('active');

    // Filter products
    let filteredProducts = this.selectedEstablishment.products || [];
    if (categoryName !== 'all') {
      filteredProducts = (this.selectedEstablishment.products || []).filter(p => {
        let pCat = 'Otros';
        if (p.category) {
          pCat = p.category;
        } else if (p.category_id) {
          const found = (window.categoriesList || []).find(c => c.id === p.category_id);
          if (found) pCat = found.name;
        }
        return pCat === categoryName;
      });
      document.getElementById('internal-section-title').innerText = categoryName;
    } else {
      document.getElementById('internal-section-title').innerText = 'Nuestros Productos';
    }

    // Render with scale animation
    const grid = document.getElementById('products-grid');
    grid.style.opacity = '0';
    grid.style.transform = 'translateY(10px)';
    grid.style.transition = 'opacity 0.25s ease, transform 0.25s ease';

    setTimeout(() => {
      this.renderProducts(filteredProducts);
      grid.style.opacity = '1';
      grid.style.transform = 'translateY(0)';
    }, 150);
  }

  renderProducts(products) {
    const grid = document.getElementById('products-grid');
    grid.innerHTML = '';

    if (!products || products.length === 0) {
      grid.innerHTML = `
        <div class="cart-empty-state" style="grid-column: 1 / -1;">
          <span>📦</span>
          <p>No hay productos disponibles en esta categoría.</p>
        </div>
      `;
      return;
    }

    products.forEach((prod, index) => {
      const card = document.createElement('div');
      card.className = 'product-card animate-fade-in-up';
      card.style.cursor = 'pointer';
      card.style.animationDelay = `${index * 0.05}s`;
      card.setAttribute('onclick', `MarketplaceApp.openCustomizerModalById('${prod.id}')`);

      // Check if image exists, otherwise use category fallback or emoji
      let imgHTML = '';
      const estLogo = (this.selectedEstablishment && this.selectedEstablishment.logo) ? this.selectedEstablishment.logo : '🏪';
      if (prod.image) {
        imgHTML = `<img src="${prod.image}" alt="${prod.name}" class="product-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
                   <div class="product-image-placeholder hidden">${estLogo}</div>`;
      } else {
        imgHTML = `<div class="product-image-placeholder">${estLogo}</div>`;
      }

      card.innerHTML = `
        <div class="product-info">
          <div>
            <h4>${prod.name}</h4>
            <p>${prod.description || ''}</p>
          </div>
          <div class="product-price-row">
            <span class="product-price">${this.formatPesos(prod.price)}</span>
            <button class="btn-add-product" onclick="event.stopPropagation(); MarketplaceApp.openCustomizerModalById('${prod.id}')">+</button>
          </div>
        </div>
        <div class="product-image-container">
          ${imgHTML}
        </div>
      `;

      grid.appendChild(card);
    });
  }

  openCustomizerModalById(productId) {
    let product = null;
    if (this.selectedEstablishment && Array.isArray(this.selectedEstablishment.products)) {
      product = this.selectedEstablishment.products.find(p => String(p.id) === String(productId));
    }
    
    if (!product && Array.isArray(this.establishments)) {
      for (const est of this.establishments) {
        if (Array.isArray(est.products)) {
          const found = est.products.find(p => String(p.id) === String(productId));
          if (found) {
            this.selectedEstablishment = est;
            product = found;
            break;
          }
        }
      }
    }

    if (product) {
      this.openCustomizerModal(product);
    } else {
      console.error('Product not found for ID:', productId);
    }
  }

  // Cart Management
  addToCart(productId) {
    this.openCustomizerModalById(productId);
  }

  addDirectToCart(product) {
    const cartItemId = 'item-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    const cartItem = {
      cart_item_id: cartItemId,
      product_id: product.id,
      product_name: product.name,
      restaurant_id: this.selectedEstablishment.id,
      restaurant_name: this.selectedEstablishment.name,
      delivery_fee: this.selectedEstablishment.delivery_fee || 0,
      quantity: 1,
      selected_specifications: {
        single_selections: [],
        add_ons: [],
        exclusions: [],
        special_notes: ""
      },
      unit_total_calculated: product.price,
      subtotal_combined: product.price,
      product: product
    };

    // Check if an identical item (no modifiers) is already in the cart
    const existing = this.cart.items.find(item => 
      item.product_id === product.id && 
      item.selected_specifications.single_selections.length === 0 &&
      item.selected_specifications.add_ons.length === 0 &&
      item.selected_specifications.exclusions.length === 0
    );

    if (existing) {
      existing.quantity += 1;
      existing.subtotal_combined = existing.unit_total_calculated * existing.quantity;
    } else {
      this.cart.items.push(cartItem);
    }

    this.updateCartBadge();
    this.showToast(`Agregado: ${product.name}`);
    this.animateFlyToCart(window.event);
  }

  isArepaOrHeladoProduct(prod) {
    if (!prod) return false;
    const name = (prod.name || '').toLowerCase();
    const cat = (prod.category || '').toLowerCase();
    return name.includes('arepa') || name.includes('helado') || name.includes('frappé') || name.includes('paleta') || name.includes('sundae') || name.includes('merengada') || name.includes('batido') || cat.includes('arepa') || cat.includes('helado');
  }

  openCustomizerModal(product) {
    if (!product) return;
    if (typeof product === 'string' || typeof product === 'number') {
      this.openCustomizerModalById(product);
      return;
    }
    console.log('openCustomizerModal called for:', product.name);
    try {
      this.closeAllModals();

      // Show Modal FIRST guaranteed before any content calculation
      const modal = document.getElementById('customizer-modal');
      if (modal) {
        modal.classList.add('open');
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        modal.style.visibility = 'visible';
        modal.style.pointerEvents = 'auto';
        modal.style.zIndex = '9999999';
        
        const content = modal.querySelector('.modal-content');
        if (content) {
          content.style.display = 'flex';
        }
      }
      window.history.pushState({ view: 'modal', modalId: 'customizer-modal' }, '');

      this.customizerState = {
        product: product,
        quantity: 1,
        pizzaMode: 'whole',
        specialtyA: null,
        specialtyB: null,
        quantities: {
          whole: {},
          halfA: {},
          halfB: {}
        }
      };

      const initSide = (sideKey, targetProduct = product) => {
        this.customizerState.quantities[sideKey] = {};
        const isSpecialZeroInit = this.isArepaOrHeladoProduct(targetProduct);
        if (targetProduct && targetProduct.exclusions && Array.isArray(targetProduct.exclusions)) {
          targetProduct.exclusions.forEach(item => {
            const itemName = typeof item === 'object' && item.name ? item.name : String(item);
            this.customizerState.quantities[sideKey]['base_' + itemName] = isSpecialZeroInit ? 0 : 1;
          });
        }

        if (targetProduct && targetProduct.modifiers && Array.isArray(targetProduct.modifiers)) {
          targetProduct.modifiers.forEach(group => {
            if (group && group.selection_type === 'single' && Array.isArray(group.options)) {
              group.options.forEach((opt, idx) => {
                if (opt && opt.option_id) {
                  this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = (idx === 0) ? 1 : 0;
                }
              });
            } else if (group && Array.isArray(group.options)) {
              group.options.forEach(opt => {
                if (opt && opt.option_id) {
                  this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = 0;
                }
              });
            }
          });
        }
      };

      initSide('whole');

      // Populate UI text safely
      const nameEl = document.getElementById('customizer-product-name');
      if (nameEl) nameEl.innerText = product.name || 'Producto';

      const descEl = document.getElementById('customizer-product-desc');
      if (descEl) descEl.innerText = product.description || '';
      
      const ingredientsEl = document.getElementById('customizer-product-ingredients');
      if (ingredientsEl) {
        if (product.ingredients && Array.isArray(product.ingredients) && product.ingredients.length > 0) {
          ingredientsEl.innerText = `📝 Ingredientes: ${product.ingredients.join(', ')}`;
          ingredientsEl.style.display = 'block';
        } else if (product.exclusions && Array.isArray(product.exclusions) && product.exclusions.length > 0) {
          ingredientsEl.innerText = `📝 Ingredientes: ${product.exclusions.map(e => typeof e === 'object' && e.name ? e.name : String(e)).join(', ')}`;
          ingredientsEl.style.display = 'block';
        } else {
          ingredientsEl.style.display = 'none';
        }
      }
      
      const basePriceEl = document.getElementById('customizer-base-price');
      if (basePriceEl) basePriceEl.innerText = this.formatPesos(product.price || 0);

      const qtyDisp = document.getElementById('customizer-quantity-display');
      if (qtyDisp) qtyDisp.innerText = '1';

      const notesInput = document.getElementById('customizer-special-notes');
      if (notesInput) notesInput.value = '';

      // Image
      const imgWrapper = document.getElementById('customizer-product-img-wrapper');
      if (imgWrapper) {
        if (product.image) {
          imgWrapper.innerHTML = `<img src="${product.image}" alt="${product.name}">`;
        } else {
          imgWrapper.innerHTML = (this.selectedEstablishment && this.selectedEstablishment.logo) ? this.selectedEstablishment.logo : '🍔';
        }
      }

      // Reset columns view
      const colB = document.getElementById('customizer-col-b');
      const colAHeader = document.getElementById('col-a-header');
      if (colB) colB.classList.add('hidden');
      if (colAHeader) colAHeader.classList.add('hidden');
      
      // Pizza check
      const pName = (product.name || '').toLowerCase();
      const pCat = (product.category || '').toLowerCase();
      const isPizza = pCat === 'pizzas' || pName.includes('pizza');
      const pizzaSection = document.getElementById('pizza-halves-section');
      if (pizzaSection) {
        if (isPizza) {
          pizzaSection.classList.remove('hidden');
          this.customizerState.pizzaMode = 'whole';
          const wholeBtn = document.getElementById('pizza-whole-btn');
          const halvesBtn = document.getElementById('pizza-halves-btn');
          if (wholeBtn) wholeBtn.classList.add('active');
          if (halvesBtn) halvesBtn.classList.remove('active');
        } else {
          pizzaSection.classList.add('hidden');
        }
      }

      this.renderCustomizerModifiers();
    } catch (err) {
      console.error('Error setting up customizer modal:', err);
    }
  }

  renderCustomizerModifiers() {
    const product = this.customizerState.product;
    if (!product) return;
    const isHalves = this.customizerState.pizzaMode === 'halves';
    
    // Col A (Whole / Mitad A)
    const containerA = document.getElementById('modifiers-groups-a');
    if (containerA) {
      containerA.innerHTML = '';
      const sideKeyA = isHalves ? 'halfA' : 'whole';
      const labelSuffixA = isHalves ? 'A' : '';
      this.renderUnifiedList(containerA, sideKeyA, labelSuffixA);
    }

    // Col B (Mitad B) if halves
    const containerB = document.getElementById('modifiers-groups-b');
    if (containerB) {
      containerB.innerHTML = '';
      if (isHalves) {
        const colB = document.getElementById('customizer-col-b');
        const colAHead = document.getElementById('col-a-header');
        if (colB) colB.classList.remove('hidden');
        if (colAHead) {
          colAHead.classList.remove('hidden');
          colAHead.innerText = 'Mitad A';
        }
        this.renderUnifiedList(containerB, 'halfB', 'B', true);
      } else {
        const colB = document.getElementById('customizer-col-b');
        const colAHead = document.getElementById('col-a-header');
        if (colB) colB.classList.add('hidden');
        if (colAHead) colAHead.classList.add('hidden');
      }
    }

    this.updateCustomizerPrice();
  }

  renderUnifiedList(container, sideKey, labelSuffix, ignoreSize = false) {
    if (!container) return;
    const product = this.customizerState.product;
    if (!product) return;
    const isHalves = this.customizerState.pizzaMode === 'halves';
    const sideLabel = labelSuffix ? ` (Mitad ${labelSuffix})` : '';

    let activeProduct = product;
    if (isHalves) {
      const pName = (product.name || '').toLowerCase();
      const pCat = (product.category || '').toLowerCase();
      const isPizzaCat = pCat === 'pizzas' || pName.includes('pizza');
      if (isPizzaCat) {
        const specDiv = document.createElement('div');
        specDiv.className = 'modifier-group';
        
        const estProducts = (this.selectedEstablishment && Array.isArray(this.selectedEstablishment.products)) ? this.selectedEstablishment.products : [];
        const pizzaProducts = estProducts.filter(p => (p.category || '').toLowerCase() === 'pizzas' || (p.name || '').toLowerCase().includes('pizza'));
        const currentSpec = sideKey === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB;
        
        let optionsHTML = '<option value="">-- Elige un sabor --</option>';
        pizzaProducts.forEach(p => {
          optionsHTML += `<option value="${p.id}" ${currentSpec && currentSpec.id === p.id ? 'selected' : ''}>${p.name} (${this.formatPesos(p.price || 0)})</option>`;
        });

        specDiv.innerHTML = `
          <label style="font-weight: 700; display: block; margin-bottom: 8px;">Especialidad / Sabor${sideLabel}</label>
          <select class="customizer-specialty-select" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #ccc; background: var(--surface); color: var(--text);" onchange="MarketplaceApp.selectHalvesSpecialty('${sideKey}', this.value)">
            ${optionsHTML}
          </select>
        `;
        container.appendChild(specDiv);

        if (sideKey === 'halfA') {
          activeProduct = this.customizerState.specialtyA;
        } else {
          activeProduct = this.customizerState.specialtyB;
        }
      }
    }

    if (!activeProduct) {
      const msgDiv = document.createElement('div');
      msgDiv.style.padding = '12px';
      msgDiv.style.textAlign = 'center';
      msgDiv.style.color = '#777';
      msgDiv.innerText = 'Selecciona una especialidad para ver los ingredientes.';
      container.appendChild(msgDiv);
      return;
    }

    // Group 1: Required / Single Selections (like bread type)
    if (activeProduct.modifiers && Array.isArray(activeProduct.modifiers)) {
      activeProduct.modifiers.forEach(group => {
        if (group && group.selection_type === 'single') {
          const groupNameLower = (group.group_name || '').toLowerCase();
          if (ignoreSize && groupNameLower === 'tamaño') {
            return;
          }
          const groupDiv = document.createElement('div');
          groupDiv.className = 'modifier-group';
          const colId = `collapsible-${group.group_id}-${sideKey}`;
          const isExplicitlyCollapsed = this.customizerState.collapsedGroups && this.customizerState.collapsedGroups[colId] === true;
          const listClass = isExplicitlyCollapsed ? 'modifier-options-list collapsed' : 'modifier-options-list';
          const chevronTransform = isExplicitlyCollapsed ? 'transform: rotate(-90deg);' : 'transform: rotate(0deg);';
          
          groupDiv.innerHTML = `
            <div class="modifier-group-title" onclick="MarketplaceApp.toggleGroupCollapse('${colId}', this)" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700;">${group.group_name || ''}${sideLabel}</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="required-badge">Requerido</span>
                <span class="collapse-chevron" style="transition: transform 0.2s; font-size: 12px; ${chevronTransform}">▼</span>
              </div>
            </div>
            <div class="${listClass}" id="${colId}"></div>
          `;
          const list = groupDiv.querySelector('.modifier-options-list');
          
          if (group.options && Array.isArray(group.options)) {
            group.options.forEach(opt => {
              if (!opt) return;
              const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
              const extraPriceText = (opt.extra_price || 0) > 0 ? `+ ${this.formatPesos(opt.extra_price)}` : '';
              
              const optionDiv = document.createElement('div');
              optionDiv.className = `modifier-option ${qty === 1 ? 'option-single-active' : ''}`;
              
              optionDiv.innerHTML = `
                <div class="option-label-container" onclick="MarketplaceApp.setSingleSelection('${group.group_id}', '${opt.option_id}', '${sideKey}')">
                  <input type="radio" name="radio_${group.group_id}_${sideKey}" ${qty === 1 ? 'checked' : ''} style="margin: 0;">
                  <span class="option-name" style="margin-left: 8px;">${opt.name || ''}</span>
                </div>
                <div style="display: flex; align-items: center;">
                  <span class="option-extra-price">${extraPriceText}</span>
                </div>
              `;
              if (list) list.appendChild(optionDiv);
            });
          }
          container.appendChild(groupDiv);
        }
      });
    }

    // Group 3: Optional Additional Ingredients
    if (activeProduct.modifiers && Array.isArray(activeProduct.modifiers)) {
      let isSmallSizeSelected = false;
      const sizeGroup = activeProduct.modifiers.find(g => (g.group_name || '').toLowerCase() === 'tamaño');
      if (sizeGroup && Array.isArray(sizeGroup.options)) {
        const selectedSizeOpt = sizeGroup.options.find(opt => this.customizerState.quantities[sideKey]['opt_' + opt.option_id] === 1);
        if (selectedSizeOpt) {
          const sName = (selectedSizeOpt.name || '').toLowerCase();
          if (sName.includes('pequeña') || sName.includes('personal') || sName.includes('pequeño')) {
            isSmallSizeSelected = true;
          }
        }
      }

      activeProduct.modifiers.forEach(group => {
        if (group && group.selection_type === 'multiple') {
          const groupDiv = document.createElement('div');
          groupDiv.className = 'modifier-group';
          const colId = `collapsible-${group.group_id}-${sideKey}`;
          const isExplicitlyCollapsed = this.customizerState.collapsedGroups && this.customizerState.collapsedGroups[colId] === true;
          const listClass = isExplicitlyCollapsed ? 'modifier-options-list collapsed' : 'modifier-options-list';
          const chevronTransform = isExplicitlyCollapsed ? 'transform: rotate(-90deg);' : 'transform: rotate(0deg);';
          
          groupDiv.innerHTML = `
            <div class="modifier-group-title" onclick="MarketplaceApp.toggleGroupCollapse('${colId}', this)" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 700;">${group.group_name || ''}${sideLabel}</span>
              <span class="collapse-chevron" style="transition: transform 0.2s; font-size: 12px; ${chevronTransform}">▼</span>
            </div>
            <div class="${listClass}" id="${colId}"></div>
          `;
          const list = groupDiv.querySelector('.modifier-options-list');

          if (group.options && Array.isArray(group.options)) {
            group.options.forEach(opt => {
              if (!opt) return;
              const optNameLower = (opt.name || '').toLowerCase();
              if (isSmallSizeSelected && optNameLower.includes('borde')) {
                this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = 0;
                return;
              }

              const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
              const extraPriceText = (opt.extra_price || 0) > 0 ? `+ ${this.formatPesos(opt.extra_price)}` : '';
              
              const optionDiv = document.createElement('div');
              let stateClass = qty > 0 ? 'ingredient-extra' : '';

              optionDiv.className = `modifier-option ${stateClass}`;
              optionDiv.innerHTML = `
                <div class="option-label-container" onclick="MarketplaceApp.toggleMultipleSelection('${opt.option_id}', '${sideKey}')">
                  <input type="checkbox" ${qty > 0 ? 'checked' : ''} style="margin: 0;">
                  <span class="option-name" style="margin-left: 8px;">${opt.name || ''}</span>
                </div>
                <div style="display: flex; align-items: center;">
                  <span class="option-extra-price" style="margin-right: 8px;">${extraPriceText}</span>
                  <div class="option-qty-control" style="display: ${qty > 0 ? 'flex' : 'none'}">
                    <button class="btn-qty-mini" onclick="event.preventDefault(); event.stopPropagation(); MarketplaceApp.updateUnifiedQty('opt_${opt.option_id}', '${sideKey}', -1)">-</button>
                    <span class="option-qty-val">${qty}</span>
                    <button class="btn-qty-mini" onclick="event.preventDefault(); event.stopPropagation(); MarketplaceApp.updateUnifiedQty('opt_${opt.option_id}', '${sideKey}', 1)">+</button>
                  </div>
                </div>
              `;
              if (list) list.appendChild(optionDiv);
            });
          }

          // Only append the group if it has visible options left
          if (list && list.children.length > 0) {
            container.appendChild(groupDiv);
          }
        }
      });
    }
  }

  selectHalvesSpecialty(sideKey, productId) {
    const estProducts = (this.selectedEstablishment && Array.isArray(this.selectedEstablishment.products)) ? this.selectedEstablishment.products : [];
    const selectedProduct = estProducts.find(p => p.id === productId);
    
    let previousSizeOptId = null;
    const currentSpecialty = sideKey === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB;
    if (currentSpecialty && currentSpecialty.modifiers && Array.isArray(currentSpecialty.modifiers)) {
      const sizeGroup = currentSpecialty.modifiers.find(g => (g.group_name || '').toLowerCase() === 'tamaño');
      if (sizeGroup && Array.isArray(sizeGroup.options)) {
        const found = sizeGroup.options.find(opt => this.customizerState.quantities[sideKey]['opt_' + opt.option_id] === 1);
        if (found) previousSizeOptId = found.option_id;
      }
    }

    if (sideKey === 'halfA') {
      this.customizerState.specialtyA = selectedProduct || null;
    } else {
      this.customizerState.specialtyB = selectedProduct || null;
    }

    if (selectedProduct) {
      if (selectedProduct.exclusions && Array.isArray(selectedProduct.exclusions)) {
        selectedProduct.exclusions.forEach(item => {
          const itemName = typeof item === 'object' && item.name ? item.name : String(item);
          this.customizerState.quantities[sideKey]['base_' + itemName] = 1;
        });
      }

      if (selectedProduct.modifiers && Array.isArray(selectedProduct.modifiers)) {
        selectedProduct.modifiers.forEach(group => {
          if (group && group.selection_type === 'single' && Array.isArray(group.options)) {
            const isSizeGroup = (group.group_name || '').toLowerCase() === 'tamaño';
            group.options.forEach((opt, idx) => {
              if (opt && opt.option_id) {
                if (isSizeGroup && previousSizeOptId) {
                  this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = (opt.option_id === previousSizeOptId) ? 1 : 0;
                } else {
                  this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = (idx === 0) ? 1 : 0;
                }
              }
            });
          } else {
            group.options.forEach(opt => {
              this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = 0;
            });
          }
        });
      }

      const sizeGroup = selectedProduct.modifiers ? selectedProduct.modifiers.find(g => g.group_name.toLowerCase() === 'tamaño') : null;
      if (sizeGroup) {
        const selectedSizeOpt = sizeGroup.options.find(opt => this.customizerState.quantities[sideKey]['opt_' + opt.option_id] === 1);
        if (selectedSizeOpt) {
          const otherSideKey = sideKey === 'halfA' ? 'halfB' : 'halfA';
          const otherSpecialty = otherSideKey === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB;
          if (otherSpecialty && otherSpecialty.modifiers) {
            const otherSizeGroup = otherSpecialty.modifiers.find(g => g.group_name.toLowerCase() === 'tamaño');
            if (otherSizeGroup) {
              const sameNameOpt = otherSizeGroup.options.find(opt => opt.name.toLowerCase() === selectedSizeOpt.name.toLowerCase());
              const targetOptId = sameNameOpt ? sameNameOpt.option_id : otherSizeGroup.options[0].option_id;
              otherSizeGroup.options.forEach(opt => {
                this.customizerState.quantities[otherSideKey]['opt_' + opt.option_id] = (opt.option_id === targetOptId) ? 1 : 0;
              });
            }
          }
        }
      }
    } else {
      this.customizerState.quantities[sideKey] = {};
    }

    this.renderCustomizerModifiers();
  }

  setSingleSelection(groupId, optionId, sideKey) {
    const isHalves = this.customizerState.pizzaMode === 'halves';
    let product = this.customizerState.product;
    if (isHalves) {
      product = sideKey === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB;
    }
    if (!product) return;

    const group = product.modifiers.find(g => g.group_id === groupId);
    if (group) {
      const isPizza = product.category === 'Pizzas' || product.name.toLowerCase().includes('pizza');
      const isSizeGroup = group.group_name.toLowerCase() === 'tamaño';

      if (isPizza && isSizeGroup) {
        ['whole', 'halfA', 'halfB'].forEach(key => {
          let currentProduct = this.customizerState.product;
          if (isHalves) {
            currentProduct = key === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB;
          }
          if (!currentProduct || !currentProduct.modifiers) return;
          const targetGroup = currentProduct.modifiers.find(g => g.group_name.toLowerCase() === 'tamaño');
          if (targetGroup) {
            const origOpt = group.options.find(o => o.option_id === optionId);
            if (origOpt) {
              const matchedOpt = targetGroup.options.find(o => o.name.toLowerCase() === origOpt.name.toLowerCase());
              targetGroup.options.forEach(opt => {
                this.customizerState.quantities[key]['opt_' + opt.option_id] = (matchedOpt && opt.option_id === matchedOpt.option_id) ? 1 : 0;
              });
            }
          }
        });
      } else {
        group.options.forEach(opt => {
          this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = (opt.option_id === optionId) ? 1 : 0;
        });
      }
    }
    this.renderCustomizerModifiers();
  }

  toggleMultipleSelection(optionId, sideKey) {
    const key = 'opt_' + optionId;
    const current = this.customizerState.quantities[sideKey][key] || 0;
    this.customizerState.quantities[sideKey][key] = (current === 0) ? 1 : 0;
    this.renderCustomizerModifiers();
  }

  updateUnifiedQty(itemKey, sideKey, delta) {
    let current = this.customizerState.quantities[sideKey][itemKey] || 0;
    current += delta;
    
    if (itemKey.startsWith('base_')) {
      if (current < 0) current = 0;
      if (current > 5) current = 5;
    } else {
      if (current < 0) current = 0;
    }
    
    this.customizerState.quantities[sideKey][itemKey] = current;
    this.renderCustomizerModifiers();
  }

  setPizzaMode(mode) {
    this.customizerState.pizzaMode = mode;
    
    const wholeBtn = document.getElementById('pizza-whole-btn');
    const halvesBtn = document.getElementById('pizza-halves-btn');
    
    if (mode === 'whole') {
      wholeBtn.classList.add('active');
      halvesBtn.classList.remove('active');
      
      this.customizerState.specialtyA = null;
      this.customizerState.specialtyB = null;
      this.customizerState.quantities.halfA = {};
      this.customizerState.quantities.halfB = {};
    } else {
      wholeBtn.classList.remove('active');
      halvesBtn.classList.add('active');
      
      this.customizerState.specialtyA = null;
      this.customizerState.specialtyB = null;
      this.customizerState.quantities.halfA = {};
      this.customizerState.quantities.halfB = {};
    }
    
    this.renderCustomizerModifiers();
  }

  validateRequiredModifiers() {
    const product = this.customizerState.product;
    const isHalves = this.customizerState.pizzaMode === 'halves';
    
    if (isHalves) {
      if (!this.customizerState.specialtyA || !this.customizerState.specialtyB) {
        return false;
      }
    }

    let allValid = true;
    
    const contornosMatch = product.name.match(/(\d+)\s+Contornos/i);
    const maxContornosAllowed = contornosMatch ? parseInt(contornosMatch[1], 10) : null;
    
    const checkSide = (sideKey) => {
      let currentProduct = product;
      if (isHalves) {
        currentProduct = sideKey === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB;
      }
      if (!currentProduct || !currentProduct.modifiers) return;

      let selectedContornosCount = 0;
      currentProduct.modifiers.forEach(group => {
        if (group.selection_type === 'multiple') {
          group.options.forEach(opt => {
            const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
            if (qty > 0) {
              selectedContornosCount += qty;
            }
          });
        }
        
        if (group.is_required && group.selection_type === 'single') {
          const active = group.options.some(opt => this.customizerState.quantities[sideKey]['opt_' + opt.option_id] === 1);
          if (!active) allValid = false;
        }
      });
      
      if (maxContornosAllowed !== null && selectedContornosCount !== maxContornosAllowed) {
        allValid = false;
      }
    };
    
    if (isHalves) {
      checkSide('halfA');
      checkSide('halfB');
    } else {
      checkSide('whole');
    }
    
    return allValid;
  }

  calculateExtrasTotal() {
    if (!this.customizerState || !this.customizerState.product) return 0;
    const product = this.customizerState.product;
    const isHalves = this.customizerState.pizzaMode === 'halves';
    
    const sumForSide = (sideKey) => {
      let sideSum = 0;
      let activeProduct = product;
      if (isHalves) {
        activeProduct = sideKey === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB;
      }
      if (!activeProduct) return 0;
      
      const isSpecialZeroInit = this.isArepaOrHeladoProduct(activeProduct);
      if (activeProduct.exclusions && Array.isArray(activeProduct.exclusions)) {
        activeProduct.exclusions.forEach(item => {
          const itemName = typeof item === 'object' && item.name ? item.name : String(item);
          const basePrice = (typeof item === 'object' && item.price !== undefined) ? item.price : 500;
          const qty = this.customizerState.quantities[sideKey]['base_' + itemName] || 0;
          if (isSpecialZeroInit) {
            sideSum += qty * basePrice;
          } else {
            if (qty > 1) {
              sideSum += (qty - 1) * basePrice;
            }
          }
        });
      }
      
      if (activeProduct.modifiers && Array.isArray(activeProduct.modifiers)) {
        activeProduct.modifiers.forEach(group => {
          if (group && group.options && Array.isArray(group.options)) {
            group.options.forEach(opt => {
              if (opt && opt.option_id) {
                const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
                if (qty > 1) {
                  sideSum += this.normalizeCopPrice(opt.extra_price) * (qty - 1);
                }
              }
            });
          }
        });
      }
      
      return sideSum;
    };
    
    if (isHalves) {
      return sumForSide('halfA') + sumForSide('halfB');
    } else {
      return sumForSide('whole');
    }
  }

  updateCustomizerPrice() {
    if (!this.customizerState || !this.customizerState.product) return;
    const isHalves = this.customizerState.pizzaMode === 'halves';
    let basePrice = this.normalizeCopPrice(this.customizerState.product.price);
    if (isHalves) {
      const priceA = this.customizerState.specialtyA ? this.normalizeCopPrice(this.customizerState.specialtyA.price) : 0;
      const priceB = this.customizerState.specialtyB ? this.normalizeCopPrice(this.customizerState.specialtyB.price) : 0;
      basePrice = (priceA + priceB) / 2;
    }
    const extrasTotal = this.calculateExtrasTotal();
    const qty = this.customizerState.quantity || 1;
    
    const unitPrice = basePrice + extrasTotal;
    const combinedTotal = unitPrice * qty;
    
    const topPriceEl = document.getElementById('customizer-base-price');
    if (topPriceEl) {
      topPriceEl.innerText = this.formatPesos(unitPrice);
    }
    
    const allValid = this.validateRequiredModifiers();
    
    const pName = this.customizerState.product.name || '';
    const contornosMatch = pName.match(/(\d+)\s+Contornos/i);
    const maxContornosAllowed = contornosMatch ? parseInt(contornosMatch[1], 10) : null;
    
    const sideKey = isHalves ? 'halfA' : 'whole';
    let selectedContornosCount = 0;
    const activeProduct = isHalves ? this.customizerState.specialtyA : this.customizerState.product;
    if (activeProduct && activeProduct.modifiers && Array.isArray(activeProduct.modifiers)) {
      activeProduct.modifiers.forEach(group => {
        if (group && group.selection_type === 'multiple' && Array.isArray(group.options)) {
          group.options.forEach(opt => {
            if (opt && opt.option_id) {
              const selectedQty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
              if (selectedQty > 0) {
                selectedContornosCount += selectedQty;
              }
            }
          });
        }
      });
    }

    const btn = document.getElementById('btn-confirm-add');
    if (btn) {
      if (maxContornosAllowed !== null && selectedContornosCount !== maxContornosAllowed) {
        btn.innerText = `Elige exactamente ${maxContornosAllowed} Contorno(s) (${selectedContornosCount}/${maxContornosAllowed})`;
        btn.disabled = true;
      } else {
        btn.innerText = `Agregar al Carrito • ${this.formatPesos(combinedTotal)}`;
        btn.disabled = !allValid;
      }
    }
  }

  updateCustomizerQty(delta) {
    let currentQty = this.customizerState.quantity;
    currentQty += delta;
    if (currentQty < 1) currentQty = 1;
    
    this.customizerState.quantity = currentQty;
    document.getElementById('customizer-quantity-display').innerText = currentQty;
    this.updateCustomizerPrice();
  }

  addToCart() {
    if (!this.customizerState || !this.customizerState.product) return;

    if (this.selectedEstablishment && !this.isEstablishmentOpen(this.selectedEstablishment)) {
      alert(`🔴 ${this.selectedEstablishment.name} está actualmente CERRADO.\n\nHorario de Atención: ${this.formatTime12h(this.selectedEstablishment.open_time)} a ${this.formatTime12h(this.selectedEstablishment.close_time)}.\n\nPuedes explorar el menú completo, pero los pedidos están pausados hasta la hora de apertura.`);
      return;
    }
    
    if (!this.validateRequiredModifiers()) {
      alert('Por favor, selecciona las opciones obligatorias marcadas con *');
      return;
    }

    const product = this.customizerState.product;
    const isHalves = this.customizerState.pizzaMode === 'halves';
    
    const singleSelections = [];
    const addOns = [];
    const exclusions = [];
    
    const processSide = (sideKey) => {
      const activeProduct = isHalves 
        ? (sideKey === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB)
        : product;
        
      if (!activeProduct || !activeProduct.modifiers) return;
      
      const prefix = isHalves ? (sideKey === 'halfA' ? '[Mitad 1] ' : '[Mitad 2] ') : '';

      activeProduct.modifiers.forEach(group => {
        if (!group || !group.options) return;

        if (group.selection_type === 'single') {
          const chosenOptId = this.customizerState.singleSelections[sideKey][group.group_id];
          if (chosenOptId) {
            const opt = group.options.find(o => o.option_id === chosenOptId);
            if (opt) {
              singleSelections.push({
                group_id: group.group_id,
                group_name: prefix + group.title,
                chosen_option: opt.name,
                extra_price: this.normalizeCopPrice(opt.extra_price)
              });
            }
          }
        } else if (group.selection_type === 'multiple') {
          group.options.forEach(opt => {
            const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
            if (qty > 0) {
              addOns.push({
                option_id: opt.option_id,
                name: prefix + opt.name,
                quantity: qty,
                price_per_unit: this.normalizeCopPrice(opt.extra_price)
              });
            }
          });
        }
      });

      if (this.customizerState.baseIngredients[sideKey]) {
        Object.keys(this.customizerState.baseIngredients[sideKey]).forEach(ingName => {
          if (this.customizerState.baseIngredients[sideKey][ingName] === false) {
            exclusions.push({ name: prefix + ingName });
          }
        });
      }
    };

    if (isHalves) {
      processSide('halfA');
      processSide('halfB');
    } else {
      processSide('whole');
    }
    
    const specialNotes = document.getElementById('customizer-special-notes').value.trim();
    let basePrice = this.normalizeCopPrice(product.price);
    if (isHalves) {
      const priceA = this.customizerState.specialtyA ? this.normalizeCopPrice(this.customizerState.specialtyA.price) : 0;
      const priceB = this.customizerState.specialtyB ? this.normalizeCopPrice(this.customizerState.specialtyB.price) : 0;
      basePrice = (priceA + priceB) / 2;
    }
    const extrasTotal = this.calculateExtrasTotal();
    const unitTotalCalculated = basePrice + extrasTotal;
    const qty = this.customizerState.quantity;
    const subtotalCombined = unitTotalCalculated * qty;
    
    // Reset local state if needed
    
    this.customizerState.quantity = 1;
    document.getElementById('customizer-quantity-display').innerText = 1;
    this.updateCustomizerPrice();
  }

  closeCustomizerModal() {
    const modal = document.getElementById('customizer-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.classList.remove('active');
      modal.style.display = 'none';
      modal.style.opacity = '0';
      modal.style.visibility = 'hidden';
      modal.style.pointerEvents = 'none';
    }
  }

  confirmCustomizerAdd() {
    const product = this.customizerState.product;
    const isHalves = this.customizerState.pizzaMode === 'halves';
    
    const singleSelections = [];
    const addOns = [];
    const exclusions = [];
    
    const formatSidePrefix = (sideKey) => {
      if (sideKey === 'halfA') return '[Mitad A] ';
      if (sideKey === 'halfB') return '[Mitad B] ';
      return '';
    };

    const processSide = (sideKey) => {
      const prefix = formatSidePrefix(sideKey);
      let activeProduct = product;
      if (isHalves) {
        activeProduct = sideKey === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB;
      }
      if (!activeProduct) return;

      if (isHalves) {
        singleSelections.push({
          group_name: prefix + 'Sabor',
          chosen_option: activeProduct.name
        });
      }
      
      // 1. Base ingredients (exclusions and extras)
      const isSpecialZeroInit = this.isArepaOrHeladoProduct(activeProduct);
      if (activeProduct.exclusions) {
        activeProduct.exclusions.forEach(item => {
          const itemName = item.name || item;
          const basePrice = item.price !== undefined ? item.price : 500;
          const qty = this.customizerState.quantities[sideKey]['base_' + itemName] || 0;
          if (isSpecialZeroInit) {
            if (qty > 0) {
              addOns.push({
                name: prefix + `${itemName}`,
                price_per_unit: basePrice,
                quantity: qty
              });
            }
          } else {
            if (qty === 0) {
              exclusions.push({ name: prefix + `Sin ${itemName}` });
            } else if (qty > 1) {
              addOns.push({
                name: prefix + `${itemName} Extra`,
                price_per_unit: basePrice,
                quantity: qty - 1
              });
            }
          }
        });
      }

      // 2. Modifiers
      if (activeProduct.modifiers) {
        activeProduct.modifiers.forEach(group => {
          group.options.forEach(opt => {
            const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
            if (qty > 0) {
              if (group.selection_type === 'single') {
                singleSelections.push({
                  group_name: prefix + group.group_name,
                  chosen_option: opt.name
                });
              } else {
                const chargeableQty = qty > 1 ? (qty - 1) : 0;
                addOns.push({
                  name: prefix + opt.name + (qty === 1 ? ' (Incluido)' : ` (x${qty})`),
                  price_per_unit: opt.extra_price || 0,
                  quantity: chargeableQty
                });
              }
            }
          });
        });
      }
    };
    
    if (isHalves) {
      processSide('halfA');
      processSide('halfB');
    } else {
      processSide('whole');
    }
    
    const specialNotes = document.getElementById('customizer-special-notes').value.trim();
    let basePrice = product.price;
    if (isHalves) {
      const priceA = this.customizerState.specialtyA ? this.customizerState.specialtyA.price : 0;
      const priceB = this.customizerState.specialtyB ? this.customizerState.specialtyB.price : 0;
      basePrice = (priceA + priceB) / 2;
    }
    const extrasTotal = this.calculateExtrasTotal();
    const unitTotalCalculated = basePrice + extrasTotal;
    const qty = this.customizerState.quantity;
    const subtotalCombined = unitTotalCalculated * qty;
    
    const cartItemId = 'item-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    
    let itemName = product.name;
    if (isHalves) {
      itemName = `${product.name} (Mitades: ${this.customizerState.specialtyA ? this.customizerState.specialtyA.name : 'N/A'} / ${this.customizerState.specialtyB ? this.customizerState.specialtyB.name : 'N/A'})`;
    }

    const cartItem = {
      cart_item_id: cartItemId,
      product_id: product.id,
      product_name: itemName,
      restaurant_id: this.selectedEstablishment.id,
      restaurant_name: this.selectedEstablishment.name,
      delivery_fee: this.selectedEstablishment.delivery_fee || 0,
      quantity: qty,
      selected_specifications: {
        single_selections: singleSelections,
        add_ons: addOns,
        exclusions: exclusions,
        special_notes: specialNotes
      },
      unit_total_calculated: unitTotalCalculated,
      subtotal_combined: subtotalCombined,
      product: product
    };
    
    this.cart.items.push(cartItem);
    
    this.updateCartBadge();
    this.closeCustomizerModal();
    this.showToast(`Agregado: ${product.name}`);
    
    this.animateFlyToCart(window.event);
  }

  animateFlyToCart(event) {
    let startX = window.innerWidth / 2;
    let startY = window.innerHeight / 2;
    
    if (event && event.clientX && event.clientY) {
      startX = event.clientX;
      startY = event.clientY;
    } else {
      const btn = document.getElementById('btn-confirm-add');
      if (btn) {
        const rect = btn.getBoundingClientRect();
        startX = rect.left + rect.width / 2;
        startY = rect.top + rect.height / 2;
      }
    }
    
    const cartBtn = document.getElementById('floating-cart');
    if (!cartBtn) return;
    const cartRect = cartBtn.getBoundingClientRect();
    const endX = cartRect.left + cartRect.width / 2;
    const endY = cartRect.top + cartRect.height / 2;
    
    const dot = document.createElement('div');
    dot.className = 'flying-dot';
    dot.style.left = startX + 'px';
    dot.style.top = startY + 'px';
    document.body.appendChild(dot);
    
    dot.style.transition = 'all 0.8s cubic-bezier(0.25, 1, 0.5, 1)';
    
    setTimeout(() => {
      dot.style.left = endX + 'px';
      dot.style.top = endY + 'px';
      dot.style.transform = 'scale(0.3)';
      dot.style.opacity = '0';
    }, 20);
    
    setTimeout(() => {
      dot.remove();
      
      // Trigger Cart Bounce animation with glow
      cartBtn.classList.remove('cart-bounce-effect');
      void cartBtn.offsetWidth;
      cartBtn.classList.add('cart-bounce-effect');
      setTimeout(() => cartBtn.classList.remove('cart-bounce-effect'), 700);

      const badgeCount = document.getElementById('cart-badge-count');
      if (badgeCount) {
        badgeCount.classList.remove('badge-pop');
        void badgeCount.offsetWidth;
        badgeCount.classList.add('badge-pop');
      }
    }, 600);
  }

  updateQty(cartItemId, delta) {
    const itemIndex = this.cart.items.findIndex(item => item.cart_item_id === cartItemId);
    if (itemIndex === -1) return;

    const item = this.cart.items[itemIndex];
    item.quantity += delta;

    if (item.quantity <= 0) {
      this.cart.items.splice(itemIndex, 1);
    } else {
      item.unit_total_calculated = this.normalizeCopPrice(item.unit_total_calculated);
      item.subtotal_combined = this.normalizeCopPrice(item.unit_total_calculated * item.quantity);
    }

    this.updateCartBadge();
    this.renderCartItems();
  }

  clearCart() {
    this.cart.items = [];
    this.updateCartBadge();
  }

  updateCartBadge() {
    const badge = document.getElementById('floating-cart');
    const badgeCount = document.getElementById('cart-badge-count');
    const badgeTotal = document.getElementById('cart-badge-total');

    const headerCount = document.getElementById('header-cart-badge-count');
    const headerTotal = document.getElementById('header-cart-badge-total');

    const totalCount = this.cart.items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = this.cart.items.reduce((sum, item) => sum + this.normalizeCopPrice(item.subtotal_combined), 0);

    const formattedTotal = this.formatPesos(subtotal);

    if (badgeCount) badgeCount.innerText = totalCount;
    if (badgeTotal) badgeTotal.innerText = formattedTotal;

    if (headerCount) headerCount.innerText = totalCount;
    if (headerTotal) headerTotal.innerText = formattedTotal;

    if (totalCount > 0 && badgeCount) {
      badgeCount.classList.remove('badge-pop');
      void badgeCount.offsetWidth;
      badgeCount.classList.add('badge-pop');
    }

    if (badge) {
      badge.style.display = 'flex';
      badge.classList.add('visible');
    }
  }

  // Modals
  openTermsModal() {
    this.closeAllModals();
    const modal = document.getElementById('terms-modal');
    if (modal) {
      modal.classList.add('open');
      modal.style.setProperty('display', 'flex', 'important');
    }
  }

  openCartModal() {
    this.closeAllModals();
    const modal = document.getElementById('cart-modal');
    if (modal) {
      modal.classList.add('open');
      modal.style.setProperty('display', 'flex', 'important');
    }
    this.renderCartItems();
    this.setActiveMobileTab('cart');
    window.history.pushState({ view: 'modal', modalId: 'cart-modal' }, '');
  }

  closeCartModal() {
    const modal = document.getElementById('cart-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.classList.remove('active');
      // Let CSS handle display via .open class
    }
    this.setActiveMobileTab('home');
  }

  renderCartItems() {
    const container = document.getElementById('cart-items-container');
    container.innerHTML = '';

    if (this.cart.items.length === 0) {
      container.innerHTML = `
        <div class="cart-empty-state">
          <span>🛒</span>
          <p>Tu carrito está vacío. Agrega productos del comercio activo.</p>
        </div>
      `;
      document.getElementById('checkout-form').style.display = 'none';
      return;
    }

    document.getElementById('checkout-form').style.display = 'block';
    
    // Group unique establishments
    const uniqueShops = {};
    this.cart.items.forEach(item => {
      if (!uniqueShops[item.restaurant_id]) {
        uniqueShops[item.restaurant_id] = {
          id: item.restaurant_id,
          name: item.restaurant_name,
          delivery_fee: item.delivery_fee || 0
        };
      }
    });

    const shopIds = Object.keys(uniqueShops);
    const numShops = shopIds.length;

    // Header listing shops we order from
    const shopNamesList = shopIds.map(id => uniqueShops[id].name).join(', ');
    const shopHeader = document.createElement('div');
    shopHeader.style.paddingBottom = '10px';
    shopHeader.style.fontWeight = 'bold';
    shopHeader.style.color = 'var(--primary)';
    shopHeader.innerText = `Ordenando de: ${shopNamesList}`;
    container.appendChild(shopHeader);

    // List items
    this.cart.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'cart-item-row';
      
      let specsHTML = '';
      const specs = item.selected_specifications;
      const specsParts = [];
      
      if (specs.single_selections && specs.single_selections.length > 0) {
        specs.single_selections.forEach(sel => {
          specsParts.push(`${sel.group_name}: ${sel.chosen_option}`);
        });
      }
      if (specs.add_ons && specs.add_ons.length > 0) {
        specs.add_ons.forEach(add => {
          const qty = add.quantity || 1;
          const price = (add.price_per_unit || 0) * qty;
          const priceText = price > 0 ? ` (+${this.formatPesos(this.normalizeCopPrice(price))})` : '';
          specsParts.push(`+ ${qty}x ${add.name}${priceText}`);
        });
      }
      if (specs.exclusions && specs.exclusions.length > 0) {
        specs.exclusions.forEach(exc => {
          specsParts.push(`- Sin ${exc.name}`);
        });
      }
      if (specs.special_notes) {
        specsParts.push(`Nota: "${specs.special_notes}"`);
      }
      
      if (specsParts.length > 0) {
        specsHTML = `<div class="cart-item-specifications">${specsParts.join(', ')}</div>`;
      }

      row.innerHTML = `
        <div class="cart-item-details">
          <div class="cart-item-name" style="font-weight: 700;">${item.product_name}</div>
          ${specsHTML}
          <div class="cart-item-price" style="font-size: 13px; font-weight: 600; margin-top: 2px;">
            ${this.formatPesos(item.subtotal_combined)} <span style="color: var(--text-muted); font-weight: 500;">(${this.formatPesos(item.unit_total_calculated)} c/u)</span>
          </div>
        </div>
        <div class="cart-item-controls">
          <button class="btn-qty" onclick="MarketplaceApp.updateQty('${item.cart_item_id}', -1)">-</button>
          <span class="cart-item-qty" style="font-weight: 700;">${item.quantity}</span>
          <button class="btn-qty" onclick="MarketplaceApp.updateQty('${item.cart_item_id}', 1)">+</button>
        </div>
      `;
      container.appendChild(row);
    });
    let totalDeliveryFee = 0;
    if (this.orderType === 'delivery') {
      shopIds.forEach(id => {
        const shopItems = this.cart.items.filter(item => item.restaurant_id === id);
        const shopSubtotal = shopItems.reduce((sum, item) => sum + this.normalizeCopPrice(item.subtotal_combined), 0);

        const fee = this.calculateShopDeliveryFee(this.calculatedDistanceKm, uniqueShops[id].delivery_fee);
        uniqueShops[id].delivery_fee = fee;
        totalDeliveryFee += fee;
      });
    }

    // Render multi-delivery warning block if numShops > 1 and orderType is 'delivery'
    const warningDiv = document.getElementById('multi-delivery-warning');
    if (numShops > 1 && this.orderType === 'delivery') {
      let listItemsHTML = '';
      shopIds.forEach(id => {
        const shop = uniqueShops[id];
        listItemsHTML += `
          <li class="multi-delivery-item">
            <span>Envío desde '${shop.name}':</span>
            <span>${this.formatPesos(shop.delivery_fee)}</span>
          </li>
        `;
      });
      
      warningDiv.innerHTML = `
        <div class="multi-delivery-warning-title">
          <span>⚠️ AVISO DE ENVÍO MULTI-ESTABLECIMIENTO</span>
        </div>
        <p style="margin-bottom: 8px; font-weight: 500;">Tu pedido contiene productos de <strong>${numShops}</strong> locales diferentes.</p>
        <ul class="multi-delivery-list">
          ${listItemsHTML}
        </ul>
        <hr class="multi-delivery-divider">
        <div class="multi-delivery-total-row">
          <span>Total de servicio a domicilio:</span>
          <span>${this.formatPesos(totalDeliveryFee)}</span>
        </div>
      `;
      warningDiv.classList.remove('hidden');
    } else {
      warningDiv.classList.add('hidden');
      warningDiv.innerHTML = '';
    }

    const subtotal = this.cart.items.reduce((sum, item) => sum + this.normalizeCopPrice(item.subtotal_combined), 0);
    
    let discountAmount = 0;
    if (this.activeCoupon) {
      if (this.activeCoupon.type === 'delivery') {
        discountAmount = totalDeliveryFee;
      } else if (this.activeCoupon.type === 'fixed') {
        const usdRate = (window.systemSettings && window.systemSettings.cop_rate) ? window.systemSettings.cop_rate : 4000;
        discountAmount = this.activeCoupon.amount * usdRate;
      } else if (this.activeCoupon.type === 'percent') {
        discountAmount = Math.round(subtotal * (this.activeCoupon.amount / 100));
      }
    }
    discountAmount = Math.min(discountAmount, subtotal + totalDeliveryFee);
    const grandTotal = Math.max(0, subtotal + totalDeliveryFee - discountAmount);

    document.getElementById('cart-subtotal').innerText = this.formatPesos(subtotal);
    
    const deliveryCostSpan = document.getElementById('cart-delivery-cost');
    deliveryCostSpan.innerText = this.formatPesos(totalDeliveryFee);

    const discountRow = document.getElementById('cart-discount-row');
    const discountVal = document.getElementById('cart-discount-val');
    if (discountAmount > 0) {
      if (discountRow) discountRow.classList.remove('hidden');
      if (discountVal) discountVal.innerText = `-${this.formatPesos(discountAmount)}`;
    } else {
      if (discountRow) discountRow.classList.add('hidden');
    }
    
    document.getElementById('cart-grand-total').innerText = this.formatPesos(grandTotal);
    
    const deliveryRow = document.querySelector('.delivery-cost-row');
    if (this.orderType === 'delivery') {
      deliveryRow.classList.remove('hidden');
      if (numShops === 1) {
        const singleShopId = shopIds[0];
        deliveryCostSpan.innerText = this.formatPesos(uniqueShops[singleShopId].delivery_fee);
      } else {
        deliveryCostSpan.innerText = this.formatPesos(totalDeliveryFee);
      }
    } else {
      deliveryRow.classList.add('hidden');
    }
  }

  setOrderType(type) {
    this.orderType = type;
    const delBtn = document.getElementById('type-delivery-btn');
    const tableBtn = document.getElementById('type-mesa-btn');
    const groupDelivery = document.getElementById('group-delivery');
    const groupMesa = document.getElementById('group-mesa');

    if (type === 'delivery') {
      delBtn.classList.add('active');
      tableBtn.classList.remove('active');
      groupDelivery.classList.remove('hidden');
      groupMesa.classList.add('hidden');
    } else {
      delBtn.classList.remove('active');
      tableBtn.classList.add('active');
      groupDelivery.classList.add('hidden');
      groupMesa.classList.remove('hidden');
      this.renderCustomerTableMap();
    }

    this.renderCartItems();
  }

  setPaymentMethod(method) {
    this.paymentMethod = method;
    const cashBtn = document.getElementById('pay-cash-btn');
    const transferBtn = document.getElementById('pay-transfer-btn');
    const cashDetails = document.getElementById('payment-cash-details');
    const transferDetails = document.getElementById('payment-transfer-details');

    if (method === 'Efectivo') {
      if (cashBtn) cashBtn.classList.add('active');
      if (transferBtn) transferBtn.classList.remove('active');
      if (cashDetails) cashDetails.classList.remove('hidden');
      if (transferDetails) transferDetails.classList.add('hidden');
    } else {
      if (cashBtn) cashBtn.classList.remove('active');
      if (transferBtn) transferBtn.classList.add('active');
      if (cashDetails) cashDetails.classList.add('hidden');
      if (transferDetails) transferDetails.classList.remove('hidden');
    }
  }

  detectPhoneCountry() {
    const phoneInput = document.getElementById('order-phone');
    const countrySelect = document.getElementById('order-phone-country');
    const badgeEl = document.getElementById('phone-country-detected-badge');
    if (!phoneInput || !countrySelect) return;

    let raw = phoneInput.value.trim();
    if (!raw) {
      if (badgeEl) badgeEl.style.display = 'none';
      return;
    }

    let clean = raw.replace(/[^\d+]/g, '');
    let detectedCountry = null;

    // Check international prefixes
    if (clean.startsWith('+58') || clean.startsWith('58')) {
      detectedCountry = { code: '+58', name: 'Venezuela', flag: '🇻🇪' };
    } else if (clean.startsWith('+57') || clean.startsWith('57')) {
      detectedCountry = { code: '+57', name: 'Colombia', flag: '🇨🇴' };
    } else if (clean.startsWith('+52') || clean.startsWith('52')) {
      detectedCountry = { code: '+52', name: 'México', flag: '🇲🇽' };
    } else if (clean.startsWith('+1') || (clean.startsWith('1') && clean.length >= 10)) {
      detectedCountry = { code: '+1', name: 'EE.UU. / Canadá', flag: '🇺🇸' };
    } else if (clean.startsWith('+34') || clean.startsWith('34')) {
      detectedCountry = { code: '+34', name: 'España', flag: '🇪🇸' };
    } else if (clean.startsWith('+593') || clean.startsWith('593')) {
      detectedCountry = { code: '+593', name: 'Ecuador', flag: '🇪🇨' };
    } else if (clean.startsWith('+51') || clean.startsWith('51')) {
      detectedCountry = { code: '+51', name: 'Perú', flag: '🇵🇪' };
    } else if (clean.startsWith('+56') || clean.startsWith('56')) {
      detectedCountry = { code: '+56', name: 'Chile', flag: '🇨🇱' };
    } else if (clean.startsWith('+54') || clean.startsWith('54')) {
      detectedCountry = { code: '+54', name: 'Argentina', flag: '🇦🇷' };
    } 
    // Check local mobile prefixes
    else if (/^(0?412|0?414|0?424|0?416|0?426)/.test(clean)) {
      detectedCountry = { code: '+58', name: 'Venezuela', flag: '🇻🇪' };
    } else if (/^3[0-2,5]\d{8}/.test(clean) || /^3(0[0-5]|1[0-9]|2[0-4]|50)/.test(clean)) {
      detectedCountry = { code: '+57', name: 'Colombia', flag: '🇨🇴' };
    } else if (/^[67]\d{8}/.test(clean)) {
      detectedCountry = { code: '+34', name: 'España', flag: '🇪🇸' };
    }

    if (detectedCountry) {
      countrySelect.value = detectedCountry.code;

      // Auto-clean prefix from input text box if user typed country code
      if (raw.startsWith('+') || raw.startsWith(detectedCountry.code.replace('+', ''))) {
        let stripped = raw;
        if (stripped.startsWith(detectedCountry.code)) {
          stripped = stripped.replace(detectedCountry.code, '').trim();
        } else if (stripped.startsWith(detectedCountry.code.replace('+', ''))) {
          stripped = stripped.replace(detectedCountry.code.replace('+', ''), '').trim();
        }
        if (stripped !== raw && stripped.length > 0) {
          phoneInput.value = stripped;
        }
      }

      if (badgeEl) {
        badgeEl.style.display = 'inline-flex';
        badgeEl.innerHTML = `<span>${detectedCountry.flag}</span> ${detectedCountry.name} (${detectedCountry.code})`;
      }
    } else {
      if (badgeEl) badgeEl.style.display = 'none';
    }
  }

  async submitOrder() {
    const acceptTerms = document.getElementById('checkout-accept-terms').checked;
    if (!acceptTerms) {
      alert('Debes aceptar los Términos y Condiciones y autorizar la verificación telefónica para enviar tu pedido.');
      return;
    }

    const customerName = document.getElementById('order-customer-name').value.trim();
    
    let tableNumber = null;
    let phone = null;
    let address = null;

    if (this.orderType === 'mesa') {
      tableNumber = document.getElementById('order-table-number').value.trim();
      if (!customerName || !tableNumber) {
        alert('Por favor, indica tu nombre y número de mesa.');
        return;
      }
    } else {
      const countryCode = document.getElementById('order-phone-country') ? document.getElementById('order-phone-country').value : '+58';
      let rawPhone = document.getElementById('order-phone').value.trim();
      address = document.getElementById('order-address').value.trim();

      if (!customerName || !rawPhone || !address) {
        alert('Por favor, completa todos los campos de entrega.');
        return;
      }

      if (rawPhone.startsWith('+')) {
        phone = rawPhone;
      } else {
        rawPhone = rawPhone.replace(/^0+/, '');
        phone = `${countryCode} ${rawPhone}`;
      }
      if (this.selectedLatitude === null || this.selectedLongitude === null) {
        alert('Por favor, selecciona tu ubicación en el mapa haciendo clic en "🗺️ Seleccionar en Mapa" para calcular tu domicilio.');
        return;
      }
    }

    const paymentMethod = this.paymentMethod || 'Efectivo';
    let paymentNotes = '';
    const cashAmtInpEl = document.getElementById('order-cash-amount');
    if (paymentMethod === 'Efectivo' && cashAmtInpEl && cashAmtInpEl.value.trim()) {
      paymentNotes = `Paga con: ${cashAmtInpEl.value.trim()}`;
    }

    // Group items by restaurant_id
    const groupedItems = {};
    this.cart.items.forEach(item => {
      if (!groupedItems[item.restaurant_id]) {
        groupedItems[item.restaurant_id] = {
          id: item.restaurant_id,
          name: item.restaurant_name,
          delivery_fee: item.delivery_fee || 0,
          items: []
        };
      }
      groupedItems[item.restaurant_id].items.push(item);
    });

    // Upload house facade photo if attached
    let housePhotoUrl = null;
    const housePhotoInput = document.getElementById('order-house-photo');
    if (this.orderType === 'delivery' && housePhotoInput && housePhotoInput.files && housePhotoInput.files[0]) {
      try {
        const photoFile = housePhotoInput.files[0];
        const fileName = `uploads/house_${Date.now()}_${Math.floor(Math.random() * 1000)}.${photoFile.name.split('.').pop()}`;
        if (window.SupabaseHelper && window.SupabaseHelper.uploadImage) {
          housePhotoUrl = await window.SupabaseHelper.uploadImage(photoFile, fileName);
        }
        if (!housePhotoUrl) {
          // Fallback to Base64 data URL to guarantee delivery to kitchen KDS
          housePhotoUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(photoFile);
          });
        }
      } catch (err) {
        console.error('Error uploading house photo:', err);
      }
    }

    const shopIds = Object.keys(groupedItems);
    let lastCreatedOrderId = null;
    
    try {
      const promises = shopIds.map(async (shopId) => {
        const shop = groupedItems[shopId];
        const shopSubtotal = shop.items.reduce((sum, item) => sum + this.normalizeCopPrice(item.subtotal_combined), 0);
        let shopDeliveryCost = 0;
        if (this.orderType === 'delivery') {
          shopDeliveryCost = this.calculateShopDeliveryFee(this.calculatedDistanceKm, shop.delivery_fee);
        }
        // Generate random 4-digit security code for delivery
        const randomCode = this.orderType === 'delivery' ? Math.floor(1000 + Math.random() * 9000).toString() : null;
        
        const orderData = {
          establishmentId: shop.id,
          establishmentName: shop.name,
          items: shop.items.map(item => ({
            id: item.product_id,
            name: item.product_name,
            price: this.normalizeCopPrice(item.unit_total_calculated),
            quantity: item.quantity,
            specifications: this.getSpecsStringForKitchen(item.selected_specifications),
            selected_specifications: item.selected_specifications,
            unit_total_calculated: this.normalizeCopPrice(item.unit_total_calculated),
            subtotal_combined: this.normalizeCopPrice(item.subtotal_combined)
          })),
          total: shopSubtotal + shopDeliveryCost,
          orderType: this.orderType,
          paymentMethod,
          paymentNotes,
          customerName,
          tableNumber: tableNumber ? parseInt(tableNumber, 10) : null,
          deliveryDetails: this.orderType === 'delivery' ? { 
            phone, 
            address, 
            code: randomCode,
            latitude: this.selectedLatitude,
            longitude: this.selectedLongitude,
            distanceKm: this.calculatedDistanceKm,
            housePhotoUrl: housePhotoUrl || null
          } : null
        };

        const response = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderData)
        });

        if (!response.ok) {
          throw new Error(`Error en el pedido para ${shop.name}`);
        }
        const createdOrder = await response.json();
        if (createdOrder && createdOrder.id) {
          lastCreatedOrderId = createdOrder.id;
          localStorage.setItem('active_order_id', createdOrder.id);
          this.saveUserOrderToHistory(createdOrder);
        }
        return createdOrder;
      });

      // Check if Offline
      if (!navigator.onLine) {
        const rawQueue = localStorage.getItem('pending_offline_orders') || '[]';
        const queue = JSON.parse(rawQueue);
        shopIds.forEach(shopId => {
          const shop = groupedItems[shopId];
          const randomCode = Math.floor(100 + Math.random() * 900);
          queue.push({
            id: 'ord-off-' + Date.now() + Math.floor(Math.random() * 1000),
            establishmentId: shop.id,
            establishmentName: shop.name,
            items: shop.items,
            total: shop.items.reduce((sum, item) => sum + this.normalizeCopPrice(item.subtotal_combined), 0),
            orderType: this.orderType,
            paymentMethod,
            paymentNotes,
            customerName,
            tableNumber,
            deliveryDetails: { phone, address, code: randomCode }
          });
        });
        localStorage.setItem('pending_offline_orders', JSON.stringify(queue));
        this.addGochoPoints(25);
        this.showToast('📴 Pedido guardado sin conexión. Se enviará automáticamente al reconectar.');
        this.clearCart();
        this.closeCartModal();
        this.goHome();
        return;
      }

      await Promise.all(promises);

      // Award GochoPoints (10 pts per $1 spent)
      const cartSubtotalCop = this.cart.items.reduce((sum, item) => sum + this.normalizeCopPrice(item.subtotal_combined), 0);
      const estUsd = Math.max(1, Math.round(cartSubtotalCop / 4000));
      const earnedPts = estUsd * 10;
      this.addGochoPoints(earnedPts);

      this.sendPushNotification('¡Pedido Enviado! 🚀', `Tu pedido en ${shopIds.length} comercio(s) fue recibido. ¡Ganaste +${earnedPts} GochoPoints! ⭐`);
      this.showToast(`🔔 ¡Pedido enviado con éxito! ⭐ Ganaste +${earnedPts} GochoPoints`);
      this.clearCart();
      this.closeCartModal();
      
      // Reset form values safely
      const custNameInp = document.getElementById('order-customer-name');
      if (custNameInp) custNameInp.value = '';
      const tableInp = document.getElementById('order-table-number');
      if (tableInp) tableInp.value = '';
      const phoneInp = document.getElementById('order-phone');
      if (phoneInp) phoneInp.value = '';
      const addrInp = document.getElementById('order-address');
      if (addrInp) addrInp.value = '';
      const cashAmtInp = document.getElementById('order-cash-amount');
      if (cashAmtInp) cashAmtInp.value = '';
      const termsInp = document.getElementById('checkout-accept-terms');
      if (termsInp) termsInp.checked = false;
      
      // Reset map fields safely
      this.selectedLatitude = null;
      this.selectedLongitude = null;
      this.calculatedDistanceKm = null;
      const latInp = document.getElementById('order-lat');
      if (latInp) latInp.value = '';
      const lngInp = document.getElementById('order-lng');
      if (lngInp) lngInp.value = '';
      const distInp = document.getElementById('order-distance');
      if (distInp) distInp.value = '';
      const mapCont = document.getElementById('checkout-map-container');
      if (mapCont) mapCont.classList.add('hidden');
      const distSpan = document.getElementById('map-calc-distance');
      if (distSpan) distSpan.innerText = 'Esperando marcador...';

      // Activate real-time tracking map immediately without refreshing the page
      this.isTrackingMinimized = false;
      this.goHome();
      this.checkActiveOrderTracking();

      // Smooth unhurried transition to Order History modal so user sees status in vivo
      setTimeout(() => {
        this.openUserOrdersModal({ highlightFirst: true });
      }, 400);

    } catch (e) {
      console.error(e);
      alert('Error de conexión o problema al enviar el pedido: ' + e.message);
    }
  }

  getSpecsStringForKitchen(specs) {
    const parts = [];
    if (specs.single_selections && specs.single_selections.length > 0) {
      specs.single_selections.forEach(sel => {
        parts.push(`${sel.group_name}: ${sel.chosen_option}`);
      });
    }
    if (specs.add_ons && specs.add_ons.length > 0) {
      specs.add_ons.forEach(add => {
        const qty = add.quantity || 1;
        const price = (add.price_per_unit || 0) * qty;
        const priceText = price > 0 ? ` (+${this.formatPesos(this.normalizeCopPrice(price))})` : '';
        parts.push(`+ ${qty}x ${add.name}${priceText}`);
      });
    }
    if (specs.exclusions && specs.exclusions.length > 0) {
      specs.exclusions.forEach(exc => {
        parts.push(`- ${exc.name}`);
      });
    }
    if (specs.special_notes) {
      parts.push(`Nota: ${specs.special_notes}`);
    }
    return parts.join(' | ');
  }

  normalizeCopPrice(val) {
    let num = parseFloat(val);
    if (isNaN(num) || num <= 0) return 0;
    // Fix any 500000 COP price error (e.g. 500 pesos mistakenly saved as 500000)
    if (num >= 100000) {
      num = Math.round(num / 1000);
    }
    // Restore original thousand-multiplier logic for products saved in thousands notation (e.g. 20 -> 20.000 COP, 7.5 -> 7.500 COP, 15 -> 15.000 COP)
    if (num < 1000) {
      if (num >= 100 && num <= 999 && Number.isInteger(num)) {
        return Math.round(num);
      }
      return Math.round(num * 1000);
    }
    return Math.round(num);
  }

  formatPesos(val) {
    if (isNaN(val) || val === null || val === undefined) return '$0';
    let num = this.normalizeCopPrice(val);
    return '$' + num.toLocaleString('de-DE');
  }

  handleNavBack() {
    // 1. If any modal is open, close all modals
    const openModal = document.querySelector('.modal-overlay.open');
    if (openModal) {
      this.closeAllModals();
      return;
    }
    // 2. If viewing an establishment, go home to categories list
    if (this.selectedEstablishment) {
      this.goHome();
      return;
    }
    // 3. Fallback history back
    if (window.history.length > 1) {
      window.history.back();
    } else {
      this.goHome();
    }
  }

  setActiveMobileTab(tabName) {
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      item.classList.remove('active');
    });
    const activeBtn = document.getElementById(`m-nav-${tabName}`);
    if (activeBtn) {
      activeBtn.classList.add('active');
    }
  }

  // Utilities
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  handleSearch(event) {
    const query = event.target.value.toLowerCase().trim();
    if (!query) {
      this.renderEstablishments();
      return;
    }

    // Filter establishments that match query (or have matching products) and active location
    const filtered = this.establishments.filter(est => {
      const matchLoc = est.location === this.currentLocation || !est.location;
      if (!matchLoc) return false;
      const matchEst = est.name.toLowerCase().includes(query) || est.description.toLowerCase().includes(query);
      const matchProd = est.products.some(p => p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query));
      return matchEst || matchProd;
    });

    this.renderEstablishments(filtered);
  }

  openTermsModal(e) {
    if (e) e.preventDefault();
    document.getElementById('terms-modal').classList.add('open');
    window.history.pushState({ view: 'modal', modalId: 'terms-modal' }, '');
  }

  closeTermsModal() {
    document.getElementById('terms-modal').classList.remove('open');
    document.getElementById('checkout-accept-terms').checked = true;
    if (window.history.state && window.history.state.view === 'modal' && window.history.state.modalId === 'terms-modal') {
      window.history.back();
    }
  }

  openLocationModal() {
    this.closeAllModals();
    const modal = document.getElementById('location-modal');
    if (modal) {
      modal.classList.add('open');
      modal.style.setProperty('display', 'flex', 'important');
      // Highlight selected button
      document.querySelectorAll('.btn-location-option').forEach(btn => btn.style.borderColor = 'var(--border)');
      let activeBtnId = 'btn-loc-san-antonio';
      if (this.currentLocation === 'Ureña') activeBtnId = 'btn-loc-urena';
      else if (this.currentLocation === 'San Cristóbal') activeBtnId = 'btn-loc-san-cristobal';
      
      const activeBtn = document.getElementById(activeBtnId);
      if (activeBtn) activeBtn.style.borderColor = 'var(--primary)';
      
      window.history.pushState({ view: 'modal', modalId: 'location-modal' }, '');
    }
  }

  closeLocationModal() {
    const modal = document.getElementById('location-modal');
    if (modal) modal.classList.remove('open');
    if (window.history.state && window.history.state.view === 'modal' && window.history.state.modalId === 'location-modal') {
      window.history.back();
    }
  }

  setLocation(location) {
    this.currentLocation = location;
    localStorage.setItem('selected_location', location);
    
    const display = document.getElementById('active-location-display');
    if (display) display.innerText = location;
    
    this.closeLocationModal();
    this.renderEstablishments();
  }

  closeAllModals() {
    ['cart-modal', 'location-modal', 'terms-modal', 'customizer-modal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('open');
        el.classList.remove('active');
        el.style.display = 'none';
        // Reset properties in case they were set inline
        el.style.opacity = '';
        el.style.visibility = '';
        el.style.pointerEvents = '';
      }
    });
  }

  handlePopState(event) {
    const state = event.state;
    
    this.closeAllModals();

    if (!state || state.view === 'home') {
      this.goHome(false);
    } else if (state.view === 'establishment') {
      if (state.estId) {
        this.openEstablishment(state.estId, false);
      } else {
        this.goHome(false);
      }
    } else if (state.view === 'modal') {
      const modal = document.getElementById(state.modalId);
      if (modal) {
        modal.classList.add('open');
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        modal.style.visibility = 'visible';
        modal.style.pointerEvents = 'auto';
      }
    }
  }

  showLocationTutorial() {
    const target = document.querySelector('.delivery-address-area');
    if (!target) return;

    target.classList.add('pulse-effect');

    const tooltip = document.createElement('div');
    tooltip.className = 'tutorial-tooltip';
    tooltip.id = 'location-tutorial-tooltip';
    tooltip.innerHTML = `
      <div class="tutorial-tooltip-header">📍 ¡Selecciona tu zona!</div>
      <p style="margin: 0; font-size: 12px; font-weight: 500;">Haz clic aquí para cambiar tu pueblo y ver los establecimientos de tu zona: San Antonio, Ureña o San Cristóbal.</p>
      <button class="tutorial-tooltip-btn" onclick="MarketplaceApp.dismissLocationTutorial(event)">Entendido</button>
    `;

    const originalPosition = window.getComputedStyle(target).position;
    if (originalPosition === 'static') {
      target.style.position = 'relative';
    }

    target.appendChild(tooltip);

    // Auto-dismiss after 3 seconds
    if (this.tutorialTimer) clearTimeout(this.tutorialTimer);
    this.tutorialTimer = setTimeout(() => {
      this.dismissLocationTutorial();
    }, 3000);
  }

  dismissLocationTutorial(event) {
    if (event) event.stopPropagation();
    const tooltip = document.getElementById('location-tutorial-tooltip');
    if (tooltip) {
      tooltip.remove();
    }
    const target = document.querySelector('.delivery-address-area');
    if (target) {
      target.classList.remove('pulse-effect');
    }
    localStorage.setItem('location_tutorial_seen', 'true');
  }

  toggleDeliveryMap() {
    const container = document.getElementById('checkout-map-container');
    if (!container) return;

    if (container.classList.contains('hidden')) {
      container.classList.remove('hidden');
      setTimeout(() => {
        this.initLeafletMap();
      }, 200);
    } else {
      container.classList.add('hidden');
    }
  }

  createStoreMarkerIcon(est) {
    if (typeof L === 'undefined') return null;
    const photoUrl = est ? (est.logoImage || est.map_pin_image || null) : null;
    
    if (photoUrl) {
      return L.divIcon({
        className: 'custom-store-photo-marker',
        html: `<div style="background: #ffffff; width: 42px; height: 42px; border-radius: 50%; padding: 2px; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.6); border: 3px solid #3B82F6; display: flex; align-items: center; justify-content: center; overflow: hidden;"><img src="${photoUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;"></div>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      });
    }

    const emoji = est ? (est.logo || '🏪') : '🏪';
    return L.divIcon({
      className: 'custom-rest-marker',
      html: `<div style="background-color: #3B82F6; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 4px 10px rgba(59, 130, 246, 0.4); border: 2px solid white;">${emoji}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  calculateShopDeliveryFee(distanceKm, baseStoreFee = 5000) {
    const minFee = Math.max(5000, parseInt(baseStoreFee, 10) || 5000);
    if (distanceKm === null || distanceKm === undefined || isNaN(distanceKm)) {
      return minFee;
    }
    const dist = parseFloat(distanceKm);
    // Standard town base rate covers up to 2.5 km for the base delivery fee
    if (dist <= 2.5) {
      return minFee;
    }
    // Beyond 2.5 km up to 10 km: base fee + $1.500 COP per extra km
    if (dist <= 10.0) {
      const extraKm = dist - 2.5;
      const extraFee = Math.round(extraKm * 1500);
      return minFee + extraFee;
    }
    // Glitch / Out-of-city IP protection: fallback to base fee
    return minFee;
  }

  getActiveShopCenter() {
    // Determine distance directly from the specific Restaurant's own registered GPS coordinates
    let est = this.selectedEstablishment;
    if (!est && this.cart && this.cart.items && this.cart.items.length > 0) {
      const shopId = this.cart.items[0].restaurant_id;
      est = this.establishments.find(e => e.id === shopId);
    }
    if (est) {
      const lat = (est.location_lat !== undefined && est.location_lat !== null) 
        ? est.location_lat 
        : est.latitude;
      const lng = (est.location_lng !== undefined && est.location_lng !== null) 
        ? est.location_lng 
        : est.longitude;
      if (lat !== undefined && lat !== null && lng !== undefined && lng !== null && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) {
        return [parseFloat(lat), parseFloat(lng)];
      }
    }
    // Default fallback to city center coordinates
    return this.locationCenters[this.currentLocation] || [7.8131, -72.4439];
  }

  initLeafletMap() {
    if (typeof L === 'undefined') {
      console.error('Leaflet is not loaded yet');
      return;
    }

    // Determine Restaurant Origin Coordinates
    const shopCenter = this.getActiveShopCenter();

    if (this.leafMap) {
      this.leafMap.invalidateSize();
      this.fetchUserGPSLocation(shopCenter);
      return;
    }

    // Initialize Leaflet map centered at Restaurant location
    this.leafMap = L.map('checkout-leaflet-map').setView(shopCenter, 14);

    // OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(this.leafMap);

    // 1. Create Restaurant Origin Marker
    const storeIcon = this.createStoreMarkerIcon(this.selectedEstablishment || { name: 'Restaurante', logo: '🏪' });
    this.sedeMarker = L.marker(shopCenter, { icon: storeIcon, draggable: false }).addTo(this.leafMap);
    const storeName = this.selectedEstablishment ? this.selectedEstablishment.name : 'Restaurante';
    this.sedeMarker.bindPopup(`<b>🏪 Restaurante: ${storeName}</b><br><small>Origen del Domicilio</small>`);

    // 2. Create User Destination Location Marker (Interactive / Draggable)
    const userIcon = L.divIcon({
      className: 'custom-user-marker',
      html: `<div style="background-color: #FF5E3A; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 4px 10px rgba(255, 94, 58, 0.4); border: 2px solid white; cursor: grab;">📍</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    this.leafMarker = L.marker(shopCenter, { icon: userIcon, draggable: true }).addTo(this.leafMap);

    this.leafMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      this.setUserLocationOnMap([pos.lat, pos.lng], shopCenter, true);
    });

    this.leafMap.on('click', (e) => {
      this.setUserLocationOnMap([e.latlng.lat, e.latlng.lng], shopCenter, true);
    });

    // Fetch real GPS position automatically
    this.fetchUserGPSLocation(shopCenter);
  }

  fetchUserGPSLocation(shopCenter) {
    const distSpan = document.getElementById('map-calc-distance');
    if (distSpan) distSpan.innerText = 'Obteniendo GPS...';

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const userLat = pos.coords.latitude;
          const userLng = pos.coords.longitude;
          this.setUserLocationOnMap([userLat, userLng], shopCenter, true);
        },
        (err) => {
          console.warn('Geolocation error or denied:', err);
          const fallbackUserPos = [shopCenter[0] + 0.006, shopCenter[1] + 0.006];
          this.setUserLocationOnMap(fallbackUserPos, shopCenter, false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      const fallbackUserPos = [shopCenter[0] + 0.006, shopCenter[1] + 0.006];
      this.setUserLocationOnMap(fallbackUserPos, shopCenter, false);
    }
  }

  setUserLocationOnMap(userPos, shopCenter, isRealGps) {
    const lat = userPos[0];
    const lng = userPos[1];

    this.selectedLatitude = lat;
    this.selectedLongitude = lng;

    const latInp = document.getElementById('order-lat');
    if (latInp) latInp.value = lat;
    const lngInp = document.getElementById('order-lng');
    if (lngInp) lngInp.value = lng;

    if (this.leafMarker) {
      this.leafMarker.setLatLng(userPos);
    }

    // Draw GREEN line connecting Sede to User
    if (this.connectionLine) {
      this.leafMap.removeLayer(this.connectionLine);
    }
    this.connectionLine = L.polyline([shopCenter, userPos], {
      color: '#10B981',
      weight: 4,
      dashArray: '6, 8'
    }).addTo(this.leafMap);

    // Fit map bounds so BOTH Sede (Green) and User (Pin) + Line are visible
    if (this.leafMap) {
      const bounds = L.latLngBounds([shopCenter, userPos]);
      this.leafMap.fitBounds(bounds, { padding: [35, 35] });
    }

    // Calculate exact geodesic distance
    const distance = this.calculateGeodesicDistance(lat, lng, shopCenter[0], shopCenter[1]);
    this.calculatedDistanceKm = parseFloat(distance.toFixed(2));

    const distInp = document.getElementById('order-distance');
    if (distInp) distInp.value = this.calculatedDistanceKm;

    const distSpan = document.getElementById('map-calc-distance');
    if (distSpan) {
      distSpan.innerText = isRealGps 
        ? `📍 ${this.calculatedDistanceKm} km (GPS Detectado)` 
        : `📍 ${this.calculatedDistanceKm} km (Aproximado)`;
    }

    this.renderCartItems();
  }

  updateDeliveryCoordinates(lat, lng) {
    const shopCenter = this.getActiveShopCenter();
    this.setUserLocationOnMap([lat, lng], shopCenter, true);
  }

  calculateGeodesicDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toggleGroupCollapse(targetId, titleElement) {
    const target = document.getElementById(targetId);
    if (!target) return;

    if (!this.customizerState) {
      this.customizerState = {};
    }
    if (!this.customizerState.collapsedGroups) {
      this.customizerState.collapsedGroups = {};
    }

    const chevron = titleElement ? titleElement.querySelector('.collapse-chevron') : null;
    
    if (target.classList.contains('collapsed')) {
      target.classList.remove('collapsed');
      this.customizerState.collapsedGroups[targetId] = false;
      if (chevron) chevron.style.transform = 'rotate(0deg)';
    } else {
      target.classList.add('collapsed');
      this.customizerState.collapsedGroups[targetId] = true;
      if (chevron) chevron.style.transform = 'rotate(-90deg)';
    }
  }

  toggleBaseIngredientSelection(itemName, sideKey) {
    const key = 'base_' + itemName;
    const current = this.customizerState.quantities[sideKey][key] || 0;
    this.customizerState.quantities[sideKey][key] = (current === 0) ? 1 : 0;
    this.renderCustomizerModifiers();
  }

  async loadSystemSettings() {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        this.systemSettings = await res.json();
      }
    } catch (e) {
      console.warn('Could not load system settings:', e);
    }
  }

  dismissActiveOrderTracking() {
    localStorage.removeItem('active_order_id');
    this.isTrackingMinimized = false;
    if (this.trackingTimer) {
      clearTimeout(this.trackingTimer);
      this.trackingTimer = null;
    }
    const card = document.getElementById('active-order-tracking-card');
    if (card) card.classList.add('hidden');
    const pill = document.getElementById('active-order-minimized-pill');
    if (pill) pill.classList.add('hidden');
  }

  minimizeActiveOrderTracking() {
    this.isTrackingMinimized = true;
    const card = document.getElementById('active-order-tracking-card');
    if (card) card.classList.add('hidden');
    const pill = document.getElementById('active-order-minimized-pill');
    if (pill) pill.classList.remove('hidden');
    this.showToast('ℹ️ Mapa minimizado. Toca la barra flotante para volver a verlo.');
  }

  expandActiveOrderTracking() {
    this.isTrackingMinimized = false;
    const pill = document.getElementById('active-order-minimized-pill');
    if (pill) pill.classList.add('hidden');
    const card = document.getElementById('active-order-tracking-card');
    if (card) {
      card.classList.remove('hidden');
      if (this.trackingMap) {
        setTimeout(() => this.trackingMap.invalidateSize(), 150);
      }
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  checkActiveOrderTracking() {
    const activeOrderId = localStorage.getItem('active_order_id');
    const card = document.getElementById('active-order-tracking-card');
    const pill = document.getElementById('active-order-minimized-pill');

    if (!activeOrderId) {
      if (card) card.classList.add('hidden');
      if (pill) pill.classList.add('hidden');
      return;
    }

    if (this.isTrackingMinimized) {
      if (card) card.classList.add('hidden');
      if (pill) pill.classList.remove('hidden');
    } else {
      if (card) card.classList.remove('hidden');
      if (pill) pill.classList.add('hidden');
    }
    this.pollActiveOrder(activeOrderId);
  }

  trackActiveOrder(orderId) {
    localStorage.setItem('active_order_id', orderId);
    this.isTrackingMinimized = false;
    this.goHome();
    this.checkActiveOrderTracking();
    const card = document.getElementById('active-order-tracking-card');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  cancelActiveOrder() {
    const activeOrderId = localStorage.getItem('active_order_id');
    if (!activeOrderId) return;
    this.cancelUserOrder(activeOrderId);
  }

  async cancelUserOrder(orderId) {
    if (!confirm('¿Estás seguro de que deseas cancelar este pedido?')) {
      return;
    }

    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Cancelado',
          reason: 'Cancelado por el cliente'
        })
      });

      if (res.ok) {
        this.showToast('❌ Pedido cancelado exitosamente');
        
        // Update local orders history
        let userOrders = this.getUserOrdersHistory();
        const target = userOrders.find(o => String(o.id) === String(orderId));
        if (target) {
          target.status = 'Cancelado';
          target.cancelReason = 'Cancelado por el cliente';
          localStorage.setItem('user_orders_history', JSON.stringify(userOrders));
        }

        // If it was the active order in tracking card
        if (String(localStorage.getItem('active_order_id')) === String(orderId)) {
          const badge = document.getElementById('active-order-status-badge');
          const text = document.getElementById('active-order-info-text');
          const pillStatus = document.getElementById('minimized-pill-status');
          const cancelBtn = document.getElementById('active-order-cancel-btn');
          
          if (badge) {
            badge.innerText = '❌ Cancelado';
            badge.style.background = 'rgba(239, 68, 68, 0.2)';
            badge.style.color = '#ef4444';
          }
          if (pillStatus) {
            pillStatus.innerText = '❌ Cancelado';
            pillStatus.style.color = '#ef4444';
          }
          if (text) text.innerText = '❌ Tu pedido ha sido cancelado.';
          if (cancelBtn) cancelBtn.style.display = 'none';

          setTimeout(() => {
            this.dismissActiveOrderTracking();
          }, 4000);
        }

        const activeFilter = document.querySelector('.active-order-filter')?.id?.replace('user-order-filter-', '') || 'all';
        this.renderUserOrdersList(activeFilter);
      } else {
        alert('No se pudo cancelar el pedido. El pedido puede estar ya completado o cancelado.');
      }
    } catch(err) {
      console.error('Error cancelling order:', err);
      alert('Error de conexión al cancelar el pedido.');
    }
  }

  async pollActiveOrder(orderId) {
    try {
      const res = await fetch('/api/orders');
      if (!res.ok) return;
      const orders = await res.json();
      const order = orders.find(o => String(o.id) === String(orderId));
      
      const badge = document.getElementById('active-order-status-badge');
      const text = document.getElementById('active-order-info-text');
      const card = document.getElementById('active-order-tracking-card');
      const pill = document.getElementById('active-order-minimized-pill');
      const pillStatus = document.getElementById('minimized-pill-status');
      const cancelBtn = document.getElementById('active-order-cancel-btn');

      if (!order) {
        if (card) card.classList.add('hidden');
        if (pill) pill.classList.add('hidden');
        return;
      }

      const status = order.status || 'Pendiente';
      
      if (badge) {
        if (status === 'Pendiente') {
          badge.innerText = '⏳ Pendiente';
          badge.style.background = 'rgba(234, 179, 8, 0.2)';
          badge.style.color = '#eab308';
          if (text) text.innerText = `👨‍🍳 El restaurante (${order.establishmentName}) está recibiendo tu pedido...`;
          if (cancelBtn) cancelBtn.style.display = 'inline-flex';
        } else if (status === 'En Cocina' || status === 'En Preparacion' || status === 'En preparación' || status === 'Preparando') {
          badge.innerText = '👨‍🍳 Cocinando en Tienda';
          badge.style.background = 'rgba(59, 130, 246, 0.2)';
          badge.style.color = '#3b82f6';
          if (text) text.innerText = `🔥 ¡Tu pedido se está preparando en la cocina de ${order.establishmentName}!`;
          if (cancelBtn) cancelBtn.style.display = 'inline-flex';
        } else if (status === 'En Camino' || status === 'En camino' || status === 'Listo') {
          badge.innerText = '🚴 En Camino';
          badge.style.background = 'rgba(16, 185, 129, 0.2)';
          badge.style.color = '#10b981';
          if (text) text.innerText = `🛵 ¡El repartidor lleva tu pedido de ${order.establishmentName} en camino hacia tu dirección!`;
          if (cancelBtn) cancelBtn.style.display = 'none'; // Dispatched, hide cancel
        } else if (status === 'Entregado') {
          badge.innerText = '✅ Entregado';
          badge.style.background = 'rgba(16, 185, 129, 0.3)';
          badge.style.color = '#10b981';
          if (text) text.innerText = `🎉 ¡Pedido entregado con éxito! Buen provecho.`;
          if (cancelBtn) cancelBtn.style.display = 'none';
          setTimeout(() => {
            this.dismissActiveOrderTracking();
          }, 15000);
        } else if (status === 'Cancelado') {
          badge.innerText = '❌ Cancelado';
          badge.style.background = 'rgba(239, 68, 68, 0.2)';
          badge.style.color = '#ef4444';
          if (text) text.innerText = `❌ Este pedido fue cancelado. ${order.cancelReason ? `(${order.cancelReason})` : ''}`;
          if (cancelBtn) cancelBtn.style.display = 'none';
          setTimeout(() => {
            this.dismissActiveOrderTracking();
          }, 8000);
        }
      }

      if (pillStatus && badge) {
        pillStatus.innerText = badge.innerText;
        pillStatus.style.color = badge.style.color;
      }

      // Render Tracking Map for Active Order
      this.renderTrackingMap(order);

      // Continue polling if not finished yet
      if (status !== 'Entregado' && status !== 'Cancelado') {
        if (this.trackingTimer) clearTimeout(this.trackingTimer);
        this.trackingTimer = setTimeout(() => this.pollActiveOrder(orderId), 4000);
      }
    } catch (e) {
      console.warn('Error polling active order:', e);
    }
  }

  renderTrackingMap(order) {
    if (typeof L === 'undefined') return;
    const mapElem = document.getElementById('active-order-tracking-map');
    if (!mapElem) return;

    // Find restaurant coordinates
    let estCoords = [7.8131, -72.4439];
    if (this.establishments) {
      const est = this.establishments.find(e => e.id === order.establishmentId);
      if (est) {
        const lat = est.location_lat || est.latitude;
        const lng = est.location_lng || est.longitude;
        if (lat && lng) estCoords = [parseFloat(lat), parseFloat(lng)];
      }
    }

    // Customer coordinates
    let custCoords = [estCoords[0] + 0.005, estCoords[1] + 0.005];
    if (order.deliveryDetails && order.deliveryDetails.latitude && order.deliveryDetails.longitude) {
      custCoords = [parseFloat(order.deliveryDetails.latitude), parseFloat(order.deliveryDetails.longitude)];
    }

    if (!this.trackingMap) {
      this.trackingMap = L.map('active-order-tracking-map').setView(estCoords, 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(this.trackingMap);
    } else {
      this.trackingMap.invalidateSize();
    }

    // Clear previous tracking layers
    if (this.trackingLayers) {
      this.trackingLayers.forEach(layer => this.trackingMap.removeLayer(layer));
    }
    this.trackingLayers = [];

    // 1. Restaurant Marker (Sede Comercial con foto personalizada)
    let targetEst = null;
    if (this.establishments) {
      targetEst = this.establishments.find(e => e.id === order.establishmentId);
    }
    const restIcon = this.createStoreMarkerIcon(targetEst || { name: order.establishmentName, logo: '🏪' });
    const restMarker = L.marker(estCoords, { icon: restIcon }).addTo(this.trackingMap);
    restMarker.bindPopup(`<b>🏪 Sede Comercial: ${order.establishmentName || 'Tienda'}</b>`);
    this.trackingLayers.push(restMarker);

    // 2. Customer Marker (Casa)
    const custIcon = L.divIcon({
      className: 'custom-cust-marker',
      html: `<div style="background-color: #FF5E3A; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 4px 10px rgba(255, 94, 58, 0.4); border: 2px solid white;">🏠</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
    const custMarker = L.marker(custCoords, { icon: custIcon }).addTo(this.trackingMap);
    custMarker.bindPopup(`<b>Entrega: ${order.customerName || 'Cliente'}</b>`);
    this.trackingLayers.push(custMarker);

    // 3. Driver / Progress Position
    const status = order.status || 'Pendiente';
    if (status === 'En Camino' || status === 'En camino' || status === 'Listo') {
      const driverCoords = [ (estCoords[0] + custCoords[0]) / 2, (estCoords[1] + custCoords[1]) / 2 ];
      const driverIcon = L.divIcon({
        className: 'custom-driver-marker',
        html: `<div style="background-color: #10B981; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.5); border: 2px solid white;">🚴</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      const driverMarker = L.marker(driverCoords, { icon: driverIcon }).addTo(this.trackingMap);
      driverMarker.bindPopup(`<b>Repartidor en camino 🛵</b>`);
      this.trackingLayers.push(driverMarker);
    }

    // Connecting Polyline
    const line = L.polyline([estCoords, custCoords], { color: '#3B82F6', weight: 4, dashArray: '6, 8' }).addTo(this.trackingMap);
    this.trackingLayers.push(line);

    // Fit bounds
    const bounds = L.latLngBounds([estCoords, custCoords]);
    this.trackingMap.fitBounds(bounds, { padding: [30, 30] });
  }

  // GochoPoints & Coupon Methods
  updateGochoPointsDisplay() {
    const valSpan = document.getElementById('header-gochopoints-val');
    if (valSpan) valSpan.innerText = this.gochoPoints;
    const modalSpan = document.getElementById('modal-gochopoints-total');
    if (modalSpan) modalSpan.innerText = `${this.gochoPoints} Pts`;
  }

  openGochoPointsModal() {
    this.updateGochoPointsDisplay();
    const modal = document.getElementById('gochopoints-modal');
    if (modal) modal.classList.add('active');
  }

  closeGochoPointsModal() {
    const modal = document.getElementById('gochopoints-modal');
    if (modal) modal.classList.remove('active');
  }

  addGochoPoints(amount) {
    this.gochoPoints += amount;
    localStorage.setItem('gocho_points', this.gochoPoints.toString());
    this.updateGochoPointsDisplay();
  }

  redeemReward(couponCode, pointsCost) {
    if (this.gochoPoints < pointsCost) {
      alert(`⚠️ Necesitas ${pointsCost} Pts para canjear esta recompensa. Tu saldo actual es de ${this.gochoPoints} Pts.`);
      return;
    }
    this.gochoPoints -= pointsCost;
    localStorage.setItem('gocho_points', this.gochoPoints.toString());
    this.updateGochoPointsDisplay();
    this.closeGochoPointsModal();
    
    // Apply coupon
    const couponInput = document.getElementById('checkout-coupon-input');
    if (couponInput) couponInput.value = couponCode;
    this.applyCouponCode();
    this.showToast(`🎉 ¡Canjeaste tu recompensa con éxito! Se aplicó el código ${couponCode}.`);
  }

  applyCouponCode() {
    const input = document.getElementById('checkout-coupon-input');
    const msg = document.getElementById('checkout-coupon-msg');
    if (!input || !input.value.trim()) return;

    const code = input.value.trim().toUpperCase();
    if (code === 'GOCHO10') {
      this.activeCoupon = { code: 'GOCHO10', type: 'fixed', amount: 2.00 };
      if (msg) { msg.style.color = '#10B981'; msg.innerText = '✅ ¡Cupón GOCHO10 aplicado! ($2.00 USD de descuento)'; }
    } else if (code === 'ENVIOGRATIS') {
      this.activeCoupon = { code: 'ENVIOGRATIS', type: 'delivery', amount: 0 };
      if (msg) { msg.style.color = '#10B981'; msg.innerText = '✅ ¡Cupón ENVIOGRATIS aplicado! (Costo de envío $0.00)'; }
    } else if (code === 'GOCHOVIP') {
      this.activeCoupon = { code: 'GOCHOVIP', type: 'percent', amount: 15 };
      if (msg) { msg.style.color = '#10B981'; msg.innerText = '✅ ¡Cupón GOCHOVIP aplicado! (15% de descuento en tu orden)'; }
    } else {
      this.activeCoupon = null;
      if (msg) { msg.style.color = '#EF4444'; msg.innerText = '❌ Código de cupón inválido o expirado.'; }
    }
    this.renderCartItems();
  }

  isEstablishmentOpen(est) {
    if (!est) return true;
    if (est.disabled) return false;

    // Working Days Schedule Check
    const daysOfWeek = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const todayName = daysOfWeek[new Date().getDay()];
    if (Array.isArray(est.working_days) && est.working_days.length > 0) {
      if (!est.working_days.includes(todayName)) {
        return false; // Closed today based on working_days schedule calendar
      }
    }

    const openTime = est.open_time || '17:00';
    const closeTime = est.close_time || '00:00';

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const parseMinutes = (timeStr) => {
      if (!timeStr) return 0;
      const parts = timeStr.split(':');
      let h = parseInt(parts[0], 10) || 0;
      let m = parseInt(parts[1], 10) || 0;
      if ((h === 0 && m === 0 && (timeStr === '00:00' || timeStr === '24:00')) || h === 24) {
        return 1440; // 12:00 AM Midnight (24:00) is end of day
      }
      return h * 60 + m;
    };

    let openMin = parseMinutes(openTime);
    let closeMin = parseMinutes(closeTime);

    if (openMin <= closeMin) {
      return currentMinutes >= openMin && currentMinutes <= closeMin;
    } else {
      // Overnight wrap-around (e.g. 17:00 to 02:00)
      return currentMinutes >= openMin || currentMinutes <= closeMin;
    }
  }

  formatTime12h(timeStr) {
    if (!timeStr) return '5:00 PM';
    const parts = timeStr.split(':');
    let h = parseInt(parts[0], 10) || 0;
    let m = parseInt(parts[1], 10) || 0;
    
    if (h === 0 && m === 0) return '12:00 AM (Medianoche)';
    if (h === 12 && m === 0) return '12:00 PM (Mediodía)';
    if (h === 24) return '12:00 AM (Medianoche)';
    
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    const mStr = m < 10 ? '0' + m : m;
    return `${h}:${mStr} ${ampm}`;
  }

  // Web Push Notifications
  async initPushNotifications() {
    if ('Notification' in window && 'serviceWorker' in navigator) {
      if (Notification.permission === 'default') {
        setTimeout(() => {
          try {
            const res = Notification.requestPermission();
            if (res && typeof res.then === 'function') {
              res.then(permission => {
                if (permission === 'granted') {
                  console.log('🔔 Web Push notification permission GRANTED');
                }
              }).catch(() => {});
            }
          } catch(e) {}
        }, 5000);
      }
    }
  }

  sendPushNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(registration => {
            registration.showNotification(title, {
              body: body,
              icon: '/images/burger_royale.jpg',
              vibrate: [200, 100, 200]
            });
          });
        } else {
          new Notification(title, { body: body, icon: '/images/burger_royale.jpg' });
        }
      } catch(e) {
        console.warn('Local push notification fallback:', e);
      }
    }
  }

  // Offline First Auto-Sync
  initOfflineSync() {
    const banner = document.getElementById('offline-banner');
    const updateOnlineStatus = () => {
      if (!navigator.onLine) {
        if (banner) banner.style.display = 'block';
        this.showToast('📴 Modo Sin Conexión activado. Tus acciones se guardarán localmente.');
      } else {
        if (banner) banner.style.display = 'none';
        this.processPendingOfflineOrders();
      }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    if (!navigator.onLine && banner) {
      banner.style.display = 'block';
    }
  }

  async processPendingOfflineOrders() {
    const rawQueue = localStorage.getItem('pending_offline_orders');
    if (!rawQueue) return;

    try {
      const queue = JSON.parse(rawQueue);
      if (Array.isArray(queue) && queue.length > 0) {
        this.showToast(`⚡ Reconectado: Sincronizando ${queue.length} pedido(s) guardado(s)...`);
        for (const orderData of queue) {
          try {
            if (window.SupabaseHelper && window.SupabaseHelper.createOrder) {
              await window.SupabaseHelper.createOrder(orderData);
            }
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ type: 'new_order', data: orderData }));
            }
          } catch(err) {
            console.warn('Error syncing queued order:', err);
          }
        }
        localStorage.removeItem('pending_offline_orders');
        this.showToast('🎉 ¡Pedidos guardados sincronizados con éxito!');
        this.sendPushNotification('¡Pedidos Sincronizados! 🚀', 'Tus pedidos sin conexión se enviaron correctamente a la cocina.');
      }
    } catch(e) {
      console.warn('Error parsing offline queue:', e);
    }
  }

  // Interactive Customer Table Map Layout Renderer
  renderCustomerTableMap() {
    const container = document.getElementById('customer-table-layout-container');
    const badge = document.getElementById('customer-selected-table-badge');
    const input = document.getElementById('order-table-number');
    if (!container) return;

    const shopId = this.cart.items[0]?.restaurant_id;
    const est = this.establishments.find(e => e.id === shopId);
    const layout = (est && est.layout && Array.isArray(est.layout)) ? est.layout : [];
    const tableItems = layout.filter(item => item.type === 'table');

    container.innerHTML = '';

    if (tableItems.length > 0) {
      // 10x10 Visual Map Grid
      const grid = document.createElement('div');
      grid.style.cssText = 'display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; width: 100%; max-width: 320px; margin: 0 auto; aspect-ratio: 1;';

      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          const item = layout.find(cell => cell.x === x && cell.y === y);
          const cell = document.createElement('div');
          cell.style.cssText = 'width: 100%; height: 100%; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: all 0.15s ease;';

          if (item) {
            if (item.type === 'table') {
              const isSelected = input && parseInt(input.value, 10) === item.number;
              cell.className = 'cust-table-cell';
              cell.style.background = isSelected ? '#10B981' : '#F59E0B';
              cell.style.color = isSelected ? '#ffffff' : '#1E293B';
              cell.style.fontWeight = '900';
              cell.style.cursor = 'pointer';
              cell.style.boxShadow = isSelected ? '0 0 12px #10B981' : '0 2px 6px rgba(0,0,0,0.3)';
              cell.innerHTML = `<span style="font-size: 11px; line-height: 1;">🪑</span><span style="font-size: 8.5px; margin-top: 1px;">#${item.number}</span>`;
              
              cell.onclick = () => {
                if (input) input.value = item.number;
                if (badge) {
                  badge.innerText = `✅ Mesa #${item.number} Seleccionada en el Plano del Local`;
                  badge.style.display = 'block';
                }
                this.renderCustomerTableMap();
              };
            } else if (item.type === 'wall') {
              cell.style.background = '#334155';
              cell.style.border = '1px solid rgba(255,255,255,0.06)';
              cell.innerHTML = '<span style="font-size: 10px;">🧱</span>';
            }
          } else {
            cell.style.background = 'rgba(255,255,255,0.02)';
            cell.style.border = '1px solid rgba(255,255,255,0.04)';
          }
          grid.appendChild(cell);
        }
      }
      container.appendChild(grid);
    } else {
      // Default table chips selector fallback
      const fallbackDiv = document.createElement('div');
      fallbackDiv.style.cssText = 'display: flex; flex-direction: column; gap: 8px; align-items: center;';
      
      const title = document.createElement('span');
      title.style.cssText = 'font-size: 12px; color: #94A3B8; font-weight: 700;';
      title.innerText = 'Toca la mesa donde te encuentras sentado:';
      fallbackDiv.appendChild(title);

      const chipsGrid = document.createElement('div');
      chipsGrid.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; width: 100%;';

      for (let num = 1; num <= 8; num++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isSelected = input && parseInt(input.value, 10) === num;
        btn.style.cssText = `
          padding: 10px 6px;
          border-radius: 10px;
          border: 1px solid ${isSelected ? '#10B981' : 'rgba(255,255,255,0.1)'};
          background: ${isSelected ? '#10B981' : 'rgba(255,255,255,0.05)'};
          color: ${isSelected ? '#ffffff' : '#F59E0B'};
          font-weight: 800;
          font-size: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          box-shadow: ${isSelected ? '0 0 10px rgba(16, 185, 129, 0.4)' : 'none'};
          transition: all 0.2s ease;
        `;
        btn.innerHTML = `<span>🪑</span> <span>Mesa ${num}</span>`;
        btn.onclick = () => {
          if (input) input.value = num;
          if (badge) {
            badge.innerText = `✅ Mesa #${num} Seleccionada`;
            badge.style.display = 'block';
          }
          this.renderCustomerTableMap();
        };
        chipsGrid.appendChild(btn);
      }
      fallbackDiv.appendChild(chipsGrid);
      container.appendChild(fallbackDiv);
    }
  }

  saveUserOrderToHistory(order) {
    if (!order || !order.id) return;
    try {
      let orders = JSON.parse(localStorage.getItem('pedigochos_user_orders') || '[]');
      if (!Array.isArray(orders)) orders = [];
      
      const index = orders.findIndex(o => o.id === order.id);
      if (index !== -1) {
        orders[index] = { ...orders[index], ...order };
      } else {
        orders.unshift(order);
      }
      
      if (orders.length > 50) orders = orders.slice(0, 50);
      localStorage.setItem('pedigochos_user_orders', JSON.stringify(orders));
    } catch(e) {
      console.error('Error saving order to history:', e);
    }
  }

  getUserOrdersHistory() {
    try {
      let orders = JSON.parse(localStorage.getItem('pedigochos_user_orders') || '[]');
      return Array.isArray(orders) ? orders : [];
    } catch(e) {
      return [];
    }
  }

  async openUserOrdersModal(options = {}) {
    const modal = document.getElementById('user-orders-modal');
    if (modal) {
      modal.classList.add('active');
      const content = modal.querySelector('.modal-content');
      if (content) {
        content.classList.remove('smooth-modal-entry');
        void content.offsetWidth; // trigger reflow
        content.classList.add('smooth-modal-entry');
      }
    }
    document.body.classList.add('modal-open');

    // Fetch live status from server
    try {
      const res = await fetch('/api/orders');
      if (res.ok) {
        const liveOrders = await res.json();
        let userOrders = this.getUserOrdersHistory();
        
        if (Array.isArray(liveOrders) && userOrders.length > 0) {
          userOrders.forEach(localOrd => {
            const serverOrd = liveOrders.find(o => String(o.id) === String(localOrd.id));
            if (serverOrd) {
              this.saveUserOrderToHistory(serverOrd);
            }
          });
        }
      }
    } catch(e) {
      console.error('Error syncing live orders history:', e);
    }

    this.renderUserOrdersList('all', options.highlightFirst);
  }

  closeUserOrdersModal() {
    const modal = document.getElementById('user-orders-modal');
    if (modal) modal.classList.remove('active');
    document.body.classList.remove('modal-open');
  }

  filterUserOrders(filterType) {
    document.querySelectorAll('.active-order-filter').forEach(btn => {
      btn.style.background = 'rgba(255,255,255,0.06)';
      btn.style.color = '#FFF';
      btn.style.border = '1px solid rgba(255,255,255,0.1)';
      btn.classList.remove('active-order-filter');
    });

    const activeBtn = document.getElementById(`user-order-filter-${filterType}`);
    if (activeBtn) {
      activeBtn.style.background = 'var(--primary)';
      activeBtn.style.color = '#fff';
      activeBtn.style.border = 'none';
      activeBtn.classList.add('active-order-filter');
    }

    this.renderUserOrdersList(filterType, false);
  }

  renderUserOrdersList(filterType = 'all', highlightFirst = false) {
    const container = document.getElementById('user-orders-list-container');
    if (!container) return;

    let orders = this.getUserOrdersHistory();

    const isFinished = (s) => s === 'Entregado' || s === 'completed' || s === 'Cancelado' || s === 'cancelled';

    if (filterType === 'active') {
      orders = orders.filter(o => !isFinished(o.status));
    } else if (filterType === 'completed') {
      orders = orders.filter(o => isFinished(o.status));
    }

    if (orders.length === 0) {
      container.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 16px;">
          <span style="font-size: 42px; display: block; margin-bottom: 10px;">📋</span>
          <h4 style="margin: 0 0 6px 0; color: #FFF; font-size: 15px; font-weight: 800;">No tienes pedidos registrados ${filterType !== 'all' ? 'en esta categoría' : ''}</h4>
          <p style="margin: 0; font-size: 12px; color: var(--text-muted);">Tus pedidos realizados aparecerán aquí con su estado en vivo e ingredientes.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    orders.forEach((ord, index) => {
      const est = this.establishments.find(e => e.id === ord.establishmentId || e.id === ord.establishment_id);
      const estName = est ? est.name : (ord.establishmentName || 'Restaurante');
      const estLogo = est ? (est.logo || '🏪') : '🏪';
      const estPhoto = est ? (est.logoImage || null) : null;

      const rawDate = ord.createdAt || ord.timestamp || ord.created_at;
      const dateObj = rawDate ? new Date(rawDate) : new Date();
      const dateStr = dateObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

      const statusMap = {
        'Pendiente': { label: '⏳ Pendiente', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' },
        'Preparando': { label: '👨‍🍳 En Cocina', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)' },
        'En Cocina': { label: '👨‍🍳 En Cocina', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)' },
        'En Preparacion': { label: '👨‍🍳 En Cocina', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)' },
        'En preparación': { label: '👨‍🍳 En Cocina', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)' },
        'Listo': { label: '📦 Listo para Despacho', color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.15)' },
        'En Camino': { label: '🛵 En Camino', color: '#06B6D4', bg: 'rgba(6, 182, 212, 0.15)' },
        'En camino': { label: '🛵 En Camino', color: '#06B6D4', bg: 'rgba(6, 182, 212, 0.15)' },
        'Entregado': { label: '✅ Entregado', color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)' },
        'Cancelado': { label: '❌ Cancelado', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)' },
        // Fallbacks
        'pending': { label: '⏳ Pendiente', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' },
        'preparing': { label: '👨‍🍳 En Cocina', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)' },
        'ready': { label: '📦 Listo', color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.15)' },
        'on_the_way': { label: '🛵 En Camino', color: '#06B6D4', bg: 'rgba(6, 182, 212, 0.15)' },
        'completed': { label: '✅ Entregado', color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)' },
        'cancelled': { label: '❌ Cancelado', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)' }
      };

      const statusObj = statusMap[ord.status] || { label: ord.status || 'Enviado', color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.15)' };
      const codeStr = ord.deliveryDetails?.code || ord.orderCode || (ord.id ? ord.id.slice(-4) : '---');

      const payMethodLabel = ord.paymentMethod === 'Transferencia' ? '📲 Transferencia' : '💵 Efectivo';
      const payNotes = ord.paymentNotes ? ` (${ord.paymentNotes})` : '';

      // Build items breakdown
      let itemsHTML = '';
      if (Array.isArray(ord.items)) {
        itemsHTML = ord.items.map(item => {
          let specsHTML = '';
          
          // Render specifications / ingredients
          if (item.selected_specifications && typeof item.selected_specifications === 'object') {
            const specParts = [];
            Object.keys(item.selected_specifications).forEach(groupTitle => {
              const selections = item.selected_specifications[groupTitle];
              if (Array.isArray(selections) && selections.length > 0) {
                const names = selections.map(s => typeof s === 'string' ? s : (s.name || s.title)).join(', ');
                specParts.push(`<strong>${groupTitle}:</strong> ${names}`);
              } else if (typeof selections === 'string') {
                specParts.push(`<strong>${groupTitle}:</strong> ${selections}`);
              }
            });
            if (specParts.length > 0) {
              specsHTML = `<div style="font-size: 11px; color: #F59E0B; margin-top: 3px; background: rgba(245, 158, 11, 0.08); padding: 4px 8px; border-radius: 6px; border-left: 2px solid #F59E0B;">${specParts.join('<br>')}</div>`;
            }
          } else if (item.specifications) {
            specsHTML = `<div style="font-size: 11px; color: #F59E0B; margin-top: 3px; background: rgba(245, 158, 11, 0.08); padding: 4px 8px; border-radius: 6px; border-left: 2px solid #F59E0B;">${item.specifications}</div>`;
          }

          const priceVal = item.unit_total_calculated || item.price || 0;
          return `
            <div style="border-bottom: 1px dashed rgba(255,255,255,0.06); padding-bottom: 6px; margin-bottom: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; font-weight: 700; color: #FFF;">
                <span>x${item.quantity || 1} ${item.name || item.product_name}</span>
                <span style="color: var(--primary);">${this.formatPesos(this.normalizeCopPrice(priceVal) * (item.quantity || 1))}</span>
              </div>
              ${specsHTML}
            </div>
          `;
        }).join('');
      }

      const card = document.createElement('div');
      const isCardActive = !isFinished(ord.status);
      const isHighlighted = highlightFirst && index === 0;

      card.className = isHighlighted ? 'new-order-highlight' : '';
      card.style.cssText = 'background: rgba(22, 22, 28, 0.95); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.3); transition: all 0.3s ease;';

      const liveBtnHTML = isCardActive ? `
        <button type="button" onclick="MarketplaceApp.closeUserOrdersModal(); MarketplaceApp.trackActiveOrder('${ord.id}')" style="background: var(--primary); color: #FFF; border: none; padding: 6px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">
          🛵 Rastreo en Vivo
        </button>
        <button type="button" onclick="MarketplaceApp.cancelUserOrder('${ord.id}')" style="background: rgba(239, 68, 68, 0.15); color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 6px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">
          ❌ Cancelar Pedido
        </button>
      ` : '';

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 38px; height: 38px; border-radius: 8px; overflow: hidden; background: rgba(255,255,255,0.04); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.1); font-size: 18px;">
              ${estPhoto ? `<img src="${estPhoto}" style="width:100%; height:100%; object-fit:cover;">` : estLogo}
            </div>
            <div>
              <h4 style="margin: 0; font-size: 14px; font-weight: 800; color: #FFF;">${estName}</h4>
              <span style="font-size: 11px; color: var(--text-muted);">${dateStr} • Código: #${codeStr}</span>
            </div>
          </div>
          <span style="background: ${statusObj.bg}; color: ${statusObj.color}; border: 1px solid ${statusObj.color}; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 800;">
            ${statusObj.label}
          </span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.04);">
          ${itemsHTML}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; background: rgba(255,255,255,0.02); padding: 8px 10px; border-radius: 8px; flex-wrap: wrap; gap: 6px;">
          <div style="color: var(--text-muted); display: flex; flex-direction: column; gap: 2px;">
            <span>${ord.orderType === 'delivery' ? `🚚 Domicilio: ${ord.deliveryDetails?.address || 'Dirección provista'}` : `🍽️ En Mesa #${ord.tableNumber || 1}`}</span>
            <span style="font-size: 11px; color: #94A3B8;">💳 Pago: <strong>${payMethodLabel}</strong>${payNotes}</span>
          </div>
          <span style="font-size: 14px; font-weight: 900; color: var(--primary);">Total: ${this.formatPesos(ord.total || 0)}</span>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; flex-wrap: wrap;">
          ${liveBtnHTML}
          <button type="button" onclick="MarketplaceApp.openRatingModal('${ord.id}', '${ord.establishmentId || ord.establishment_id || ''}')" style="background: rgba(245, 158, 11, 0.15); color: #F59E0B; border: 1px solid rgba(245, 158, 11, 0.3); padding: 6px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">
            ⭐ Calificar
          </button>
          <button type="button" onclick="MarketplaceApp.repeatOrderFromHistory('${ord.id}')" style="background: rgba(255,255,255,0.06); color: #FFF; border: 1px solid rgba(255,255,255,0.12); padding: 6px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">
            🔄 Repetir Pedido
          </button>
        </div>
      `;
      container.appendChild(card);
    });
  }

  repeatOrderFromHistory(orderId) {
    const orders = this.getUserOrdersHistory();
    const ord = orders.find(o => o.id === orderId);
    if (!ord || !Array.isArray(ord.items) || ord.items.length === 0) {
      alert('No se pudo encontrar el detalle de este pedido para repetirlo.');
      return;
    }

    ord.items.forEach(item => {
      this.cart.addItem({
        product_id: item.id || item.product_id,
        product_name: item.name || item.product_name,
        unit_total_calculated: item.price || item.unit_total_calculated,
        subtotal_combined: (item.price || item.unit_total_calculated) * (item.quantity || 1),
        quantity: item.quantity || 1,
        selected_specifications: item.selected_specifications || {},
        restaurant_id: ord.establishmentId || ord.establishment_id
      });
    });

    this.updateCartBadge();
    this.closeUserOrdersModal();
    this.openCartModal();
    this.showToast('🛒 ¡Productos agregados al carrito con sus ingredientes!');
  }

  // ==========================================
  // REVIEWS & 5-STAR RATING SYSTEM METHODS
  // ==========================================

  setRatingStars(count) {
    this.currentRatingValue = count;
    const labels = {
      1: '⭐ (1 / 5 - Deficiente)',
      2: '⭐⭐ (2 / 5 - Regular)',
      3: '⭐⭐⭐ (3 / 5 - Bueno)',
      4: '⭐⭐⭐⭐ (4 / 5 - Muy Bueno)',
      5: '⭐⭐⭐⭐⭐ (5 / 5 - ¡Excelente!)'
    };

    const labelEl = document.getElementById('rating-label-text');
    if (labelEl) labelEl.innerText = labels[count] || '⭐⭐⭐⭐⭐ (5 / 5 - ¡Excelente!)';

    for (let i = 1; i <= 5; i++) {
      const star = document.getElementById(`star-${i}`);
      if (star) {
        if (i <= count) {
          star.style.opacity = '1';
          star.style.transform = 'scale(1.25)';
        } else {
          star.style.opacity = '0.3';
          star.style.transform = 'scale(1)';
        }
      }
    }
  }

  openRatingModal(orderId, estId) {
    const modal = document.getElementById('rating-modal');
    if (!modal) return;

    document.getElementById('rating-order-id').value = orderId || '';
    document.getElementById('rating-est-id').value = estId || '';
    document.getElementById('rating-comment-text').value = '';
    this.setRatingStars(5);

    modal.classList.add('active');
  }

  closeRatingModal() {
    const modal = document.getElementById('rating-modal');
    if (modal) modal.classList.remove('active');
  }

  async submitReview() {
    const orderId = document.getElementById('rating-order-id').value;
    const estId = document.getElementById('rating-est-id').value;
    const comment = document.getElementById('rating-comment-text').value.trim();
    const rating = this.currentRatingValue || 5;

    if (!estId) {
      this.closeRatingModal();
      return;
    }

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          establishmentId: estId,
          rating,
          comment,
          customerName: 'Cliente Rapi Gochos'
        })
      });

      if (res.ok) {
        this.showToast('🌟 ¡Gracias por calificar tu pedido!');
        this.closeRatingModal();
        this.loadEstablishments();
      } else {
        const err = await res.json();
        alert(err.error || 'No se pudo enviar la calificación.');
      }
    } catch(e) {
      console.error(e);
      this.closeRatingModal();
    }
  }

  async openReviewsListModal(estId) {
    const modal = document.getElementById('reviews-list-modal');
    const container = document.getElementById('reviews-modal-cards-list');
    if (!modal || !container) return;

    modal.classList.add('active');
    container.innerHTML = '<div style="color: #94A3B8; text-align: center; padding: 20px;">Cargando reseñas...</div>';

    try {
      const res = await fetch(`/api/establishments/${estId}/reviews`);
      if (!res.ok) throw new Error('Error API');
      const data = await res.json();

      const est = (this.establishments || []).find(e => e.id === estId);
      const titleEl = document.getElementById('reviews-modal-title');
      const subEl = document.getElementById('reviews-modal-sub');
      if (titleEl) titleEl.innerText = `⭐ Reseñas: ${est ? est.name : 'Restaurante'}`;
      if (subEl) subEl.innerText = `Promedio: ⭐ ${data.avgRating} / 5 (${data.totalReviews} opiniones de clientes)`;

      if (!data.reviews || data.reviews.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 30px; background: rgba(255,255,255,0.03); border-radius: 16px;">
            <span style="font-size: 36px; display: block; margin-bottom: 8px;">🌟</span>
            <strong style="color: #FFF; font-size: 14px;">Sin reseñas registradas aún</strong>
            <p style="color: #94A3B8; font-size: 12px; margin: 4px 0 0 0;">¡Haz tu pedido en este comercio y sé el primero en dejar tu calificación de 5 estrellas!</p>
          </div>
        `;
        return;
      }

      container.innerHTML = data.reviews.map(r => {
        const starsStr = '⭐'.repeat(r.rating || 5);
        const dateStr = r.createdAt ? new Date(r.createdAt).toLocaleDateString('es-ES') : 'Reciente';

        return `
          <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); padding: 12px 14px; border-radius: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="color: #FFF; font-weight: 800; font-size: 13px;">👤 ${r.customerName}</span>
              <span style="font-size: 11px; color: #64748B;">${dateStr}</span>
            </div>
            <div style="font-size: 13px; color: #F59E0B; margin-bottom: 6px;">${starsStr} (${r.rating} / 5)</div>
            ${r.comment ? `<p style="font-size: 12.5px; color: #CBD5E1; margin: 0; line-height: 1.4;">"${r.comment}"</p>` : ''}
          </div>
        `;
      }).join('');

    } catch(e) {
      container.innerHTML = '<div style="color: #F87171; text-align: center; padding: 20px;">Error al cargar las reseñas.</div>';
    }
  }

  closeReviewsListModal() {
    const modal = document.getElementById('reviews-list-modal');
    if (modal) modal.classList.remove('active');
  }
}

const MarketplaceApp = new MarketplaceController();
window.MarketplaceApp = MarketplaceApp;

document.addEventListener('DOMContentLoaded', () => {
  MarketplaceApp.init();
});
