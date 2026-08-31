/* Customer Marketplace App Logic */

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
  ferreterias: '/images/pack_frutas.jpg' // Falls back gracefully
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

    // Clear any lingering redirect flag
    localStorage.removeItem('redirect_after_google_login');

    // Parse URL query parameters for QR scan / direct store deep linking
    const urlParams = new URLSearchParams(window.location.search);
    const storeParam = urlParams.get('store') || urlParams.get('restaurant') || urlParams.get('r') || urlParams.get('shop') || urlParams.get('id');
    const tableParam = urlParams.get('mesa') || urlParams.get('table') || urlParams.get('m');

    if (tableParam) {
      // EXPLICIT Table QR scan (e.g. ?store=...&mesa=1) -> Lock strictly to this table
      this.currentTableNumber = tableParam;
      this.tableLockedByQR = true;
      this.orderType = 'mesa';
    } else {
      // General Store Menu QR (e.g. ?store=...) or normal browse -> DO NOT lock table! Allow Delivery and free choice
      this.currentTableNumber = null;
      this.tableLockedByQR = false;
      try {
        localStorage.removeItem('scanned_table_number');
        localStorage.removeItem('table_locked_by_qr');
        localStorage.removeItem('scanned_table_store');
      } catch(e) {}
    }

    // Set initial history state
    window.history.replaceState({ view: 'home' }, '');
    window.addEventListener('popstate', (e) => this.handlePopState(e));

    await this.loadSystemSettings();
    await this.loadEstablishments();
    await this.loadPromotions();
    this.initWebSocket();
    
    // Auto-detect user's GPS coordinates immediately on startup
    this.requestAutomaticGPS(false);

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
    this.checkFirstTimeWelcome();

    // Auto-open store if scanned via QR or visited via direct link
    if (storeParam && Array.isArray(this.establishments) && this.establishments.length > 0) {
      const normQuery = storeParam.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
      const targetStore = this.establishments.find(e => {
        if (!e) return false;
        const eId = String(e.id || '').trim();
        const eNameNorm = (e.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
        return eId === storeParam.trim() || eNameNorm === normQuery || eId.toLowerCase().includes(normQuery) || (e.linkKey && e.linkKey.toUpperCase() === storeParam.trim().toUpperCase());
      });

      if (targetStore) {
        setTimeout(() => {
          this.openEstablishment(targetStore.id, false);
          if (tableParam) {
            this.showToast(`🍽️ ¡Bienvenido a ${targetStore.name}! Conectado a Mesa #${tableParam}`);
          }
        }, 100);
      }
    } else if (!localStorage.getItem('location_tutorial_seen')) {
      // Show location selector tutorial if visiting home for the first time
      setTimeout(() => {
        this.showLocationTutorial();
      }, 1000);
    }
  }

  checkFirstTimeWelcome() {
    try {
      const hasSeen = localStorage.getItem('pedigochos_welcome_shown_v1');
      if (!hasSeen) {
        const modal = document.getElementById('first-time-welcome-modal');
        if (modal) {
          setTimeout(() => {
            modal.classList.add('open');
            modal.style.setProperty('display', 'flex', 'important');
          }, 600);
        }
      }
    } catch(e) {}
  }

  closeWelcomeModal() {
    try {
      localStorage.setItem('pedigochos_welcome_shown_v1', 'true');
    } catch(e) {}
    const modal = document.getElementById('first-time-welcome-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
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

          // Preserve custom GPS from server
          if (est.latitude !== undefined && est.latitude !== null && !isNaN(parseFloat(est.latitude)) && est.longitude !== undefined && est.longitude !== null && !isNaN(parseFloat(est.longitude))) {
            est.latitude = parseFloat(est.latitude);
            est.longitude = parseFloat(est.longitude);
          } else {
            est.latitude = null;
            est.longitude = null;
          }
          est.location_lat = est.latitude;
          est.location_lng = est.longitude;
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

      // Hide featured carousel & daily promo until 'Restaurantes' category is selected
      const featSection = document.getElementById('featured-carousel-section');
      if (featSection) {
        featSection.style.display = 'none';
        featSection.classList.add('hidden');
      }
      const promoSection = document.getElementById('daily-promotions-section');
      if (promoSection) {
        promoSection.style.display = 'none';
        promoSection.classList.add('hidden');
      }

      grid.style.cssText = 'display: block; width: 100%;';
      grid.innerHTML = `
        <div class="cart-empty-state welcome-home-card" style="grid-column: 1 / -1; padding: 28px 18px; text-align: center; background: #FFFFFF; border: 1.5px solid #E2E8F0; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.12); margin-top: 6px;">
          <span style="font-size: 44px; display: block; margin-bottom: 8px;">👆</span>
          <h3 style="font-size: 18px; font-weight: 900; color: #0F172A; margin: 0 0 6px 0; letter-spacing: -0.2px;">¡Bienvenido a Pedi Gochos!</h3>
          <p style="font-size: 13.5px; color: #334155; font-weight: 600; margin: 0; line-height: 1.5;">
            Presiona una de las categorías arriba (<strong style="color: #EA580C; font-weight: 800;">Restaurantes, Farmacias, Mercados o Ferreterías</strong>) para ver los comercios disponibles.
          </p>
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
    const rawList = filtered || this.establishments.filter(e => {
      if (e.disabled === true) return false;
      if (e.category !== this.currentCategory) return false;
      if (!this.currentLocation || this.currentLocation === 'all') return true;
      if (!e.location) return true;
      const normEstLoc = (e.location || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const normUserLoc = (this.currentLocation || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return normEstLoc.includes(normUserLoc) || normUserLoc.includes(normEstLoc);
    });
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

    // Only display Destacados del Día if the selected category is Restaurantes (comidas)
    if (this.currentCategory !== 'comidas') {
      section.style.display = 'none';
      section.classList.add('hidden');
      return;
    }

    if (!this.establishments || this.establishments.length === 0) {
      section.style.display = 'none';
      section.classList.add('hidden');
      return;
    }

    section.style.display = 'block';
    section.classList.remove('hidden');
    container.innerHTML = '';

    // Shuffle featured items with session seed (strictly excluding disabled stores)
    const activeEsts = (this.establishments || []).filter(e => {
      if (e.disabled === true) return false;
      if (e.category !== 'comidas') return false;
      if (!this.currentLocation || this.currentLocation === 'all') return true;
      if (!e.location) return true;
      const normEstLoc = (e.location || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const normUserLoc = (this.currentLocation || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return normEstLoc.includes(normUserLoc) || normUserLoc.includes(normEstLoc);
    });
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

    const isStoreOpen = this.isEstablishmentOpen(this.selectedEstablishment);
    const dayMap = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const todayDay = dayMap[new Date().getDay()];

    products.forEach((prod, index) => {
      const isPaused = prod.is_paused === true || prod.available === false;
      const days = (prod.available_days && Array.isArray(prod.available_days) && prod.available_days.length > 0)
        ? prod.available_days.map(d => String(d).toLowerCase())
        : ['todos'];
      
      const isDaySpecific = !days.includes('todos');
      const isAvailableToday = days.includes('todos') || days.includes(todayDay);

      let dayBadgeHTML = '';
      if (isDaySpecific) {
        if (isAvailableToday) {
          dayBadgeHTML = `<span style="display: inline-block; font-size: 10px; font-weight: 800; background: rgba(245,158,11,0.2); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); padding: 2px 6px; border-radius: 4px; margin-bottom: 4px;">🔥 Especial de Hoy (${todayDay.toUpperCase()})</span>`;
        } else {
          const daysNames = days.map(d => d.slice(0, 3).toUpperCase()).join(', ');
          dayBadgeHTML = `<span style="display: inline-block; font-size: 9.5px; font-weight: 700; background: rgba(255,255,255,0.06); color: var(--text-muted); border: 1px solid rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; margin-bottom: 4px;">📅 Solo ${daysNames}</span>`;
        }
      }

      const isItemDisabled = !isStoreOpen || isPaused || !isAvailableToday;

      const card = document.createElement('div');
      card.className = `product-card animate-fade-in-up ${isItemDisabled ? 'product-disabled' : ''}`;
      card.style.cursor = isItemDisabled ? 'not-allowed' : 'pointer';
      card.style.animationDelay = `${index * 0.05}s`;
      if (!isStoreOpen) {
        card.style.opacity = '0.6';
      } else if (isPaused) {
        card.style.opacity = '0.5';
      } else if (!isAvailableToday) {
        card.style.opacity = '0.65';
      }

      if (!isItemDisabled) {
        card.setAttribute('onclick', `MarketplaceApp.openCustomizerModalById('${prod.id}')`);
      } else {
        card.onclick = () => {
          if (!isStoreOpen) {
            const est = this.selectedEstablishment;
            alert(`🔴 "${est ? est.name : 'Este comercio'}" se encuentra CERRADO en este momento.\nHorario de atención: ${this.formatTime12h(est?.open_time)} a ${this.formatTime12h(est?.close_time)}.\n\nSolo se pueden realizar pedidos cuando el restaurante esté abierto.`);
          } else if (isPaused) {
            alert(`⚠️ "${prod.name}" no está disponible en este momento.`);
          } else {
            const daysNames = days.map(d => d.toUpperCase()).join(', ');
            alert(`📅 "${prod.name}" solo se prepara los días: ${daysNames}.`);
          }
        };
      }

      // Check if image exists, otherwise use category fallback or emoji
      let imgHTML = '';
      const estLogo = (this.selectedEstablishment && this.selectedEstablishment.logo) ? this.selectedEstablishment.logo : '🏪';
      if (prod.image) {
        imgHTML = `<img src="${prod.image}" alt="${prod.name}" class="product-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
                   <div class="product-image-placeholder hidden">${estLogo}</div>`;
      } else {
        imgHTML = `<div class="product-image-placeholder">${estLogo}</div>`;
      }

      const actionButtonHTML = !isStoreOpen
        ? `<span style="font-size: 10px; color: #ef4444; font-weight: 800; background: rgba(239,68,68,0.12); padding: 3px 6px; border-radius: 6px; border: 1px solid rgba(239,68,68,0.3);">🔴 Cerrado</span>`
        : (isPaused
          ? `<span style="font-size: 10px; color: #ef4444; font-weight: 800;">Agotado</span>`
          : (!isAvailableToday
            ? `<span style="font-size: 10px; color: var(--text-muted); font-weight: 700;">No hoy</span>`
            : `<button class="btn-add-product" onclick="event.stopPropagation(); MarketplaceApp.openCustomizerModalById('${prod.id}')">+</button>`));

      card.innerHTML = `
        <div class="product-info">
          <div>
            ${dayBadgeHTML}
            <h4>${prod.name}</h4>
            <p>${prod.description || ''}</p>
          </div>
          <div class="product-price-row">
            <span class="product-price">${this.formatPesos(prod.price)}</span>
            ${actionButtonHTML}
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
    let store = this.selectedEstablishment;
    if (this.selectedEstablishment && Array.isArray(this.selectedEstablishment.products)) {
      product = this.selectedEstablishment.products.find(p => String(p.id) === String(productId));
    }
    
    if (!product && Array.isArray(this.establishments)) {
      for (const est of this.establishments) {
        if (Array.isArray(est.products)) {
          const found = est.products.find(p => String(p.id) === String(productId));
          if (found) {
            this.selectedEstablishment = est;
            store = est;
            product = found;
            break;
          }
        }
      }
    }

    if (store && !this.isEstablishmentOpen(store)) {
      alert(`🔴 "${store.name}" se encuentra CERRADO en este momento.\nHorario de atención: ${this.formatTime12h(store.open_time)} a ${this.formatTime12h(store.close_time)}.\n\nSolo se pueden realizar pedidos cuando el restaurante esté abierto.`);
      return;
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
    const store = (this.establishments || []).find(e => e.id === product.restaurant_id) || this.selectedEstablishment || {};
    if (store && store.id && !this.isEstablishmentOpen(store)) {
      alert(`🔴 "${store.name}" se encuentra CERRADO en este momento.\nHorario: ${this.formatTime12h(store.open_time)} a ${this.formatTime12h(store.close_time)}.\n\nSolo se puede pedir cuando el restaurante esté abierto.`);
      return;
    }

    const cartItemId = 'item-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    const cartItem = {
      cart_item_id: cartItemId,
      product_id: product.id,
      product_name: product.name,
      restaurant_id: store.id || product.restaurant_id || '',
      restaurant_name: store.name || product.restaurant_name || '',
      delivery_fee: store.delivery_fee || 0,
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

    setTimeout(() => {
      this.checkBeveragesAndPrompt();
    }, 400);
  }

  isArepaOrHeladoProduct(prod) {
    if (!prod) return false;
    const name = (prod.name || '').toLowerCase();
    const cat = (prod.category || '').toLowerCase();
    return name.includes('arepa') || name.includes('helado') || name.includes('frappé') || name.includes('paleta') || name.includes('sundae') || name.includes('merengada') || name.includes('batido') || cat.includes('arepa') || cat.includes('helado');
  }

  isPizzaProduct(prod) {
    if (!prod) return false;
    const pName = (prod.name || '').toLowerCase();
    const pCat = (prod.category || prod.category_id || '').toLowerCase();
    const rName = (prod.restaurant_name || (this.selectedEstablishment ? this.selectedEstablishment.name : '')).toLowerCase();
    const isDrink = this.isDrinkOrBeverage(prod);
    if (isDrink) return false;

    return (
      pCat.includes('pizza') ||
      pName.includes('pizza') ||
      pName.includes('panzerotti') ||
      pName.includes('metro') ||
      (rName.includes('pizza') && !pCat.includes('bebida') && !pCat.includes('frappe') && !pCat.includes('plato') && !pCat.includes('postre'))
    );
  }

  openCustomizerModal(product) {
    if (!product) return;
    if (typeof product === 'string' || typeof product === 'number') {
      this.openCustomizerModalById(product);
      return;
    }

    const store = (this.establishments || []).find(e => e.id === product.restaurant_id) || this.selectedEstablishment;
    if (store && !this.isEstablishmentOpen(store)) {
      alert(`🔴 "${store.name}" se encuentra CERRADO en este momento.\nHorario: ${this.formatTime12h(store.open_time)} a ${this.formatTime12h(store.close_time)}.\n\nSolo se puede pedir cuando el restaurante esté abierto.`);
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
        selectedCrust: { id: 'tradicional', name: 'Borde Tradicional (Sin relleno)', price: 0 },
        baseIncluded: {
          whole: {},
          halfA: {},
          halfB: {}
        },
        quantities: {
          whole: {},
          halfA: {},
          halfB: {}
        },
        collapsedGroups: {}
      };

      const initSide = (sideKey, targetProduct = product) => {
        this.customizerState.quantities[sideKey] = {};
        this.customizerState.baseIncluded[sideKey] = {};
        if (targetProduct && targetProduct.exclusions && Array.isArray(targetProduct.exclusions)) {
          targetProduct.exclusions.forEach(item => {
            const itemName = typeof item === 'object' && item.name ? item.name : String(item);
            this.customizerState.quantities[sideKey]['base_' + itemName] = 0;
            this.customizerState.baseIncluded[sideKey][itemName] = true;
          });
        }

        if (targetProduct && targetProduct.modifiers && Array.isArray(targetProduct.modifiers)) {
          targetProduct.modifiers.forEach(group => {
            if (group && Array.isArray(group.options)) {
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
      const isPizza = this.isPizzaProduct(product);
      const pizzaSection = document.getElementById('pizza-halves-section');
      if (pizzaSection) {
        if (isPizza) {
          pizzaSection.classList.remove('hidden');
          pizzaSection.style.display = 'block';
          this.customizerState.pizzaMode = 'whole';
          const wholeBtn = document.getElementById('pizza-whole-btn');
          const halvesBtn = document.getElementById('pizza-halves-btn');
          if (wholeBtn) wholeBtn.classList.add('active');
          if (halvesBtn) halvesBtn.classList.remove('active');
        } else {
          pizzaSection.classList.add('hidden');
          pizzaSection.style.display = 'none';
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
    
    // Global Pizza Size Selector (rendered once for the whole pizza in halves mode)
    const globalSizeContainer = document.getElementById('pizza-global-size-container');
    if (globalSizeContainer) {
      globalSizeContainer.innerHTML = '';
      if (isHalves && product.modifiers && Array.isArray(product.modifiers)) {
        const sizeGroup = product.modifiers.find(g => (g.group_name || '').toLowerCase() === 'tamaño');
        if (sizeGroup && Array.isArray(sizeGroup.options)) {
          globalSizeContainer.style.display = 'block';
          const groupDiv = document.createElement('div');
          groupDiv.className = 'modifier-group';
          groupDiv.style.background = 'rgba(255, 94, 58, 0.08)';
          groupDiv.style.border = '1px solid rgba(255, 94, 58, 0.25)';
          groupDiv.style.borderRadius = '14px';
          groupDiv.style.padding = '12px';
          groupDiv.style.marginBottom = '14px';

          groupDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-weight: 800; color: #FFF; font-size: 13.5px;">📏 Tamaño de la Pizza Completa</span>
              <span class="required-badge" style="background: #EF4444; color: #fff; font-size: 10px; font-weight: 900; padding: 2px 6px; border-radius: 4px;">Requerido</span>
            </div>
            <div class="modifier-options-list" id="pizza-global-size-list"></div>
          `;
          const list = groupDiv.querySelector('#pizza-global-size-list');

          // Ensure default size selection if none active
          const hasActiveSize = sizeGroup.options.some(opt => this.customizerState.quantities.whole['opt_' + opt.option_id] === 1);
          if (!hasActiveSize && sizeGroup.options.length > 0) {
            this.customizerState.quantities.whole['opt_' + sizeGroup.options[0].option_id] = 1;
          }

          sizeGroup.options.forEach(opt => {
            const optId = opt.option_id;
            const isSelected = this.customizerState.quantities.whole['opt_' + optId] === 1;
            const deltaVal = this.normalizeCopPrice(opt.extra_price || opt.price || 0);
            const priceTag = deltaVal > 0 ? ` (+${this.formatPesos(deltaVal)})` : '';
            
            const optionDiv = document.createElement('div');
            optionDiv.className = `modifier-option ${isSelected ? 'option-single-active' : ''}`;
            optionDiv.style.cursor = 'pointer';
            optionDiv.onclick = () => {
              sizeGroup.options.forEach(o => {
                this.customizerState.quantities.whole['opt_' + o.option_id] = 0;
              });
              this.customizerState.quantities.whole['opt_' + optId] = 1;
              this.renderCustomizerModifiers();
            };
            optionDiv.innerHTML = `
              <div class="option-label-container">
                <input type="radio" name="radio_global_pizza_size" ${isSelected ? 'checked' : ''} style="margin: 0;">
                <span class="option-name" style="margin-left: 8px; font-weight: 700;">${opt.name || ''}</span>
              </div>
              <div style="display: flex; align-items: center;">
                <span class="option-extra-price" style="font-weight: 800; color: var(--primary);">${priceTag}</span>
              </div>
            `;
            list.appendChild(optionDiv);
          });
          globalSizeContainer.appendChild(groupDiv);
        } else {
          globalSizeContainer.style.display = 'none';
        }
      } else {
        globalSizeContainer.style.display = 'none';
      }
    }

    // Pizza Crust / Bordes Selector (for whole or halves)
    const isPizza = this.isPizzaProduct(product);
    const crustSection = document.getElementById('pizza-crust-section');
    if (crustSection) {
      if (isPizza) {
        crustSection.classList.remove('hidden');
        crustSection.style.display = 'block';
        
        const crustOptions = this.getPizzaCrustOptions(product);
        if (!this.customizerState.selectedCrust) {
          this.customizerState.selectedCrust = crustOptions[0] || { id: 'tradicional', name: 'Borde Tradicional (Sin relleno)', price: 0 };
        }

        const selectedOpt = this.customizerState.selectedCrust;
        const isAccordionOpen = !!this.customizerState.crustAccordionOpen;

        crustSection.innerHTML = `
          <div style="background: #FFFFFF; border: 1.5px solid #F59E0B; border-radius: 16px; margin-bottom: 16px; overflow: hidden; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.12);">
            <!-- Header (Always visible, acts as Accordion Trigger) -->
            <div onclick="MarketplaceApp.togglePizzaCrustAccordion()" 
                 style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; cursor: pointer; background: #FFFBEB; border-bottom: ${isAccordionOpen ? '1.5px solid rgba(245, 158, 11, 0.3)' : 'none'}; user-select: none;">
              <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                <span style="font-size: 20px;">🧀</span>
                <div>
                  <div style="font-weight: 900; color: #1E293B; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
                    Tipo de Borde de la Pizza
                    <span style="background: #FEF3C7; color: #B45309; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px; border: 1px solid #FCD34D;">Opcional</span>
                  </div>
                  <div style="font-size: 11.5px; color: #475569; font-weight: 700; margin-top: 1px;">
                    Seleccionado: <strong style="color: ${selectedOpt.price > 0 ? '#B45309' : '#059669'}; font-weight: 800;">${selectedOpt.name} (${selectedOpt.price > 0 ? `+${this.formatPesos(selectedOpt.price)}` : 'Sin costo'})</strong>
                  </div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 11.5px; font-weight: 800; color: #B45309; background: #FEF3C7; border: 1px solid #FCD34D; padding: 4px 10px; border-radius: 8px;">
                  ${isAccordionOpen ? 'Plegar ▴' : 'Cambiar ▾'}
                </span>
              </div>
            </div>

            <!-- Accordion Content (Visible only when isAccordionOpen) -->
            <div style="display: ${isAccordionOpen ? 'flex' : 'none'}; flex-direction: column; gap: 8px; padding: 12px 14px; background: #FAFAF9;">
              ${crustOptions.map(opt => {
                const isSelected = this.customizerState.selectedCrust && (this.customizerState.selectedCrust.id === opt.id || this.customizerState.selectedCrust.name === opt.name);
                const priceTag = opt.price > 0 ? `+${this.formatPesos(opt.price)}` : 'Sin costo';
                return `
                  <div onclick="MarketplaceApp.selectPizzaCrust('${opt.id}', '${opt.name}', ${opt.price})" 
                       style="display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-radius: 12px; cursor: pointer; transition: all 0.2s; background: ${isSelected ? '#FFFBEB' : '#FFFFFF'}; border: 1.5px solid ${isSelected ? '#F59E0B' : '#E2E8F0'}; box-shadow: ${isSelected ? '0 2px 8px rgba(245, 158, 11, 0.2)' : 'none'};">
                    <div style="display: flex; align-items: center; gap: 10px;">
                      <input type="radio" name="radio_pizza_crust" ${isSelected ? 'checked' : ''} style="margin: 0; accent-color: #F59E0B; width: 18px; height: 18px; pointer-events: none;">
                      <div>
                        <div style="font-weight: 800; font-size: 13.5px; color: ${isSelected ? '#92400E' : '#0F172A'};">${opt.icon || '🧀'} ${opt.name}</div>
                        ${opt.description ? `<div style="font-size: 11.5px; color: #64748B; margin-top: 1px;">${opt.description}</div>` : ''}
                      </div>
                    </div>
                    <span style="font-size: 12.5px; font-weight: 900; color: ${opt.price > 0 ? '#B45309' : '#059669'}; white-space: nowrap;">
                      ${priceTag}
                    </span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      } else {
        crustSection.classList.add('hidden');
        crustSection.style.display = 'none';
        this.customizerState.selectedCrust = null;
      }
    }

    // Col A (Whole / Mitad 1)
    const containerA = document.getElementById('modifiers-groups-a');
    if (containerA) {
      containerA.innerHTML = '';
      const sideKeyA = isHalves ? 'halfA' : 'whole';
      const labelSuffixA = isHalves ? '1' : '';
      this.renderUnifiedList(containerA, sideKeyA, labelSuffixA, isHalves);
    }

    // Col B (Mitad 2) if halves
    const containerB = document.getElementById('modifiers-groups-b');
    if (containerB) {
      containerB.innerHTML = '';
      if (isHalves) {
        const colB = document.getElementById('customizer-col-b');
        const colAHead = document.getElementById('col-a-header');
        if (colB) colB.classList.remove('hidden');
        if (colAHead) {
          colAHead.classList.remove('hidden');
          colAHead.innerHTML = '🌓 Mitad 1 (50%)';
        }
        const colBHead = document.querySelector('#customizer-col-b .customizer-column-header');
        if (colBHead) colBHead.innerHTML = '🌓 Mitad 2 (50%)';
        this.renderUnifiedList(containerB, 'halfB', '2', true);
      } else {
        const colB = document.getElementById('customizer-col-b');
        const colAHead = document.getElementById('col-a-header');
        if (colB) colB.classList.add('hidden');
        if (colAHead) colAHead.classList.add('hidden');
      }
    }

    this.updateCustomizerPrice();
  }

  togglePizzaCrustAccordion() {
    if (!this.customizerState) return;
    this.customizerState.crustAccordionOpen = !this.customizerState.crustAccordionOpen;
    this.renderCustomizerModifiers();
  }

  getPizzaCrustOptions(product) {
    const defaultCrusts = [
      { id: 'tradicional', name: 'Borde Tradicional (Sin relleno)', icon: '🥖', description: 'Masa clásica crujiente', price: 0 },
      { id: 'queso', name: 'Borde de Queso Mozzarella', icon: '🧀', description: 'Relleno de abundante queso fundido', price: 6000 },
      { id: 'salchicha', name: 'Borde de Salchicha', icon: '🌭', description: 'Relleno de salchicha especial', price: 6000 },
      { id: 'bocadillo_queso', name: 'Borde de Queso y Bocadillo', icon: '🍯', description: 'Queso fundido con dulce de guayaba', price: 6000 }
    ];

    let isGrande = false;
    if (product && product.modifiers && this.customizerState && this.customizerState.quantities && this.customizerState.quantities.whole) {
      const sizeGroup = product.modifiers.find(g => (g.group_name || '').toLowerCase() === 'tamaño');
      if (sizeGroup && Array.isArray(sizeGroup.options)) {
        const selectedSizeOpt = sizeGroup.options.find(opt => this.customizerState.quantities.whole['opt_' + opt.option_id] === 1);
        if (selectedSizeOpt && (selectedSizeOpt.name || '').toLowerCase().includes('grande')) {
          isGrande = true;
        }
      }
    }

    const calcPrice = (basePrice) => {
      const norm = this.normalizeCopPrice(basePrice || 0);
      if (norm <= 0) return 0;
      if (isGrande) {
        return norm === 6000 ? 9000 : Math.round(norm * 1.5);
      }
      return norm;
    };

    const storeId = product?.restaurant_id || this.customizerState?.product?.restaurant_id;
    const est = (this.establishments || []).find(e => e.id === storeId);
    if (est && Array.isArray(est.pizza_crusts) && est.pizza_crusts.length > 0) {
      const list = est.pizza_crusts.map(c => ({
        id: c.id || ('crust-' + c.name.toLowerCase().replace(/\s+/g, '-')),
        name: c.name,
        icon: c.icon || (c.name.toLowerCase().includes('salchicha') ? '🌭' : (c.name.toLowerCase().includes('bocadillo') ? '🍯' : '🧀')),
        description: c.description || '',
        price: calcPrice(c.price)
      }));
      const hasTrad = list.some(c => (c.name || '').toLowerCase().includes('tradicional'));
      if (!hasTrad) list.unshift(defaultCrusts[0]);
      return list;
    }

    if (product && product.modifiers && Array.isArray(product.modifiers)) {
      const crustGroup = product.modifiers.find(g => (g.group_name || '').toLowerCase().includes('borde'));
      if (crustGroup && Array.isArray(crustGroup.options) && crustGroup.options.length > 0) {
        const list = crustGroup.options.map(opt => ({
          id: opt.option_id || opt.id,
          name: opt.name,
          icon: opt.name.toLowerCase().includes('salchicha') ? '🌭' : (opt.name.toLowerCase().includes('bocadillo') ? '🍯' : '🧀'),
          description: '',
          price: calcPrice(opt.extra_price || opt.price || 0)
        }));
        const hasTrad = list.some(c => (c.name || '').toLowerCase().includes('tradicional'));
        if (!hasTrad) list.unshift(defaultCrusts[0]);
        return list;
      }
    }

    return defaultCrusts.map(c => ({ ...c, price: calcPrice(c.price) }));
  }

  selectPizzaCrust(id, name, price) {
    this.customizerState.selectedCrust = { id, name, price: Number(price) || 0 };
    this.renderCustomizerModifiers();
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
      const isPizzaCat = this.isPizzaProduct(product);
      if (isPizzaCat) {
        const specDiv = document.createElement('div');
        specDiv.className = 'modifier-group';
        
        const estProducts = (this.selectedEstablishment && Array.isArray(this.selectedEstablishment.products)) ? this.selectedEstablishment.products : [];
        const pizzaProducts = estProducts.filter(p => this.isPizzaProduct(p));
        const currentSpec = sideKey === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB;
        
        let optionsHTML = '<option value="">-- Elige el sabor para esta mitad --</option>';
        pizzaProducts.forEach(p => {
          // NO PRICES IN HALVES SELECTOR (Size sets the price)
          optionsHTML += `<option value="${p.id}" ${currentSpec && currentSpec.id === p.id ? 'selected' : ''}>🍕 ${p.name}</option>`;
        });

        specDiv.innerHTML = `
          <label style="font-weight: 800; font-size: 13px; color: #F59E0B; display: block; margin-bottom: 8px;">Sabor de Pizza${sideLabel}</label>
          <select class="customizer-specialty-select" style="width: 100%; padding: 10px 12px; border-radius: 10px; border: 1.5px solid #F59E0B; background: #111827; color: #FFF; font-weight: 700; font-size: 13px;" onchange="MarketplaceApp.selectHalvesSpecialty('${sideKey}', this.value)">
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

    // Group 1: Required / Single Selections (Sequential Step-by-Step Accordion)
    if (activeProduct.modifiers && Array.isArray(activeProduct.modifiers)) {
      const singleGroups = activeProduct.modifiers.filter(g => {
        if (!g || g.selection_type !== 'single') return false;
        const gNameLower = (g.group_name || '').toLowerCase();
        if (ignoreSize && gNameLower === 'tamaño') return false;
        return true;
      });

      // Determine first uncompleted group index
      let firstPendingIndex = -1;
      singleGroups.forEach((group, gIdx) => {
        const hasSelection = Array.isArray(group.options) && group.options.some(opt => this.customizerState.quantities[sideKey]['opt_' + opt.option_id] === 1);
        if (!hasSelection && firstPendingIndex === -1) {
          firstPendingIndex = gIdx;
        }
      });

      singleGroups.forEach((group, gIdx) => {
        const colId = `collapsible-${group.group_id}-${sideKey}`;
        const selectedOpt = Array.isArray(group.options) ? group.options.find(opt => this.customizerState.quantities[sideKey]['opt_' + opt.option_id] === 1) : null;
        const isCompleted = !!selectedOpt;
        const isCurrentStep = (gIdx === firstPendingIndex) || (firstPendingIndex === -1 && gIdx === 0 && !isCompleted);

        // Determine if group is collapsed:
        let isCollapsed = false;
        if (this.customizerState.collapsedGroups && this.customizerState.collapsedGroups[colId] !== undefined) {
          isCollapsed = this.customizerState.collapsedGroups[colId] === true;
        } else {
          // Default sequential accordion state:
          // Completed groups are collapsed, Current step is open, Future steps are collapsed!
          if (isCompleted) {
            isCollapsed = true;
          } else if (isCurrentStep) {
            isCollapsed = false;
          } else {
            isCollapsed = true;
          }
        }

        const groupDiv = document.createElement('div');
        groupDiv.className = `modifier-group ${isCurrentStep ? 'step-active' : (isCompleted ? 'step-completed' : '')}`;
        const listClass = isCollapsed ? 'modifier-options-list collapsed' : 'modifier-options-list';
        const chevronTransform = isCollapsed ? 'transform: rotate(-90deg);' : 'transform: rotate(0deg);';
        
        let badgeHTML = '';
        if (isCompleted) {
          badgeHTML = `<span class="step-completed-badge" title="${selectedOpt.name}">✅ ${selectedOpt.name}</span>`;
        } else if (isCurrentStep) {
          badgeHTML = `<span class="step-active-badge">👉 Paso ${gIdx + 1}: Elige aquí</span>`;
        } else {
          badgeHTML = `<span class="step-pending-badge">Paso ${gIdx + 1}</span>`;
        }

        groupDiv.innerHTML = `
          <div class="modifier-group-title" onclick="MarketplaceApp.toggleGroupCollapse('${colId}', this)" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 4px 2px;">
            <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; padding-right: 6px;">
              <span style="font-weight: 800; font-size: 13px; color: ${isCurrentStep ? '#EA580C' : (isCompleted ? '#0F172A' : '#475569')};">${group.group_name || ''}${sideLabel}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
              ${badgeHTML}
              <span class="collapse-chevron" style="transition: transform 0.2s; font-size: 11px; color: #64748B; ${chevronTransform}">▼</span>
            </div>
          </div>
          <div class="${listClass}" id="${colId}"></div>
        `;
        const list = groupDiv.querySelector('.modifier-options-list');
        
        if (group.options && Array.isArray(group.options)) {
          group.options.forEach(opt => {
            if (!opt) return;
            const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
            const extraPriceText = (opt.extra_price || opt.price || 0) > 0 ? `+ ${this.formatPesos(opt.extra_price || opt.price)}` : '';
            
            const optionDiv = document.createElement('div');
            optionDiv.className = `modifier-option ${qty === 1 ? 'option-single-active' : ''}`;
            optionDiv.style.cssText = 'cursor: pointer; transition: all 0.2s ease;';
            
            optionDiv.onclick = (e) => {
              e.preventDefault();
              MarketplaceApp.setSingleSelection(group.group_id, opt.option_id, sideKey);
            };

            optionDiv.innerHTML = `
              <div class="option-label-container" style="display: flex; align-items: center; flex: 1; min-width: 0; pointer-events: none;">
                <input type="radio" name="radio_${group.group_id}_${sideKey}" ${qty === 1 ? 'checked' : ''} style="margin: 0; accent-color: #EA580C; width: 18px; height: 18px; flex-shrink: 0;">
                <span class="option-name" style="margin-left: 10px; font-weight: 700; font-size: 13.5px; color: ${qty === 1 ? '#EA580C' : '#1E293B'}; white-space: normal; line-height: 1.35;">${opt.name || ''}</span>
              </div>
              <div style="display: flex; align-items: center; flex-shrink: 0; margin-left: 8px;">
                <span class="option-extra-price" style="font-weight: 800; color: #EA580C; font-size: 12.5px;">${extraPriceText}</span>
              </div>
            `;
            if (list) list.appendChild(optionDiv);
          });
        }
        container.appendChild(groupDiv);
      });
    }

    // Group 2: Base Ingredients / Exclusions ($0 de base incluido, contador en 0 para adicionales)
    if (activeProduct.exclusions && Array.isArray(activeProduct.exclusions) && activeProduct.exclusions.length > 0) {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'modifier-group';
      const colId = `collapsible-base-ingredients-${sideKey}`;
      const isExplicitlyCollapsed = this.customizerState.collapsedGroups && this.customizerState.collapsedGroups[colId] === true;
      const listClass = isExplicitlyCollapsed ? 'modifier-options-list collapsed' : 'modifier-options-list';
      const chevronTransform = isExplicitlyCollapsed ? 'transform: rotate(-90deg);' : 'transform: rotate(0deg);';
      
      groupDiv.innerHTML = `
        <div class="modifier-group-title" onclick="MarketplaceApp.toggleGroupCollapse('${colId}', this)" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700;">Ingredientes Incluidos${sideLabel}</span>
          <span class="collapse-chevron" style="transition: transform 0.2s; font-size: 12px; ${chevronTransform}">▼</span>
        </div>
        <div class="${listClass}" id="${colId}"></div>
      `;
      const list = groupDiv.querySelector('.modifier-options-list');

      activeProduct.exclusions.forEach(item => {
        const itemName = typeof item === 'object' && item.name ? item.name : String(item);
        if (!itemName) return;
        const key = 'base_' + itemName;
        const isIncluded = this.customizerState.baseIncluded?.[sideKey]?.[itemName] !== false;
        const extraQty = this.customizerState.quantities[sideKey][key] || 0;
        const baseExtraPrice = (typeof item === 'object' && item.price !== undefined) ? item.price : 4000;

        const optionDiv = document.createElement('div');
        optionDiv.className = `modifier-option ${isIncluded ? 'option-single-active' : 'option-excluded'}`;

        let rightControlHTML = '';
        if (!isIncluded) {
          rightControlHTML = `<span class="option-extra-price" style="color: #94A3B8; font-weight: 700; font-size: 11.5px;">Sin ingrediente</span>`;
        } else {
          const extraPriceDisplay = extraQty > 0 ? `<span class="option-extra-price" style="margin-right: 8px; color: #F59E0B; font-weight: 800; font-size: 11.5px;">+${this.formatPesos(extraQty * baseExtraPrice)}</span>` : '';
          rightControlHTML = `
            <div style="display: flex; align-items: center;">
              ${extraPriceDisplay}
              <div class="option-qty-control" style="display: flex;">
                <button type="button" class="btn-qty-mini" onclick="event.preventDefault(); event.stopPropagation(); MarketplaceApp.updateBaseIngredientQty('${itemName.replace(/'/g, "\\'")}', '${sideKey}', -1)">-</button>
                <span class="option-qty-val" style="min-width: 20px; text-align: center; font-weight: 800; font-size: 12px;">${extraQty}</span>
                <button type="button" class="btn-qty-mini" onclick="event.preventDefault(); event.stopPropagation(); MarketplaceApp.updateBaseIngredientQty('${itemName.replace(/'/g, "\\'")}', '${sideKey}', 1)">+</button>
              </div>
            </div>
          `;
        }

        optionDiv.innerHTML = `
          <div class="option-label-container" onclick="MarketplaceApp.toggleBaseIngredient('${itemName.replace(/'/g, "\\'")}', '${sideKey}')">
            <input type="checkbox" ${isIncluded ? 'checked' : ''} style="margin: 0;">
            <span class="option-name" style="margin-left: 8px; ${!isIncluded ? 'text-decoration: line-through; opacity: 0.55;' : ''}">${itemName}</span>
          </div>
          ${rightControlHTML}
        `;
        if (list) list.appendChild(optionDiv);
      });

      if (list && list.children.length > 0) {
        container.appendChild(groupDiv);
      }
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
          const groupNameLower = (group.group_name || '').toLowerCase();
          if (groupNameLower === 'tamaño') return;

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
              const optNameLower = (opt.name || '').toLowerCase().trim();

              // Strictly filter out duplicate sizes showing inside Adicionales
              if (optNameLower === 'personal' || optNameLower === 'mediana' || optNameLower === 'grande' || optNameLower === 'pequeña' || optNameLower === 'familiar') {
                return;
              }

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

    if (sideKey === 'halfA') {
      this.customizerState.specialtyA = selectedProduct || null;
    } else {
      this.customizerState.specialtyB = selectedProduct || null;
    }

    if (selectedProduct) {
      if (!this.customizerState.baseIncluded) this.customizerState.baseIncluded = { whole: {}, halfA: {}, halfB: {} };
      this.customizerState.baseIncluded[sideKey] = {};
      if (selectedProduct.exclusions && Array.isArray(selectedProduct.exclusions)) {
        selectedProduct.exclusions.forEach(item => {
          const itemName = typeof item === 'object' && item.name ? item.name : String(item);
          this.customizerState.quantities[sideKey]['base_' + itemName] = 0;
          this.customizerState.baseIncluded[sideKey][itemName] = true;
        });
      }

      if (selectedProduct.modifiers && Array.isArray(selectedProduct.modifiers)) {
        selectedProduct.modifiers.forEach(group => {
          const isSizeGroup = (group.group_name || '').toLowerCase() === 'tamaño';
          if (!isSizeGroup && group.options && Array.isArray(group.options)) {
            group.options.forEach((opt, idx) => {
              if (opt && opt.option_id) {
                if (group.selection_type === 'single') {
                  this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = (idx === 0) ? 1 : 0;
                } else {
                  this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = 0;
                }
              }
            });
          }
        });
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

    if (!this.customizerState.collapsedGroups) {
      this.customizerState.collapsedGroups = {};
    }

    const group = product.modifiers ? product.modifiers.find(g => g.group_id === groupId) : null;
    if (group && group.options) {
      group.options.forEach(opt => {
        this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = (opt.option_id === optionId) ? 1 : 0;
      });
    }

    // Collapse current group upon selection
    const currentColId = `collapsible-${groupId}-${sideKey}`;
    this.customizerState.collapsedGroups[currentColId] = true;

    // Find next uncompleted single selection group in sequential order
    const singleGroups = (product.modifiers || []).filter(g => g.selection_type === 'single');
    const currentGroupIdx = singleGroups.findIndex(g => g.group_id === groupId);

    let nextGroupToOpen = null;
    for (let i = currentGroupIdx + 1; i < singleGroups.length; i++) {
      const nextG = singleGroups[i];
      const hasSel = Array.isArray(nextG.options) && nextG.options.some(opt => this.customizerState.quantities[sideKey]['opt_' + opt.option_id] === 1);
      if (!hasSel) {
        nextGroupToOpen = nextG;
        break;
      }
    }

    // If none found ahead, check if any earlier group is still unanswered
    if (!nextGroupToOpen) {
      for (let i = 0; i < singleGroups.length; i++) {
        const checkG = singleGroups[i];
        const hasSel = Array.isArray(checkG.options) && checkG.options.some(opt => this.customizerState.quantities[sideKey]['opt_' + opt.option_id] === 1);
        if (!hasSel) {
          nextGroupToOpen = checkG;
          break;
        }
      }
    }

    let nextColId = null;
    if (nextGroupToOpen) {
      nextColId = `collapsible-${nextGroupToOpen.group_id}-${sideKey}`;
      this.customizerState.collapsedGroups[nextColId] = false;
    }

    this.renderCustomizerModifiers();
    this.updateCustomizerPrice();

    if (nextColId) {
      setTimeout(() => {
        const nextListEl = document.getElementById(nextColId);
        if (nextListEl) {
          const groupCard = nextListEl.closest('.modifier-group');
          if (groupCard) {
            groupCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      }, 70);
    }
  }

  toggleBaseIngredient(itemName, sideKey = 'whole') {
    if (!this.customizerState) return;
    if (!this.customizerState.baseIncluded) this.customizerState.baseIncluded = { whole: {}, halfA: {}, halfB: {} };
    if (!this.customizerState.baseIncluded[sideKey]) this.customizerState.baseIncluded[sideKey] = {};
    
    const current = this.customizerState.baseIncluded[sideKey][itemName] !== false;
    this.customizerState.baseIncluded[sideKey][itemName] = !current;
    
    // If turned off, reset extra quantity to 0
    if (current === true) {
      if (!this.customizerState.quantities[sideKey]) this.customizerState.quantities[sideKey] = {};
      this.customizerState.quantities[sideKey]['base_' + itemName] = 0;
    }
    
    this.renderCustomizerModifiers();
    this.updateCustomizerPrice();
  }

  updateBaseIngredientQty(itemName, sideKey = 'whole', delta) {
    if (!this.customizerState) return;
    if (!this.customizerState.quantities) this.customizerState.quantities = { whole: {}, halfA: {}, halfB: {} };
    if (!this.customizerState.quantities[sideKey]) this.customizerState.quantities[sideKey] = {};
    if (!this.customizerState.baseIncluded) this.customizerState.baseIncluded = { whole: {}, halfA: {}, halfB: {} };
    if (!this.customizerState.baseIncluded[sideKey]) this.customizerState.baseIncluded[sideKey] = {};

    const key = 'base_' + itemName;
    let current = this.customizerState.quantities[sideKey][key] || 0;
    current += delta;
    if (current < 0) current = 0;
    if (current > 5) current = 5;
    
    this.customizerState.quantities[sideKey][key] = current;
    this.customizerState.baseIncluded[sideKey][itemName] = true;
    
    this.renderCustomizerModifiers();
    this.updateCustomizerPrice();
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
      if (wholeBtn) wholeBtn.classList.add('active');
      if (halvesBtn) halvesBtn.classList.remove('active');
      
      this.customizerState.specialtyA = null;
      this.customizerState.specialtyB = null;
      this.customizerState.quantities.halfA = {};
      this.customizerState.quantities.halfB = {};
    } else {
      if (wholeBtn) wholeBtn.classList.remove('active');
      if (halvesBtn) halvesBtn.classList.add('active');
      
      // Default Mitad 1 to the current selected pizza product
      this.customizerState.specialtyA = this.customizerState.product;
      this.customizerState.quantities.halfA = {};
      if (this.customizerState.product && this.customizerState.product.exclusions && Array.isArray(this.customizerState.product.exclusions)) {
        this.customizerState.product.exclusions.forEach(item => {
          const itemName = typeof item === 'object' && item.name ? item.name : String(item);
          this.customizerState.quantities.halfA['base_' + itemName] = 1;
        });
      }

      this.customizerState.specialtyB = null;
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
        const isSizeGroup = (group.group_name || '').toLowerCase() === 'tamaño';
        if (isHalves && isSizeGroup) return;

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
      // Check whole product required size
      if (product && product.modifiers) {
        const sizeGroup = product.modifiers.find(g => (g.group_name || '').toLowerCase() === 'tamaño');
        if (sizeGroup && sizeGroup.options) {
          const active = sizeGroup.options.some(opt => this.customizerState.quantities.whole['opt_' + opt.option_id] === 1);
          if (!active) allValid = false;
        }
      }
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
    
    let totalExtras = 0;

    const sumSide = (targetProduct, sideKey, ignoreSize = false) => {
      let sideSum = 0;
      if (!targetProduct) return 0;

      if (targetProduct.exclusions && Array.isArray(targetProduct.exclusions)) {
        targetProduct.exclusions.forEach(item => {
          const itemName = typeof item === 'object' && item.name ? item.name : String(item);
          const basePrice = (typeof item === 'object' && item.price !== undefined) ? item.price : 4000;
          const isIncluded = this.customizerState.baseIncluded?.[sideKey]?.[itemName] !== false;
          const extraQty = this.customizerState.quantities[sideKey]['base_' + itemName] || 0;
          if (isIncluded && extraQty > 0) {
            sideSum += extraQty * basePrice;
          }
        });
      }

      if (targetProduct.modifiers && Array.isArray(targetProduct.modifiers)) {
        targetProduct.modifiers.forEach(group => {
          if (group && group.options && Array.isArray(group.options)) {
            const isSize = (group.group_name || '').toLowerCase() === 'tamaño';
            if (ignoreSize && isSize) return;

            group.options.forEach(opt => {
              if (opt && opt.option_id) {
                const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
                const extraPrice = this.normalizeCopPrice(opt.extra_price || opt.price || 0);
                if (qty > 0 && extraPrice > 0) {
                  if (group.selection_type === 'single') {
                    sideSum += extraPrice;
                  } else {
                    sideSum += extraPrice * qty;
                  }
                }
              }
            });
          }
        });
      }
      return sideSum;
    };

    if (isHalves) {
      // Global pizza size & extras from 'whole'
      totalExtras += sumSide(product, 'whole', false);
      // Extras / ingredients from Half 1 (ignore size)
      if (this.customizerState.specialtyA) {
        totalExtras += sumSide(this.customizerState.specialtyA, 'halfA', true);
      }
      // Extras / ingredients from Half 2 (ignore size)
      if (this.customizerState.specialtyB) {
        totalExtras += sumSide(this.customizerState.specialtyB, 'halfB', true);
      }
    } else {
      totalExtras += sumSide(product, 'whole', false);
    }

    // Include selected pizza crust price
    if (this.customizerState.selectedCrust && this.customizerState.selectedCrust.price > 0) {
      totalExtras += this.customizerState.selectedCrust.price;
    }

    return totalExtras;
  }

  updateCustomizerPrice() {
    if (!this.customizerState || !this.customizerState.product) return;
    const product = this.customizerState.product;
    const isHalves = this.customizerState.pizzaMode === 'halves';
    
    // Base price is strictly the main product price (Size delta is computed in calculateExtrasTotal)
    const basePrice = this.normalizeCopPrice(product.price);
    const extrasTotal = this.calculateExtrasTotal();
    const qty = this.customizerState.quantity || 1;
    
    const unitPrice = basePrice + extrasTotal;
    const combinedTotal = unitPrice * qty;
    
    const topPriceEl = document.getElementById('customizer-base-price');
    if (topPriceEl) {
      topPriceEl.innerText = this.formatPesos(unitPrice);
    }
    
    const allValid = this.validateRequiredModifiers();
    
    const pName = product.name || '';
    const contornosMatch = pName.match(/(\d+)\s+Contornos/i);
    const maxContornosAllowed = contornosMatch ? parseInt(contornosMatch[1], 10) : null;
    
    const sideKey = isHalves ? 'halfA' : 'whole';
    let selectedContornosCount = 0;
    const activeProduct = isHalves ? this.customizerState.specialtyA : product;
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
        btn.innerText = `🛒 Agregar al Carrito • ${this.formatPesos(combinedTotal)}`;
        btn.disabled = !allValid;
      }
    }
  }

  updateCustomizerQty(delta) {
    let currentQty = this.customizerState.quantity;
    currentQty += delta;
    if (currentQty < 1) currentQty = 1;
    
    this.customizerState.quantity = currentQty;
    const displayEl = document.getElementById('customizer-quantity-display');
    if (displayEl) displayEl.innerText = currentQty;
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
      if (sideKey === 'halfA') return '[Mitad 1] ';
      if (sideKey === 'halfB') return '[Mitad 2] ';
      return '';
    };

    // Strict Validation: Ensure all required single selection steps are completed
    const validateSide = (sideKey) => {
      let activeProduct = product;
      if (isHalves) {
        activeProduct = sideKey === 'halfA' ? this.customizerState.specialtyA : this.customizerState.specialtyB;
      }
      if (!activeProduct) return true;

      if (activeProduct.modifiers && Array.isArray(activeProduct.modifiers)) {
        for (const group of activeProduct.modifiers) {
          if (group && group.selection_type === 'single') {
            const isSize = (group.group_name || '').toLowerCase() === 'tamaño';
            if (isHalves && isSize) continue;

            const hasSelection = Array.isArray(group.options) && group.options.some(opt => this.customizerState.quantities[sideKey]['opt_' + opt.option_id] === 1);
            if (!hasSelection) {
              const colId = `collapsible-${group.group_id}-${sideKey}`;
              if (!this.customizerState.collapsedGroups) this.customizerState.collapsedGroups = {};
              this.customizerState.collapsedGroups[colId] = false;
              this.renderCustomizerModifiers();
              setTimeout(() => {
                const el = document.getElementById(colId);
                if (el) {
                  el.closest('.modifier-group')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              }, 60);
              this.showToast(`⚠️ Por favor elige: ${group.group_name}`);
              return false;
            }
          }
        }
      }
      return true;
    };

    if (isHalves) {
      if (!validateSide('halfA') || !validateSide('halfB')) return;
    } else {
      if (!validateSide('whole')) return;
    }

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
      if (activeProduct.exclusions && Array.isArray(activeProduct.exclusions)) {
        activeProduct.exclusions.forEach(item => {
          const itemName = typeof item === 'object' && item.name ? item.name : String(item);
          const basePrice = (typeof item === 'object' && item.price !== undefined) ? item.price : 4000;
          const isIncluded = this.customizerState.baseIncluded?.[sideKey]?.[itemName] !== false;
          const extraQty = this.customizerState.quantities[sideKey]['base_' + itemName] || 0;
          if (!isIncluded) {
            exclusions.push({ name: prefix + `Sin ${itemName}` });
          } else if (extraQty > 0) {
            addOns.push({
              name: prefix + `${itemName} Extra` + (extraQty > 1 ? ` (x${extraQty})` : ''),
              price_per_unit: basePrice,
              quantity: extraQty
            });
          }
        });
      }

      // 2. Modifiers
      if (activeProduct.modifiers && Array.isArray(activeProduct.modifiers)) {
        activeProduct.modifiers.forEach(group => {
          const isSize = (group.group_name || '').toLowerCase() === 'tamaño';
          if (isHalves && isSize) return;

          group.options.forEach(opt => {
            const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
            if (qty > 0) {
              const extraPrice = opt.extra_price || opt.price || 0;
              if (group.selection_type === 'single') {
                singleSelections.push({
                  group_name: prefix + group.group_name,
                  chosen_option: opt.name + (extraPrice > 0 ? ` (+${this.formatPesos(extraPrice)})` : '')
                });
              } else {
                addOns.push({
                  name: prefix + opt.name + (qty > 1 ? ` (x${qty})` : ''),
                  price_per_unit: extraPrice,
                  quantity: qty
                });
              }
            }
          });
        });
      }
    };
    
    if (isHalves) {
      // Process global pizza size from whole product
      if (product.modifiers && Array.isArray(product.modifiers)) {
        const sizeGroup = product.modifiers.find(g => (g.group_name || '').toLowerCase() === 'tamaño');
        if (sizeGroup && sizeGroup.options) {
          sizeGroup.options.forEach(opt => {
            if (this.customizerState.quantities.whole['opt_' + opt.option_id] === 1) {
              const extraPrice = opt.extra_price || opt.price || 0;
              singleSelections.push({
                group_name: 'Tamaño',
                chosen_option: opt.name + (extraPrice > 0 ? ` (+${this.formatPesos(extraPrice)})` : '')
              });
            }
          });
        }
      }
      processSide('halfA');
      processSide('halfB');
    } else {
      processSide('whole');
    }

    // Process selected pizza crust
    if (this.customizerState.selectedCrust && this.customizerState.selectedCrust.id !== 'tradicional') {
      const extraPrice = this.customizerState.selectedCrust.price || 0;
      singleSelections.push({
        group_name: 'Tipo de Borde',
        chosen_option: `${this.customizerState.selectedCrust.name}` + (extraPrice > 0 ? ` (+${this.formatPesos(extraPrice)})` : ''),
        extra_price: extraPrice
      });
    }
    
    const specialNotes = document.getElementById('customizer-special-notes').value.trim();
    const basePrice = this.normalizeCopPrice(product.price);
    const extrasTotal = this.calculateExtrasTotal();
    const unitTotalCalculated = basePrice + extrasTotal;
    const qty = this.customizerState.quantity || 1;
    const subtotalCombined = unitTotalCalculated * qty;
    
    const cartItemId = 'item-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    
    let itemName = product.name;
    if (isHalves) {
      const nameA = this.customizerState.specialtyA ? this.customizerState.specialtyA.name.replace(/^pizza\s+/i, '') : 'Mitad 1';
      const nameB = this.customizerState.specialtyB ? this.customizerState.specialtyB.name.replace(/^pizza\s+/i, '') : 'Mitad 2';
      itemName = `Pizza Mitad y Mitad (${nameA} / ${nameB})`;
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

    setTimeout(() => {
      this.checkBeveragesAndPrompt();
    }, 400);
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

    const cashInput = document.getElementById('order-cash-amount');
    if (cashInput && !cashInput.value.trim()) {
      document.querySelectorAll('.btn-cash-chip').forEach(btn => btn.classList.remove('active'));
      const previewEl = document.getElementById('cash-change-preview');
      if (previewEl) previewEl.style.display = 'none';
    }

    if (this.tableLockedByQR && this.currentTableNumber) {
      this.setOrderType('mesa');
      const tableInput = document.getElementById('order-table-number');
      if (tableInput) {
        tableInput.value = this.currentTableNumber;
        tableInput.readOnly = true;
        tableInput.style.background = 'rgba(255,255,255,0.05)';
        tableInput.style.color = '#10B981';
        tableInput.style.cursor = 'not-allowed';
      }

      const delBtn = document.getElementById('type-delivery-btn');
      if (delBtn) {
        delBtn.style.opacity = '0.35';
        delBtn.style.pointerEvents = 'none';
        delBtn.title = 'Bloqueado por escaneo de Código QR de Mesa';
      }

      const qrBanner = document.getElementById('customer-table-qr-active-banner');
      const qrInfo = document.getElementById('qr-scanned-table-info');
      if (qrBanner) {
        qrBanner.style.display = 'flex';
        if (qrInfo) qrInfo.innerText = `Mesa #${this.currentTableNumber} fijada exclusivamente por Código QR. Pedido a tu mesa.`;
      }

      const badge = document.getElementById('customer-selected-table-badge');
      if (badge) {
        badge.innerText = `🔒 Mesa #${this.currentTableNumber} fijada y bloqueada por Código QR`;
        badge.style.display = 'block';
      }
    } else {
      // General store QR or normal visit: DO NOT lock!
      const delBtn = document.getElementById('type-delivery-btn');
      if (delBtn) {
        delBtn.style.opacity = '1';
        delBtn.style.pointerEvents = 'auto';
        delBtn.title = '';
      }

      const tableInput = document.getElementById('order-table-number');
      if (tableInput) {
        tableInput.readOnly = false;
        tableInput.style.background = '';
        tableInput.style.color = '';
        tableInput.style.cursor = 'text';
      }

      const qrBanner = document.getElementById('customer-table-qr-active-banner');
      if (qrBanner) {
        qrBanner.style.display = 'none';
      }

      const badge = document.getElementById('customer-selected-table-badge');
      if (badge && !tableInput?.value) {
        badge.style.display = 'none';
      }

      if (this.orderType === 'delivery') {
        setTimeout(() => {
          this.initLeafletMap();
        }, 250);
      }
    }
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
    if (this.tableLockedByQR && type === 'delivery') {
      this.showToast(`🔒 Tu pedido está fijado exclusivamente a la Mesa #${this.currentTableNumber} por escaneo de Código QR.`);
      return;
    }
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
      setTimeout(() => {
        this.initLeafletMap();
      }, 200);
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
      this.calculateCashChange();
    } else {
      if (cashBtn) cashBtn.classList.remove('active');
      if (transferBtn) transferBtn.classList.add('active');
      if (cashDetails) cashDetails.classList.add('hidden');
      if (transferDetails) transferDetails.classList.remove('hidden');
    }
  }

  selectCashDenomination(val) {
    document.querySelectorAll('.btn-cash-chip').forEach(btn => {
      btn.classList.remove('active');
    });

    const cashInput = document.getElementById('order-cash-amount');
    const chipId = (val === 'exacto' || val === 'otro') ? `chip-cash-${val}` : `chip-cash-${val}`;
    const activeChip = document.getElementById(chipId);
    if (activeChip) {
      activeChip.classList.add('active');
    }

    if (val === 'exacto') {
      if (cashInput) cashInput.value = 'Pago Exacto (Sin vuelto)';
    } else if (val === 'otro') {
      if (cashInput) {
        cashInput.value = '';
        cashInput.focus();
      }
    } else {
      if (cashInput) cashInput.value = `$${Number(val).toLocaleString('de-DE')} COP`;
    }

    this.calculateCashChange();
  }

  calculateCashChange() {
    const cashInput = document.getElementById('order-cash-amount');
    const previewEl = document.getElementById('cash-change-preview');
    if (!cashInput || !previewEl) return;

    const valStr = cashInput.value.trim();
    if (!valStr) {
      previewEl.style.display = 'none';
      return;
    }

    previewEl.style.display = 'block';

    if (valStr.toLowerCase().includes('exacto')) {
      previewEl.style.color = '#6EE7B7';
      previewEl.style.background = '#042f2e';
      previewEl.style.borderColor = '#10B981';
      previewEl.innerHTML = `✅ <strong>Pago Exacto:</strong> No se requiere cambio para el repartidor.`;
      return;
    }

    const numMatch = valStr.replace(/\./g, '').replace(/,/g, '').match(/\d+/);
    if (!numMatch) {
      previewEl.style.display = 'none';
      return;
    }

    const paidNum = parseFloat(numMatch[0]);
    let totalCop = 0;
    const totalEl = document.getElementById('cart-total');
    if (totalEl) {
      const match = totalEl.innerText.replace(/\./g, '').replace(/,/g, '').match(/\d+/);
      if (match) totalCop = parseFloat(match[0]);
    }

    if (paidNum > 0 && totalCop > 0) {
      if (paidNum >= totalCop) {
        const change = paidNum - totalCop;
        previewEl.style.color = '#6EE7B7';
        previewEl.style.background = '#042f2e';
        previewEl.style.borderColor = '#10B981';
        previewEl.innerHTML = `💵 <strong>Pagas con:</strong> $${paidNum.toLocaleString('de-DE')} COP ➔ <strong style="color:#FDE047;">Llevar Vuelto:</strong> $${change.toLocaleString('de-DE')} COP`;
      } else {
        previewEl.style.color = '#FDE047';
        previewEl.style.background = '#451a03';
        previewEl.style.borderColor = '#F59E0B';
        previewEl.innerHTML = `⚠️ El monto ingresado ($${paidNum.toLocaleString('de-DE')}) es menor al total del pedido ($${totalCop.toLocaleString('de-DE')}).`;
      }
    }
  }

  isDrinkOrBeverage(item) {
    if (!item) return false;
    const cat = (item.category || '').toLowerCase().trim();
    const name = (item.name || '').toLowerCase().trim();

    // 1. Definitively exclude all solid foods, pizzas, meals and snacks
    const nonDrinkKeywords = [
      'pizza', 'pizzas', 'hamburguesa', 'burger', 'perro', 'hot dog', 'hotdog',
      'salchipapa', 'shawarma', 'pepito', 'arepa', 'empanada', 'taco', 'burrito',
      'pollo', 'carne', 'sandwich', 'sándwich', 'panzerotti', 'pasticho', 'pastiche',
      'gratinado', 'plato', 'entrada', 'almuerzo', 'sopa', 'caldo', 'arroz',
      'pasta', 'lasagna', 'postre', 'tequeño', 'croqueta', 'nugget', 'costilla',
      'alitas', 'papas', 'porcion', 'porción', 'torta', 'helado'
    ];
    if (nonDrinkKeywords.some(w => cat.includes(w) || name.includes(w))) {
      return false;
    }

    // 2. Exact positive drink categories
    const drinkCategories = [
      'bebida', 'bebidas', 'refresco', 'refrescos', 'gaseosa', 'gaseosas',
      'jugo', 'jugos', 'frappe', 'frappes', 'licor', 'licores', 'cerveza',
      'cervezas', 'coctel', 'cocteles', 'cafeteria', 'café', 'cafes', 'malteada', 'malteadas'
    ];
    if (drinkCategories.some(c => cat.includes(c))) {
      return true;
    }

    // 3. Positive drink names
    const drinkNames = [
      'refresco', 'gaseosa', 'jugo', 'frappe', 'frappé', 'agua mineral', 'agua pura', 'botella de agua',
      'coca-cola', 'coca cola', 'cocacola', 'pepsi', 'frescolita', 'chinotto', '7up', 'seven up',
      'hit ', 'postobon', 'sprite', 'fanta', 'quatro', 'cuatro', 'nestea', 'lipton',
      'monster', 'red bull', 'redbull', 'cerveza', 'polar', 'solera', 'heineken', 'corona',
      'aguila', 'pilsen', 'poker', 'costeña', 'club colombia', 'malta', 'maltin',
      'limonada', 'smoothie', 'batido', 'malteada', 'te frio', 'té frío', 'iced tea',
      'mocaccino', 'capuccino', 'cappuccino', 'espresso', 'latte', 'milo'
    ];
    return drinkNames.some(d => name.includes(d));
  }


  getAvailableBeveragesFromCartStores() {
    const storeIds = [...new Set(this.cart.items.map(i => i.restaurant_id || i.restaurantId || i.establishmentId || i.establishment_id || (this.selectedEstablishment ? this.selectedEstablishment.id : null)).filter(Boolean))];
    const drinks = [];

    storeIds.forEach(sId => {
      const est = (this.establishments || []).find(e => String(e.id) === String(sId));
      if (est && Array.isArray(est.products)) {
        est.products.forEach(p => {
          if (p && this.isDrinkOrBeverage(p) && !p.is_paused) {
            drinks.push({
              ...p,
              restaurant_id: est.id,
              restaurant_name: est.name
            });
          }
        });
      }
    });

    if (drinks.length === 0 && this.selectedEstablishment && Array.isArray(this.selectedEstablishment.products)) {
      this.selectedEstablishment.products.forEach(p => {
        if (p && this.isDrinkOrBeverage(p) && !p.is_paused) {
          drinks.push({
            ...p,
            restaurant_id: this.selectedEstablishment.id,
            restaurant_name: this.selectedEstablishment.name
          });
        }
      });
    }

    return drinks;
  }

  getPizzasWithoutSpecialCrustInCart() {
    return this.cart.items.filter(item => {
      const pName = (item.product_name || item.product?.name || item.name || '').toLowerCase();
      const pCat = (item.product?.category || item.category || '').toLowerCase();
      const rName = (item.restaurant_name || (this.selectedEstablishment ? this.selectedEstablishment.name : '')).toLowerCase();
      const isDrink = this.isDrinkOrBeverage(item);
      const isPizza = !isDrink && (
        pCat.includes('pizza') || 
        pName.includes('pizza') || 
        pName.includes('medio metro') || 
        pName.includes('un metro') || 
        pName.includes('metro y medio') || 
        pName.includes('panzerotti') ||
        (rName.includes('pizza') && !pCat.includes('bebida') && !pCat.includes('frappe') && !pCat.includes('plato'))
      );
      if (!isPizza) return false;
      const hasSpecialCrust = item.selected_specifications?.single_selections?.some(s => 
        (s.group_name || '').toLowerCase().includes('borde') && 
        !s.chosen_option.toLowerCase().includes('tradicional')
      );
      return !hasSpecialCrust;
    });
  }

  addCrustToCartItem(cartItemId, crustName, crustPrice) {
    const item = this.cart.items.find(i => i.cart_item_id === cartItemId);
    if (!item) return;

    if (!item.selected_specifications) {
      item.selected_specifications = { single_selections: [], add_ons: [], exclusions: [], special_notes: '' };
    }
    if (!Array.isArray(item.selected_specifications.single_selections)) {
      item.selected_specifications.single_selections = [];
    }

    const prevCrustIdx = item.selected_specifications.single_selections.findIndex(s => (s.group_name || '').toLowerCase().includes('borde'));
    let prevExtra = 0;
    if (prevCrustIdx !== -1) {
      prevExtra = item.selected_specifications.single_selections[prevCrustIdx].extra_price || 0;
      item.selected_specifications.single_selections.splice(prevCrustIdx, 1);
    }

    const normPrice = this.normalizeCopPrice(crustPrice);
    item.selected_specifications.single_selections.push({
      group_name: 'Tipo de Borde',
      chosen_option: `${crustName} (+${this.formatPesos(normPrice)})`,
      extra_price: normPrice
    });

    item.unit_total_calculated = (item.unit_total_calculated - prevExtra) + normPrice;
    item.subtotal_combined = item.unit_total_calculated * item.quantity;

    this.updateCartBadge();
    this.showToast(`🧀 ${crustName} agregado a tu pizza`);

    // Re-render upsell modal list so user sees updated status
    this.checkBeveragesAndPrompt();
  }

  checkBeveragesAndPrompt() {
    const pizzasWithoutCrust = this.getPizzasWithoutSpecialCrustInCart();
    const hasBeverages = this.cart.items.some(i => this.isDrinkOrBeverage(i));
    const availableDrinks = this.getAvailableBeveragesFromCartStores();

    // If no pizzas need crusts AND user already has drinks, skip modal
    if (pizzasWithoutCrust.length === 0 && hasBeverages) {
      return false;
    }

    const iconEl = document.getElementById('upsell-modal-icon');
    const titleEl = document.getElementById('upsell-modal-title');
    const subEl = document.getElementById('upsell-modal-subtitle');

    if (iconEl) iconEl.innerText = '🍕🥤';
    if (titleEl) titleEl.innerText = 'Sugerencias y Personalización';
    if (subEl) subEl.innerText = 'Personaliza tu pizza con deliciosos bordes rellenos y acompaña tu orden con bebidas frías.';

    const listContainer = document.getElementById('beverage-upsell-list');
    if (listContainer) {
      let html = '';

      // 1. Pizza Crust Suggestions Section
      if (pizzasWithoutCrust.length > 0) {
        html += `
          <div style="background: rgba(245, 158, 11, 0.08); border: 1.5px solid rgba(245, 158, 11, 0.35); border-radius: 16px; padding: 14px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
              <span style="font-size: 20px;">🧀</span>
              <h4 style="margin: 0; color: #FCD34D; font-size: 14px; font-weight: 800;">Bordes Rellenos para tus Pizzas</h4>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              ${pizzasWithoutCrust.map(pizza => {
                const restId = pizza.restaurant_id || pizza.restaurantId || pizza.establishmentId;
                let availCrusts = this.getPizzaCrustOptions({ restaurant_id: restId }).filter(c => (c.price || 0) > 0);
                if (availCrusts.length === 0) {
                  availCrusts = [
                    { id: 'queso', name: 'Borde de Queso', icon: '🧀', price: 6000 },
                    { id: 'salchicha', name: 'Borde de Salchicha', icon: '🌭', price: 6000 },
                    { id: 'bocadillo_queso', name: 'Borde Queso y Bocadillo', icon: '🍯', price: 6000 }
                  ];
                }
                return `
                  <div style="background: rgba(0,0,0,0.35); border-radius: 12px; padding: 10px 12px; border: 1px solid rgba(255,255,255,0.08);">
                    <div style="font-weight: 800; font-size: 13px; color: #FFF; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                      <span>🍕 ${pizza.product_name || pizza.name}</span>
                      <span style="font-size: 11px; color: var(--text-muted);">${pizza.restaurant_name || ''}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px;">
                      ${availCrusts.map(c => `
                        <button type="button" onclick="MarketplaceApp.addCrustToCartItem('${pizza.cart_item_id}', '${c.name}', ${c.price})" style="background: rgba(245,158,11,0.15); border: 1px solid #F59E0B; color: #FFF; padding: 8px 10px; border-radius: 10px; font-size: 11px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s;">
                          ${c.icon || '🧀'} ${c.name} (+${this.formatPesos(c.price)})
                        </button>
                      `).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      // 2. Beverage Suggestions Section
      if (availableDrinks.length > 0) {
        html += `
          <div style="background: rgba(59, 130, 246, 0.08); border: 1.5px solid rgba(59, 130, 246, 0.35); border-radius: 16px; padding: 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px;">🥤</span>
                <h4 style="margin: 0; color: #93C5FD; font-size: 14px; font-weight: 800;">Bebidas del Restaurante</h4>
              </div>
              <span style="font-size: 11px; color: #93C5FD; font-weight: 700; background: rgba(59,130,246,0.2); padding: 2px 8px; border-radius: 8px;">${availableDrinks.length} disponibles</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${availableDrinks.map(drink => {
                const rawPrice = drink.price || 0;
                const priceCop = rawPrice < 1000 ? rawPrice * 1000 : rawPrice;
                const imgUrl = drink.image || '/images/burger_royale.jpg';
                return `
                  <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); padding: 9px 12px; border-radius: 12px; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
                      <img src="${imgUrl}" alt="${drink.name}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
                      <div>
                        <div style="font-weight: 800; font-size: 13px; color: #FFF;">${drink.name}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${drink.restaurant_name}</div>
                        <div style="font-size: 12px; font-weight: 800; color: var(--primary); margin-top: 1px;">$${priceCop.toLocaleString('de-DE')} COP</div>
                      </div>
                    </div>
                    <button type="button" onclick="MarketplaceApp.addBeverageAndRefresh('${drink.id}', '${drink.restaurant_id}')" style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: #FFF; border: none; padding: 7px 12px; border-radius: 9px; font-weight: 800; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 4px; box-shadow: 0 4px 10px rgba(16,185,129,0.3); white-space: nowrap;">
                      ➕ Agregar
                    </button>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      listContainer.innerHTML = html;
    }

    // 3. Live Beverage Status Indicator at the Bottom
    const statusContainer = document.getElementById('upsell-beverage-status-container');
    if (statusContainer) {
      if (hasBeverages) {
        statusContainer.innerHTML = `
          <div style="background: rgba(16, 185, 129, 0.15); border: 1.5px solid #10B981; border-radius: 12px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 18px;">✅</span>
              <div style="font-size: 12.5px; font-weight: 800; color: #6EE7B7;">Con Bebida Incluida en tu pedido</div>
            </div>
            <span style="font-size: 12px; color: #10B981; font-weight: 900; background: rgba(16,185,129,0.2); padding: 3px 8px; border-radius: 6px;">✓ Listo</span>
          </div>
        `;
      } else {
        statusContainer.innerHTML = `
          <div class="beverage-missing-pulse" style="border-radius: 12px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1.5px solid #EF4444; background: rgba(239, 68, 68, 0.15);">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 18px;">⚠️</span>
              <div style="font-size: 12px; font-weight: 800; color: #FCA5A5;">Tu pedido aún NO incluye bebidas</div>
            </div>
            <span style="font-size: 11px; color: #FCD34D; font-weight: 800;">¡Elige una arriba! 👆</span>
          </div>
        `;
      }
    }

    const modal = document.getElementById('beverage-upsell-modal');
    if (modal) {
      modal.classList.add('open');
      modal.style.setProperty('display', 'flex', 'important');
      return true;
    }

    return false;
  }

  addBeverageAndRefresh(prodId, restId) {
    const est = (this.establishments || []).find(e => e.id === restId);
    if (!est) return;
    const prod = (est.products || []).find(p => p.id === prodId);
    if (!prod) return;

    this.addDirectToCart(prod);
    this.showToast(`🥤 ${prod.name} agregada al carrito`);

    // Re-render the upsell list
    this.checkBeveragesAndPrompt();
  }

  closeBeverageModalAndProceed() {
    const modal = document.getElementById('beverage-upsell-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.style.setProperty('display', 'none', 'important');
    }
    this.submitOrder(true);
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

  async submitOrder(skipBeveragePrompt = false) {
    // 0. Verify that all restaurants in cart are currently OPEN
    for (const item of this.cart.items) {
      const store = (this.establishments || []).find(e => e.id === item.restaurant_id) || this.selectedEstablishment;
      if (store && !this.isEstablishmentOpen(store)) {
        alert(`🔴 No es posible enviar el pedido.\n\nEl restaurante "${store.name}" se encuentra CERRADO en este momento.\nHorario de Atención: ${this.formatTime12h(store.open_time)} a ${this.formatTime12h(store.close_time)}.\n\nSolo se pueden procesar pedidos de restaurantes que se encuentren abiertos.`);
        return;
      }
    }

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
      // Upsell beverage suggestion before confirming final order
      if (!skipBeveragePrompt) {
        const openedPrompt = this.checkBeveragesAndPrompt();
        if (openedPrompt) {
          return;
        }
      }
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
        const cachedLat = localStorage.getItem('user_gps_lat');
        const cachedLng = localStorage.getItem('user_gps_lng');
        if (cachedLat && cachedLng) {
          this.selectedLatitude = parseFloat(cachedLat);
          this.selectedLongitude = parseFloat(cachedLng);
        } else {
          alert('📍 Por favor, toca tu ubicación exacta en el mapa para que el domiciliario sepa a dónde llevar tu pedido.');
          return;
        }
      }
    }

    const paymentMethod = this.paymentMethod || 'Efectivo';
    let paymentNotes = '';
    const cashAmtInpEl = document.getElementById('order-cash-amount');

    if (paymentMethod === 'Efectivo') {
      const cashVal = cashAmtInpEl ? cashAmtInpEl.value.trim() : '';
      if (!cashVal) {
        const cashBox = document.getElementById('payment-cash-details');
        if (cashBox) {
          cashBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
          cashBox.style.borderColor = '#EF4444';
          cashBox.style.boxShadow = '0 0 25px rgba(239, 68, 68, 0.9)';
          setTimeout(() => {
            cashBox.style.borderColor = '';
            cashBox.style.boxShadow = '';
          }, 3500);
        }
        alert('💵 Por favor, indica tu billete o selecciona "Pago Exacto" en el apartado de Efectivo para que el repartidor lleve tu cambio.');
        return;
      }
      const changeEl = document.getElementById('cash-change-preview');
      const changeText = (changeEl && changeEl.style.display !== 'none') ? ` (${changeEl.innerText.replace(/^[^\w]+/, '')})` : '';
      paymentNotes = `Paga con: ${cashVal}${changeText}`;
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

      // Show prominent restaurant contact notice modal to reassure the user
      this.openOrderNoticeModal({
        storeNames: shopIds.map(id => groupedItems[id].name).join(', '),
        phone: phone,
        paymentMethod: paymentMethod,
        paymentNotes: paymentNotes,
        orderCount: shopIds.length
      });

    } catch (e) {
      console.error(e);
      alert('Error de conexión o problema al enviar el pedido: ' + e.message);
    }
  }

  openOrderNoticeModal(data = {}) {
    const modal = document.getElementById('order-confirmation-notice-modal');
    const summaryEl = document.getElementById('order-notice-summary');
    if (summaryEl) {
      const stores = data.storeNames || (this.selectedEstablishment ? this.selectedEstablishment.name : 'el restaurante');
      const phoneTxt = data.phone ? `<div style="margin-bottom: 4px;">📱 <strong>Teléfono de contacto:</strong> ${data.phone}</div>` : '';
      const payTxt = data.paymentMethod ? `<div>💵 <strong>Método de pago:</strong> ${data.paymentMethod}${data.paymentNotes ? ` <span style="color:#FDE047;">(${data.paymentNotes})</span>` : ''}</div>` : '';

      summaryEl.innerHTML = `
        <div style="margin-bottom: 4px;">🏪 <strong>Establecimiento:</strong> ${stores}</div>
        ${phoneTxt}
        ${payTxt}
      `;
    }
    if (modal) {
      modal.classList.add('open');
      modal.style.setProperty('display', 'flex', 'important');
    }
  }

  closeOrderNoticeModal() {
    const modal = document.getElementById('order-confirmation-notice-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
    }
    this.openUserOrdersModal({ highlightFirst: true });
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

  requestAutomaticGPS(showToast = false) {
    const display = document.getElementById('active-location-display');
    if (display) display.innerText = '📡 Detectando GPS...';

    if (!navigator.geolocation) {
      if (showToast) this.showToast('⚠️ Tu navegador o dispositivo no soporta geolocalización.');
      if (display) display.innerText = '📍 Marca tu ubicación';
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userLat = pos.coords.latitude;
        const userLng = pos.coords.longitude;
        this.userGpsLat = userLat;
        this.userGpsLng = userLng;
        this.selectedLatitude = userLat;
        this.selectedLongitude = userLng;

        try {
          localStorage.setItem('user_gps_lat', userLat.toString());
          localStorage.setItem('user_gps_lng', userLng.toString());
        } catch(e) {}

        if (display) {
          display.innerText = `📍 GPS (${userLat.toFixed(4)}, ${userLng.toFixed(4)})`;
        }

        const shopCenter = this.getActiveShopCenter();
        if (this.leafMap) {
          this.setUserLocationOnMap([userLat, userLng], shopCenter, true);
        }

        const modalTitle = document.getElementById('modal-gps-status-title');
        if (modalTitle) modalTitle.innerText = `GPS Activo (${userLat.toFixed(4)}, ${userLng.toFixed(4)})`;

        if (showToast) {
          this.showToast(`🎯 ¡Ubicación GPS detectada con éxito!`);
        }
      },
      (err) => {
        console.warn('GPS error / permission denied:', err);
        const cachedLat = localStorage.getItem('user_gps_lat');
        const cachedLng = localStorage.getItem('user_gps_lng');
        if (cachedLat && cachedLng) {
          const latNum = parseFloat(cachedLat);
          const lngNum = parseFloat(cachedLng);
          this.userGpsLat = latNum;
          this.userGpsLng = lngNum;
          this.selectedLatitude = latNum;
          this.selectedLongitude = lngNum;
          if (display) display.innerText = `📍 GPS (${latNum.toFixed(4)}, ${lngNum.toFixed(4)})`;
          const shopCenter = this.getActiveShopCenter();
          if (this.leafMap) {
            this.setUserLocationOnMap([latNum, lngNum], shopCenter, true);
          }
        } else {
          if (display) display.innerText = '📍 Marca tu ubicación';
        }
        if (showToast) {
          this.showToast('⚠️ No se pudo obtener GPS automáticamente. Puedes tocar tu ubicación en el mapa al hacer tu pedido.', true);
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }

  openLocationModal() {
    this.requestAutomaticGPS(true);
    const modal = document.getElementById('location-modal');
    if (modal) {
      this.closeAllModals();
      modal.classList.add('open');
      modal.style.setProperty('display', 'flex', 'important');
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
    // Base rate covers the initial 2.5 km
    if (dist <= 2.5) {
      return minFee;
    }
    // Beyond 2.5 km: base fee + $1.500 COP per each extra km (rounded to nearest 100 COP)
    const extraKm = dist - 2.5;
    const extraFee = Math.round((extraKm * 1500) / 100) * 100;
    return minFee + extraFee;
  }

  getActiveShopCenter() {
    // Determine distance directly from the specific Restaurant's own registered GPS coordinates
    let est = this.selectedEstablishment;
    if (!est && this.cart && this.cart.items && this.cart.items.length > 0) {
      const shopId = this.cart.items[0].restaurant_id || this.cart.items[0].establishmentId;
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
    return this.locationCenters[this.currentLocation] || [7.8145, -72.4430];
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

    // Initialize Leaflet map centered at User GPS if available, otherwise Restaurant location
    const initialCenter = (this.selectedLatitude && this.selectedLongitude)
      ? [this.selectedLatitude, this.selectedLongitude]
      : shopCenter;

    this.leafMap = L.map('checkout-leaflet-map').setView(initialCenter, 15);

    // OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(this.leafMap);

    // 1. Create Restaurant Origin Marker
    const storeIcon = this.createStoreMarkerIcon(this.selectedEstablishment || { name: 'Restaurante', logo: '🏪' });
    this.sedeMarker = L.marker(shopCenter, { icon: storeIcon, draggable: false }).addTo(this.leafMap);
    const storeName = this.selectedEstablishment ? this.selectedEstablishment.name : 'Restaurante';
    this.sedeMarker.bindPopup(`<b>🏪 Restaurante: ${storeName}</b><br><small>Origen del Domicilio</small>`);

    // 2. Create User Destination Location Marker (Interactive / Draggable with radar effect)
    const userIcon = L.divIcon({
      className: 'custom-user-marker',
      html: `<div style="position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
               <div style="position: absolute; width: 40px; height: 40px; background: rgba(239, 68, 68, 0.3); border-radius: 50%; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
               <div style="position: relative; background-color: #EF4444; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 17px; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.5); border: 2.5px solid white; cursor: grab;">📍</div>
             </div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const markerPos = (this.selectedLatitude && this.selectedLongitude)
      ? [this.selectedLatitude, this.selectedLongitude]
      : shopCenter;

    this.leafMarker = L.marker(markerPos, { icon: userIcon, draggable: true }).addTo(this.leafMap);

    this.leafMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      this.setUserLocationOnMap([pos.lat, pos.lng], shopCenter, true);
    });

    this.leafMap.on('click', (e) => {
      this.setUserLocationOnMap([e.latlng.lat, e.latlng.lng], shopCenter, true);
    });

    if (this.selectedLatitude && this.selectedLongitude) {
      this.setUserLocationOnMap([this.selectedLatitude, this.selectedLongitude], shopCenter, true);
    } else {
      this.fetchUserGPSLocation(shopCenter);
    }
  }

  setDeliveryZone(zoneKey) {
    // Deprecated in favor of exact GPS pin positioning
  }

  onAddressInput(val) {
    // Just accepts typed address text (e.g. Calle, Casa, Referencia)
  }

  fetchUserGPSLocation(shopCenter) {
    const distSpan = document.getElementById('map-calc-distance');
    if (distSpan) distSpan.innerText = '📡 Obteniendo GPS...';

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const userLat = pos.coords.latitude;
          const userLng = pos.coords.longitude;
          this.userGpsLat = userLat;
          this.userGpsLng = userLng;
          this.setUserLocationOnMap([userLat, userLng], shopCenter, true);
        },
        (err) => {
          console.warn('Geolocation error or denied:', err);
          const cachedLat = localStorage.getItem('user_gps_lat');
          const cachedLng = localStorage.getItem('user_gps_lng');
          if (cachedLat && cachedLng) {
            this.setUserLocationOnMap([parseFloat(cachedLat), parseFloat(cachedLng)], shopCenter, true);
          } else {
            const fallbackUserPos = [shopCenter[0] + 0.005, shopCenter[1] + 0.005];
            this.setUserLocationOnMap(fallbackUserPos, shopCenter, false);
            if (distSpan) {
              distSpan.innerHTML = `⚠️ Toca en el mapa tu ubicación exacta`;
            }
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      const fallbackUserPos = [shopCenter[0] + 0.005, shopCenter[1] + 0.005];
      this.setUserLocationOnMap(fallbackUserPos, shopCenter, false);
    }
  }

  setUserLocationOnMap(userPos, shopCenter, isRealGps, sectorName = null) {
    const lat = userPos[0];
    const lng = userPos[1];

    this.selectedLatitude = lat;
    this.selectedLongitude = lng;

    const latInp = document.getElementById('order-lat');
    if (latInp) latInp.value = lat;
    const lngInp = document.getElementById('order-lng');
    if (lngInp) lngInp.value = lng;

    const coordsSpan = document.getElementById('map-pin-coords');
    if (coordsSpan) {
      coordsSpan.innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

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
      const labelPrefix = sectorName ? `📍 ${sectorName}: ` : (isRealGps ? `📍 GPS: ` : `📍 `);
      distSpan.innerText = `${labelPrefix}${this.calculatedDistanceKm} km`;
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

  openCancelRequestModal(orderId) {
    const targetOrderId = orderId || localStorage.getItem('active_order_id');
    if (!targetOrderId) return;

    let userOrders = this.getUserOrdersHistory();
    let order = userOrders.find(o => String(o.id) === String(targetOrderId));

    // Try fetching fresh order from server if possible
    fetch('/api/orders')
      .then(res => res.json())
      .then(orders => {
        const fresh = orders.find(o => String(o.id) === String(targetOrderId));
        if (fresh) order = fresh;
        this.renderCancelRequestModalContent(targetOrderId, order);
      })
      .catch(() => {
        this.renderCancelRequestModalContent(targetOrderId, order);
      });
  }

  renderCancelRequestModalContent(orderId, order) {
    const modal = document.getElementById('order-cancel-request-modal');
    if (!modal) return;

    this.pendingCancelOrderId = orderId;
    this.pendingCancelOrderObj = order;

    const status = order ? (order.status || 'Pendiente') : 'Pendiente';
    if (status === 'Entregado') {
      alert('✅ Este pedido ya fue entregado con éxito.');
      return;
    }
    if (status === 'Cancelado') {
      alert('❌ Este pedido ya se encuentra cancelado.');
      return;
    }

    const estName = order ? (order.establishmentName || order.restaurant_name || 'Restaurante') : 'Restaurante';
    const codeStr = String(orderId).slice(-6).toUpperCase();
    const totalVal = order ? (order.total || order.unit_total_calculated || 0) : 0;
    const totalStr = this.formatPesos(this.normalizeCopPrice(totalVal));

    const summaryBox = document.getElementById('cancel-order-summary-box');
    if (summaryBox) {
      summaryBox.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 13.5px; font-weight: 900; color: #FFF;">📦 Pedido #${codeStr}</span>
          <span style="font-size: 11px; font-weight: 800; background: rgba(245, 158, 11, 0.2); color: #FCD34D; border: 1px solid #F59E0B; padding: 2px 7px; border-radius: 6px;">
            ${status}
          </span>
        </div>
        <div style="font-size: 12px; color: #94A3B8; line-height: 1.5;">
          🏪 <strong>Restaurante:</strong> <span style="color: #FFF;">${estName}</span><br>
          💵 <strong>Total:</strong> <span style="color: var(--primary); font-weight: 800;">${totalStr}</span>
        </div>
      `;
    }

    // Reset input and chips
    const reasonInput = document.getElementById('cancel-request-reason-input');
    if (reasonInput) reasonInput.value = '';

    document.querySelectorAll('.btn-cancel-chip').forEach(btn => {
      btn.style.background = 'rgba(255,255,255,0.06)';
      btn.style.borderColor = 'rgba(255,255,255,0.12)';
      btn.style.color = '#E2E8F0';
    });

    modal.classList.add('open');
    modal.style.setProperty('display', 'flex', 'important');
  }

  closeCancelRequestModal() {
    const modal = document.getElementById('order-cancel-request-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.style.setProperty('display', 'none', 'important');
    }
    this.pendingCancelOrderId = null;
    this.pendingCancelOrderObj = null;
  }

  selectCancelReason(reasonText) {
    const reasonInput = document.getElementById('cancel-request-reason-input');
    if (reasonInput) reasonInput.value = reasonText;

    document.querySelectorAll('.btn-cancel-chip').forEach(btn => {
      if (btn.innerText.includes(reasonText)) {
        btn.style.background = 'rgba(245, 158, 11, 0.25)';
        btn.style.borderColor = '#F59E0B';
        btn.style.color = '#FCD34D';
      } else {
        btn.style.background = 'rgba(255,255,255,0.06)';
        btn.style.borderColor = 'rgba(255,255,255,0.12)';
        btn.style.color = '#E2E8F0';
      }
    });
  }

  sendCancellationToWhatsAppSupport() {
    const orderId = this.pendingCancelOrderId || localStorage.getItem('active_order_id');
    const order = this.pendingCancelOrderObj;
    const reasonInput = document.getElementById('cancel-request-reason-input');
    const reason = (reasonInput && reasonInput.value.trim()) ? reasonInput.value.trim() : 'Solicitud directa del cliente';

    const estName = order ? (order.establishmentName || order.restaurant_name || 'Restaurante') : 'Restaurante';
    const codeStr = orderId ? String(orderId).slice(-6).toUpperCase() : 'N/A';
    const statusStr = order ? (order.status || 'Pendiente') : 'Pendiente';
    const custName = order ? (order.deliveryDetails?.name || order.customerName || 'Cliente') : 'Cliente';
    const totalVal = order ? (order.total || order.unit_total_calculated || 0) : 0;
    const totalStr = this.formatPesos(this.normalizeCopPrice(totalVal));

    const message = `¡Hola *${estName}*! 👋 Saludos de Central PediGochos.\n\n` +
      `El cliente solicita la *CANCELACIÓN* de su pedido:\n\n` +
      `📦 *Pedido:* #${codeStr}\n` +
      `👤 *Cliente:* ${custName}\n` +
      `💵 *Monto:* ${totalStr}\n` +
      `📊 *Estado en sistema:* ${statusStr}\n` +
      `📝 *Motivo del cliente:* ${reason}\n\n` +
      `¿Por favor nos confirman si en cocina aún *NO* han preparado este pedido o si ya es muy tarde para cancelarlo? 🙏`;

    const supportPhone = '573227949751';
    const waUrl = `https://wa.me/${supportPhone}?text=${encodeURIComponent(message)}`;

    window.open(waUrl, '_blank');

    this.closeCancelRequestModal();
    this.showToast('💬 Mensaje listo para enviar a Soporte PediGochos.');
  }

  async copyCancellationMessage() {
    const orderId = this.pendingCancelOrderId || localStorage.getItem('active_order_id');
    const order = this.pendingCancelOrderObj;
    const reasonInput = document.getElementById('cancel-request-reason-input');
    const reason = (reasonInput && reasonInput.value.trim()) ? reasonInput.value.trim() : 'Solicitud directa del cliente';

    const estName = order ? (order.establishmentName || order.restaurant_name || 'Restaurante') : 'Restaurante';
    const codeStr = orderId ? String(orderId).slice(-6).toUpperCase() : 'N/A';
    const statusStr = order ? (order.status || 'Pendiente') : 'Pendiente';
    const custName = order ? (order.deliveryDetails?.name || order.customerName || 'Cliente') : 'Cliente';
    const totalVal = order ? (order.total || order.unit_total_calculated || 0) : 0;
    const totalStr = this.formatPesos(this.normalizeCopPrice(totalVal));

    const message = `¡Hola *${estName}*! 👋 Saludos de Central PediGochos.\n\n` +
      `El cliente solicita la *CANCELACIÓN* de su pedido:\n\n` +
      `📦 *Pedido:* #${codeStr}\n` +
      `👤 *Cliente:* ${custName}\n` +
      `💵 *Monto:* ${totalStr}\n` +
      `📊 *Estado en sistema:* ${statusStr}\n` +
      `📝 *Motivo del cliente:* ${reason}\n\n` +
      `¿Por favor nos confirman si en cocina aún *NO* han preparado este pedido o si ya es muy tarde para cancelarlo? 🙏`;

    try {
      await navigator.clipboard.writeText(message);
      this.showToast('📋 ¡Mensaje para el restaurante copiado al portapapeles!');
    } catch(err) {
      this.showToast('📋 Mensaje preparado');
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

  // Customer Table Selector (Mesa)
  renderCustomerTableMap() {
    const container = document.getElementById('customer-table-layout-container');
    const badge = document.getElementById('customer-selected-table-badge');
    const input = document.getElementById('order-table-number');
    if (!container) return;

    if (input && !input.value && this.currentTableNumber) {
      input.value = this.currentTableNumber;
    }

    // If table is locked by QR scan, show dedicated fixed table display and lock input
    if (this.tableLockedByQR && this.currentTableNumber) {
      container.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.12); border: 1.5px solid #10B981; border-radius: 14px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 26px;">🪑</span>
            <div>
              <div style="font-size: 15px; font-weight: 900; color: #FFF;">Mesa #${this.currentTableNumber}</div>
              <div style="font-size: 11px; color: #6EE7B7; font-weight: 700;">🔒 Mesa Fija Asignada por Código QR</div>
            </div>
          </div>
          <span style="background: #10B981; color: #121216; font-size: 11px; font-weight: 900; padding: 3px 8px; border-radius: 6px;">Fijo por QR</span>
        </div>
      `;
      if (input) {
        input.value = this.currentTableNumber;
        input.readOnly = true;
        input.style.background = 'rgba(255,255,255,0.05)';
        input.style.color = '#10B981';
        input.style.cursor = 'not-allowed';
      }
      if (badge) {
        badge.innerText = `🔒 Mesa #${this.currentTableNumber} fijada por escaneo de Código QR`;
        badge.style.display = 'block';
      }
      return;
    }

    const shopId = this.cart.items[0]?.restaurant_id || (this.selectedEstablishment ? this.selectedEstablishment.id : null);
    const est = (this.establishments || []).find(e => e.id === shopId) || this.selectedEstablishment;
    let tables = (est && Array.isArray(est.tables) && est.tables.length > 0) ? est.tables : [];
    
    if (tables.length === 0) {
      if (est && Array.isArray(est.layout) && est.layout.length > 0) {
        tables = est.layout.filter(i => i.type === 'table').map(i => ({ id: `t-${i.number}`, name: `Mesa ${i.number}`, number: i.number }));
      } else {
        tables = [1, 2, 3, 4, 5, 6].map(n => ({ id: `t-${n}`, name: `Mesa ${n}`, number: n }));
      }
    }

    // Ensure scanned table is present in the list
    if (this.currentTableNumber && !tables.some(t => String(t.number) === String(this.currentTableNumber) || t.name === `Mesa ${this.currentTableNumber}`)) {
      tables = [{ id: `t-${this.currentTableNumber}`, name: isNaN(this.currentTableNumber) ? this.currentTableNumber : `Mesa ${this.currentTableNumber}`, number: this.currentTableNumber }, ...tables];
    }

    container.innerHTML = '';

    const currentVal = input ? String(input.value || this.currentTableNumber || '').trim() : String(this.currentTableNumber || '').trim();

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display: flex; flex-direction: column; gap: 8px; width: 100%;';
    
    const title = document.createElement('div');
    title.style.cssText = 'font-size: 12px; color: #94A3B8; font-weight: 700; display: flex; align-items: center; justify-content: space-between;';
    title.innerHTML = '<span>Mesa donde te encuentras sentado:</span> <span style="font-size: 10.5px; color: #10B981;">🟢 Mesas Disponibles</span>';
    wrapper.appendChild(title);

    const chipsGrid = document.createElement('div');
    chipsGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; width: 100%;';

    tables.forEach((table, idx) => {
      const tNum = table.number || (idx + 1);
      const tName = table.name || `Mesa ${tNum}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      const isSelected = String(currentVal).toLowerCase() === String(tNum).toLowerCase() || String(currentVal).toLowerCase() === String(tName).toLowerCase();
      btn.style.cssText = `
        padding: 10px 6px;
        border-radius: 10px;
        border: 1.5px solid ${isSelected ? '#10B981' : 'rgba(255,255,255,0.12)'};
        background: ${isSelected ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)' : 'rgba(255,255,255,0.05)'};
        color: ${isSelected ? '#ffffff' : '#FCD34D'};
        font-weight: 800;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        box-shadow: ${isSelected ? '0 0 12px rgba(16, 185, 129, 0.4)' : 'none'};
        transition: all 0.2s ease;
      `;
      btn.innerHTML = `<span>🪑</span> <span>${tName}</span>`;
      btn.onclick = () => {
        if (input) input.value = tNum;
        this.currentTableNumber = tNum;
        if (badge) {
          badge.innerText = `✅ ${tName} Seleccionada para tu Pedido`;
          badge.style.display = 'block';
        }
        this.renderCustomerTableMap();
      };
      chipsGrid.appendChild(btn);
    });

    wrapper.appendChild(chipsGrid);
    container.appendChild(wrapper);

    if (currentVal && badge) {
      badge.innerText = `✅ Mesa #${currentVal} Seleccionada para tu Pedido`;
      badge.style.display = 'block';
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
        <button type="button" onclick="MarketplaceApp.openCancelRequestModal('${ord.id}')" style="background: rgba(245, 158, 11, 0.15); color: #FCD34D; border: 1px solid rgba(245, 158, 11, 0.3); padding: 6px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">
          🆘 Solicitar Cancelación
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

        ${isCardActive ? `
          <div style="background: rgba(16, 185, 129, 0.08); border: 1px dashed #10B981; border-radius: 10px; padding: 8px 12px; font-size: 12px; color: #6EE7B7; display: flex; align-items: center; gap: 8px; font-weight: 600;">
            <span style="font-size: 16px;">📞</span>
            <span>El restaurante se pondrá en contacto contigo en unos minutos para confirmar los detalles.</span>
          </div>
        ` : ''}

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
          customerName: 'Cliente Pedi Gochos'
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

  openMerchantRegistrationModal() {
    const modal = document.getElementById('merchant-register-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
  }

  closeMerchantRegistrationModal() {
    const modal = document.getElementById('merchant-register-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  }

  sendMerchantRegistrationWhatsApp() {
    const nameInput = document.getElementById('reg-merchant-name');
    const locInput = document.getElementById('reg-merchant-location');
    const catInput = document.getElementById('reg-merchant-category');
    const phoneInput = document.getElementById('reg-merchant-phone');

    const name = nameInput ? nameInput.value.trim() : '';
    const location = locInput ? locInput.value.trim() : '';
    const category = catInput ? catInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';

    if (!name || !location || !phone) {
      this.showToast('⚠️ Por favor completa los campos obligatorios.');
      return;
    }

    const message = 
      `👋 *¡Hola PediGochos! Quiero Inscribir mi Restaurante GRATIS* 🏪🚀\n\n` +
      `🏢 *Nombre del Negocio:* ${name}\n` +
      `📍 *Ubicación / Ciudad:* ${location}\n` +
      `🍔 *Tipo de Comida / Categoría:* ${category || 'Restaurante / Comidas'}\n` +
      `📱 *WhatsApp de Contacto:* ${phone}\n\n` +
      `¿Podrían indicarme los pasos para registrar nuestro menú y activar nuestro código QR y catálogo virtual? 🙏✨`;

    const supportPhone = '573227949751';
    const waUrl = `https://wa.me/${supportPhone}?text=${encodeURIComponent(message)}`;

    window.open(waUrl, '_blank');
    this.closeMerchantRegistrationModal();
    this.showToast('✅ Solicitud lista para enviar por WhatsApp');
  }

  getAppOfficialUrl() {
    let origin = window.location.origin;
    if (!origin || origin === 'null' || origin.includes('file://') || origin.includes('localhost')) {
      return 'https://pedigochos.onrender.com';
    }
    return origin;
  }

  renderAppOfficialQr() {
    const url = this.getAppOfficialUrl();
    
    // 1. Update text label in modal
    const urlTextEl = document.getElementById('app-official-url-text');
    if (urlTextEl) {
      urlTextEl.textContent = url;
    }

    // 2. Render Mini QR on Home Banner
    const miniContainer = document.getElementById('home-mini-qr');
    if (miniContainer) {
      miniContainer.innerHTML = '';
      if (typeof QRCode !== 'undefined') {
        try {
          new QRCode(miniContainer, {
            text: url,
            width: 44,
            height: 44,
            colorDark: '#0F172A',
            colorLight: '#FFFFFF',
            correctLevel: QRCode.CorrectLevel.M
          });
        } catch(e) {
          miniContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=44x44&data=${encodeURIComponent(url)}" style="width: 40px; height: 40px; border-radius: 6px;">`;
        }
      } else {
        miniContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=44x44&data=${encodeURIComponent(url)}" style="width: 40px; height: 40px; border-radius: 6px;">`;
      }
    }
  }

  openAppQrModal() {
    const modal = document.getElementById('app-qr-modal');
    if (!modal) return;

    const url = this.getAppOfficialUrl();
    const qrContainer = document.getElementById('app-official-qr-container');
    if (qrContainer) {
      qrContainer.innerHTML = '';
      if (typeof QRCode !== 'undefined') {
        try {
          new QRCode(qrContainer, {
            text: url,
            width: 220,
            height: 220,
            colorDark: '#0F172A',
            colorLight: '#FFFFFF',
            correctLevel: QRCode.CorrectLevel.H
          });
        } catch(e) {
          qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}" style="width: 200px; height: 200px; border-radius: 12px;">`;
        }
      } else {
        qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}" style="width: 200px; height: 200px; border-radius: 12px;">`;
      }
    }

    const urlTextEl = document.getElementById('app-official-url-text');
    if (urlTextEl) urlTextEl.textContent = url;

    modal.style.display = 'flex';
    modal.classList.add('open');
    modal.classList.add('active');

    try {
      window.history.pushState({ view: 'modal', modalId: 'app-qr-modal' }, '');
    } catch(e) {}
  }

  closeAppQrModal() {
    const modal = document.getElementById('app-qr-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('open');
      modal.classList.remove('active');
    }
  }

  copyAppOfficialLink() {
    const url = this.getAppOfficialUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        this.showToast('📋 ¡Enlace oficial de PediGochos copiado!');
      }).catch(() => {
        this.fallbackCopyText(url);
      });
    } else {
      this.fallbackCopyText(url);
    }
  }

  fallbackCopyText(text) {
    const inp = document.createElement('input');
    inp.value = text;
    document.body.appendChild(inp);
    inp.select();
    try {
      document.execCommand('copy');
      this.showToast('📋 ¡Enlace oficial copiado al portapapeles!');
    } catch(e) {
      prompt('Copia el siguiente enlace:', text);
    }
    document.body.removeChild(inp);
  }

  shareAppOnWhatsApp() {
    const url = this.getAppOfficialUrl();
    const message = 
      `🍔 *¡Pide tu comida favorita en PediGochos!* 🛵💨\n\n` +
      `Explora los mejores restaurantes, catálogos digitales interactivos y pide a domicilio o a tu mesa desde cualquier celular:\n\n` +
      `👉 ${url}\n\n` +
      `¡Pide fácil, rápido y seguro con PediGochos! ✨`;

    const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank');
  }

  downloadAppQrImage() {
    const url = this.getAppOfficialUrl();
    const canvas = document.createElement('canvas');
    const width = 800;
    const height = 1050;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Background Gradient Dark Premium
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#0F172A');
    bgGrad.addColorStop(1, '#020617');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Orange Neon Top Border
    const topGrad = ctx.createLinearGradient(0, 0, width, 0);
    topGrad.addColorStop(0, '#FF5E3A');
    topGrad.addColorStop(0.5, '#EA580C');
    topGrad.addColorStop(1, '#F59E0B');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, width, 14);

    // Header Logo & Branding
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 54px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PediGochos', width / 2, 90);

    ctx.fillStyle = '#10B981';
    ctx.font = '800 20px system-ui, -apple-system, sans-serif';
    ctx.fillText('🛵 DELIVERY & RESTAURANTES A DOMICILIO', width / 2, 130);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 24px system-ui, -apple-system, sans-serif';
    ctx.fillText('Escanea con tu cámara para pedir comida', width / 2, 180);

    // White Rounded Card for QR Code
    const cardX = 130;
    const cardY = 220;
    const cardW = 540;
    const cardH = 540;
    const radius = 32;

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, radius);
    ctx.fill();

    // Helper to draw QR on canvas
    const drawQRAndSave = (qrDrawable) => {
      const qrPadding = 30;
      ctx.drawImage(qrDrawable, cardX + qrPadding, cardY + qrPadding, cardW - (qrPadding * 2), cardH - (qrPadding * 2));

      // Bottom Footer Card
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.roundRect(100, 800, 600, 110, 20);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 94, 58, 0.4)';
      ctx.stroke();

      ctx.fillStyle = '#F59E0B';
      ctx.font = '800 22px system-ui, -apple-system, sans-serif';
      ctx.fillText('⭐ PIDE DIRECTO EN LÍNEA ⭐', width / 2, 842);

      ctx.fillStyle = '#38BDF8';
      ctx.font = '700 20px monospace';
      ctx.fillText(url, width / 2, 882);

      // Subtitle footer
      ctx.fillStyle = '#64748B';
      ctx.font = '600 16px system-ui, -apple-system, sans-serif';
      ctx.fillText('San Antonio del Táchira • Ureña • La Frontera', width / 2, 970);

      // Trigger Download
      const link = document.createElement('a');
      link.download = 'pedigochos-qr-oficial.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      this.showToast('📥 ¡Código QR Oficial descargado con éxito!');
    };

    // Try finding rendered canvas or generate from QR image
    const modalQrCanvas = document.querySelector('#app-official-qr-container canvas');
    if (modalQrCanvas) {
      drawQRAndSave(modalQrCanvas);
    } else {
      const qrImg = new Image();
      qrImg.crossOrigin = 'anonymous';
      qrImg.onload = () => drawQRAndSave(qrImg);
      qrImg.onerror = () => {
        this.showToast('⚠️ No se pudo descargar la imagen, intenta de nuevo.');
      };
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(url)}&color=0F172A&bgcolor=FFFFFF&margin=1`;
    }
  }
}

const MarketplaceApp = new MarketplaceController();
window.MarketplaceApp = MarketplaceApp;

document.addEventListener('DOMContentLoaded', () => {
  MarketplaceApp.init();
});
