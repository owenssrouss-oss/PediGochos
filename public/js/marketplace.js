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
  ferreterias: '/images/destornilladores.jpg' // Falls back gracefully
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
  }

  async init() {
    // Set initial history state
    window.history.replaceState({ view: 'home' }, '');
    window.addEventListener('popstate', (e) => this.handlePopState(e));

    await this.loadEstablishments();
    
    // Update active location display in header on startup
    const display = document.getElementById('active-location-display');
    if (display) display.innerText = this.currentLocation;

    this.selectCategory('comidas');
    this.updateCartBadge();
    await this.checkSupabaseSession();

    // Check if query parameter ?shop=... is provided and auto-open establishment
    const urlParams = new URLSearchParams(window.location.search);
    const shopId = urlParams.get('shop');
    if (shopId) {
      setTimeout(() => {
        this.openEstablishment(shopId);
      }, 500);
    }

    // Show location selector tutorial if visiting for the first time
    if (!localStorage.getItem('location_tutorial_seen')) {
      setTimeout(() => {
        this.showLocationTutorial();
      }, 1000);
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

  // Load from database
  async loadEstablishments() {
    try {
      const res = await fetch('/api/establishments');
      this.establishments = await res.json();
    } catch (e) {
      console.error('Error fetching establishments:', e);
      this.showToast('Error de conexión al cargar comercios');
    }
  }

  // Navigation
  selectCategory(category) {
    this.currentCategory = category;
    
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

  goHome(pushState = true) {
    this.selectedEstablishment = null;
    document.getElementById('establishment-view').classList.remove('active');
    document.getElementById('home-view').classList.add('active');
    
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
    if (est.bannerType === 'gradient' || !est.banner) {
      bannerDiv.style.background = est.banner || 'linear-gradient(135deg, #1F2937, #111827)';
    } else {
      bannerDiv.style.background = `linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url('${est.banner}')`;
      bannerDiv.style.backgroundSize = 'cover';
      bannerDiv.style.backgroundPosition = 'center';
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
      deliverySpan.innerText = est.delivery_time ? `⏱️ ${est.delivery_time} min` : '⏱️ 20-30 min';
    }

    // Render internal categories and products
    this.renderInternalCategories(est);
    this.renderProducts(est.products);

    // Switch views
    document.getElementById('home-view').classList.remove('active');
    document.getElementById('establishment-view').classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Render lists
  renderEstablishments(filtered = null) {
    const list = filtered || this.establishments.filter(e => e.category === this.currentCategory && (e.location === this.currentLocation || !e.location));
    const grid = document.getElementById('establishments-grid');
    grid.innerHTML = '';

    let displayTitle = '';
    if (filtered) {
      displayTitle = 'Resultados de la búsqueda';
    } else {
      if (this.currentCategory === 'comidas') {
        displayTitle = 'Restaurantes';
      } else {
        displayTitle = this.capitalize(this.currentCategory);
      }
    }
    document.getElementById('establishments-title').innerText = displayTitle;

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
      card.onclick = () => this.openEstablishment(est.id);

      // Determine representation photo
      let imgUrl = DEFAULT_IMAGES[est.category] || '/images/burger_royale.jpg';
      if (est.products && est.products.length > 0 && est.products[0].image) {
        imgUrl = est.products[0].image;
      }

      card.innerHTML = `
        <div class="est-row-img-wrapper">
          <img src="${imgUrl}" alt="${est.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
          <div class="est-row-img-placeholder hidden">${est.logo || '🏪'}</div>
        </div>
        <div class="est-row-info">
          <div class="est-row-header-flex">
            <h4>${est.name}</h4>
            <div class="est-row-rating">
              <span class="star">★</span> 4.8
            </div>
          </div>
          <div class="est-row-tags">
            ${this.capitalize(est.category)} • ${est.description.split('.')[0] || est.description} • $$
          </div>
          <div class="est-row-details-row">
            <span>🕒 15-25 min</span>
            <span class="free-delivery">🚲 Envío Gratis</span>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
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

      const catImg = rawCategories[cat] || DEFAULT_IMAGES[est.category];
      catBtn.innerHTML = `
        <div class="internal-category-img">
          <img src="${catImg}" alt="${cat}">
        </div>
        <span>${cat}</span>
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
      card.onclick = () => MarketplaceApp.openCustomizerModalById(prod.id);

      // Check if image exists, otherwise use category fallback or emoji
      let imgHTML = '';
      if (prod.image) {
        imgHTML = `<img src="${prod.image}" alt="${prod.name}" class="product-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
                   <div class="product-image-placeholder hidden">${this.selectedEstablishment.logo}</div>`;
      } else {
        imgHTML = `<div class="product-image-placeholder">${this.selectedEstablishment.logo}</div>`;
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
    if (!this.selectedEstablishment) return;
    const product = this.selectedEstablishment.products.find(p => p.id === productId);
    if (product) {
      this.openCustomizerModal(product);
    }
  }

  // Cart Management
  addToCart(productId) {
    if (!this.selectedEstablishment) return;

    const product = this.selectedEstablishment.products.find(p => p.id === productId);
    if (!product) return;

    // Check if has modifiers or exclusions (force customizer if so, e.g. drink sizes or pizza options)
    const hasModifiers = product.modifiers && product.modifiers.length > 0;
    const hasExclusions = product.exclusions && product.exclusions.length > 0;

    if (hasModifiers || hasExclusions) {
      this.openCustomizerModal(product);
    } else {
      this.addDirectToCart(product);
    }
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
      existing.subtotal_combined = existing.quantity * existing.unit_total_calculated;
    } else {
      this.cart.items.push(cartItem);
    }

    this.updateCartBadge();
    this.showToast(`Agregado: ${product.name}`);
    this.animateFlyToCart(window.event);
  }

  openCustomizerModal(product) {
    this.customizerState = {
      product: product,
      quantity: 1,
      pizzaMode: 'whole', // 'whole' or 'halves'
      quantities: {
        whole: {}, // { 'base_Cebolla': 1, 'opt_opt-id': 0 }
        halfA: {},
        halfB: {}
      }
    };

    // Helper to initialize side quantities
    const initSide = (sideKey) => {
      // 1. Initialize base ingredients to 1
      if (product.exclusions) {
        product.exclusions.forEach(item => {
          const itemName = item.name || item;
          this.customizerState.quantities[sideKey]['base_' + itemName] = 1;
        });
      }

      // 2. Initialize modifier options
      if (product.modifiers) {
        product.modifiers.forEach(group => {
          if (group.selection_type === 'single') {
            // Find first option, set to 1, others to 0
            group.options.forEach((opt, idx) => {
              this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = (idx === 0) ? 1 : 0;
            });
          } else {
            // Multiple selections start at 0
            group.options.forEach(opt => {
              this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = 0;
            });
          }
        });
      }
    };

    initSide('whole');
    initSide('halfA');
    initSide('halfB');

    // UI setup
    document.getElementById('customizer-product-name').innerText = product.name;
    document.getElementById('customizer-product-desc').innerText = product.description || '';
    
    const ingredientsEl = document.getElementById('customizer-product-ingredients');
    if (ingredientsEl) {
      if (product.ingredients && product.ingredients.length > 0) {
        ingredientsEl.innerText = `📝 Ingredientes: ${product.ingredients.join(', ')}`;
        ingredientsEl.style.display = 'block';
      } else if (product.exclusions && product.exclusions.length > 0) {
        ingredientsEl.innerText = `📝 Ingredientes: ${product.exclusions.map(e => e.name).join(', ')}`;
        ingredientsEl.style.display = 'block';
      } else {
        ingredientsEl.style.display = 'none';
      }
    }
    
    document.getElementById('customizer-base-price').innerText = this.formatPesos(product.price);
    document.getElementById('customizer-quantity-display').innerText = '1';
    document.getElementById('customizer-special-notes').value = '';

    // Handle image
    const imgWrapper = document.getElementById('customizer-product-img-wrapper');
    if (product.image) {
      imgWrapper.innerHTML = `<img src="${product.image}" alt="${product.name}">`;
    } else {
      imgWrapper.innerHTML = this.selectedEstablishment.logo || '🍔';
    }

    // Reset columns view
    document.getElementById('customizer-col-b').classList.add('hidden');
    document.getElementById('col-a-header').classList.add('hidden');
    
    // Pizza check
    const isPizza = product.category === 'Pizzas' || product.name.toLowerCase().includes('pizza');
    const pizzaSection = document.getElementById('pizza-halves-section');
    if (isPizza) {
      pizzaSection.classList.remove('hidden');
      document.getElementById('pizza-whole-btn').classList.add('active');
      document.getElementById('pizza-halves-btn').classList.remove('active');
    } else {
      pizzaSection.classList.add('hidden');
    }

    this.renderCustomizerModifiers();

    // Show modal
    document.getElementById('customizer-modal').classList.add('open');
    window.history.pushState({ view: 'modal', modalId: 'customizer-modal' }, '');
  }

  renderCustomizerModifiers() {
    const product = this.customizerState.product;
    const isHalves = this.customizerState.pizzaMode === 'halves';
    
    // Col A (Whole / Mitad A)
    const containerA = document.getElementById('modifiers-groups-a');
    containerA.innerHTML = '';
    
    const sideKeyA = isHalves ? 'halfA' : 'whole';
    const labelSuffixA = isHalves ? 'A' : '';
    
    this.renderUnifiedList(containerA, sideKeyA, labelSuffixA);

    // Col B (Mitad B) if halves
    const containerB = document.getElementById('modifiers-groups-b');
    containerB.innerHTML = '';

    if (isHalves) {
      document.getElementById('customizer-col-b').classList.remove('hidden');
      document.getElementById('col-a-header').classList.remove('hidden');
      document.getElementById('col-a-header').innerText = 'Mitad A';
      
      this.renderUnifiedList(containerB, 'halfB', 'B');
    } else {
      document.getElementById('customizer-col-b').classList.add('hidden');
      document.getElementById('col-a-header').classList.add('hidden');
    }

    this.updateCustomizerPrice();
  }

  renderUnifiedList(container, sideKey, labelSuffix) {
    const product = this.customizerState.product;
    const sideLabel = labelSuffix ? ` (Mitad ${labelSuffix})` : '';

    // Group 1: Required / Single Selections (like bread type)
    if (product.modifiers) {
      product.modifiers.forEach(group => {
        if (group.selection_type === 'single') {
          const groupDiv = document.createElement('div');
          groupDiv.className = 'modifier-group';
          groupDiv.innerHTML = `
            <div class="modifier-group-title">
              <span>${group.group_name}${sideLabel}</span>
              <span class="required-badge">Requerido</span>
            </div>
            <div class="modifier-options-list"></div>
          `;
          const list = groupDiv.querySelector('.modifier-options-list');
          
          group.options.forEach(opt => {
            const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
            const extraPriceText = opt.extra_price > 0 ? `+ ${this.formatPesos(opt.extra_price)}` : '';
            
            const optionDiv = document.createElement('div');
            optionDiv.className = `modifier-option ${qty === 1 ? 'option-single-active' : ''}`;
            
            optionDiv.innerHTML = `
              <div class="option-label-container" onclick="MarketplaceApp.setSingleSelection('${group.group_id}', '${opt.option_id}', '${sideKey}')">
                <input type="radio" name="radio_${group.group_id}_${sideKey}" ${qty === 1 ? 'checked' : ''} style="margin: 0;">
                <span class="option-name" style="margin-left: 8px;">${opt.name}</span>
              </div>
              <div style="display: flex; align-items: center;">
                <span class="option-extra-price">${extraPriceText}</span>
              </div>
            `;
            list.appendChild(optionDiv);
          });
          container.appendChild(groupDiv);
        }
      });
    }

    // Group 2: Base Ingredients (excluyibles/additions to customizer)
    if (product.exclusions && product.exclusions.length > 0) {
      const groupDiv = document.createElement('div');
      groupDiv.className = 'modifier-group';
      groupDiv.innerHTML = `
        <div class="modifier-group-title">
          <span>Ingredientes Base (Quitar / Añadir Extra)${sideLabel}</span>
        </div>
        <div class="modifier-options-list"></div>
      `;
      const list = groupDiv.querySelector('.modifier-options-list');

      product.exclusions.forEach(item => {
        const itemName = item.name || item;
        const qty = this.customizerState.quantities[sideKey]['base_' + itemName] || 0;
        
        const optionDiv = document.createElement('div');
        let stateClass = '';
        let extraText = '';
        if (qty === 0) {
          stateClass = 'ingredient-excluded';
          extraText = '<span style="font-size: 11px; font-weight: 700; color: #EF4444; margin-right: 8px;">Removido</span>';
        } else if (qty > 1) {
          stateClass = 'ingredient-extra';
          extraText = `<span style="font-size: 11px; font-weight: 700; color: var(--primary); margin-right: 8px;">+ ${this.formatPesos(500 * (qty - 1))} (Extra)</span>`;
        }

        optionDiv.className = `modifier-option ${stateClass}`;
        optionDiv.innerHTML = `
          <div class="option-label-container">
            <span class="option-name">${itemName}</span>
          </div>
          <div style="display: flex; align-items: center;">
            ${extraText}
            <div class="option-qty-control">
              <button class="btn-qty-mini" onclick="event.preventDefault(); MarketplaceApp.updateUnifiedQty('base_${itemName}', '${sideKey}', -1)">-</button>
              <span class="option-qty-val">${qty}</span>
              <button class="btn-qty-mini" onclick="event.preventDefault(); MarketplaceApp.updateUnifiedQty('base_${itemName}', '${sideKey}', 1)">+</button>
            </div>
          </div>
        `;
        list.appendChild(optionDiv);
      });
      container.appendChild(groupDiv);
    }

    // Group 3: Optional Additional Ingredients
    if (product.modifiers) {
      product.modifiers.forEach(group => {
        if (group.selection_type === 'multiple') {
          const groupDiv = document.createElement('div');
          groupDiv.className = 'modifier-group';
          groupDiv.innerHTML = `
            <div class="modifier-group-title">
              <span>${group.group_name}${sideLabel}</span>
            </div>
            <div class="modifier-options-list"></div>
          `;
          const list = groupDiv.querySelector('.modifier-options-list');

          group.options.forEach(opt => {
            const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
            const extraPriceText = opt.extra_price > 0 ? `+ ${this.formatPesos(opt.extra_price)}` : '';
            
            const optionDiv = document.createElement('div');
            let stateClass = '';
            if (qty > 0) {
              stateClass = 'ingredient-extra';
            }

            optionDiv.className = `modifier-option ${stateClass}`;
            optionDiv.innerHTML = `
              <div class="option-label-container" onclick="MarketplaceApp.toggleMultipleSelection('${opt.option_id}', '${sideKey}')">
                <input type="checkbox" ${qty > 0 ? 'checked' : ''} style="margin: 0;">
                <span class="option-name" style="margin-left: 8px;">${opt.name}</span>
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
            list.appendChild(optionDiv);
          });
          container.appendChild(groupDiv);
        }
      });
    }
  }

  setSingleSelection(groupId, optionId, sideKey) {
    const product = this.customizerState.product;
    const group = product.modifiers.find(g => g.group_id === groupId);
    if (group) {
      group.options.forEach(opt => {
        this.customizerState.quantities[sideKey]['opt_' + opt.option_id] = (opt.option_id === optionId) ? 1 : 0;
      });
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
      
      this.customizerState.quantities.halfA = {};
      this.customizerState.quantities.halfB = {};
    } else {
      wholeBtn.classList.remove('active');
      halvesBtn.classList.add('active');
      
      this.customizerState.quantities.halfA = JSON.parse(JSON.stringify(this.customizerState.quantities.whole));
      this.customizerState.quantities.halfB = JSON.parse(JSON.stringify(this.customizerState.quantities.whole));
    }
    
    this.renderCustomizerModifiers();
  }

  validateRequiredModifiers() {
    const product = this.customizerState.product;
    if (!product.modifiers) return true;
    
    const isHalves = this.customizerState.pizzaMode === 'halves';
    let allValid = true;
    
    const checkSide = (sideKey) => {
      product.modifiers.forEach(group => {
        if (group.is_required && group.selection_type === 'single') {
          const active = group.options.some(opt => this.customizerState.quantities[sideKey]['opt_' + opt.option_id] === 1);
          if (!active) allValid = false;
        }
      });
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
    const product = this.customizerState.product;
    const isHalves = this.customizerState.pizzaMode === 'halves';
    
    const sumForSide = (sideKey) => {
      let sideSum = 0;
      
      // 1. Base Ingredients: if quantity > 1, charge $500 per extra portion
      if (product.exclusions) {
        product.exclusions.forEach(item => {
          const itemName = item.name || item;
          const qty = this.customizerState.quantities[sideKey]['base_' + itemName] || 0;
          if (qty > 1) {
            sideSum += (qty - 1) * 500;
          }
        });
      }
      
      // 2. Modifiers
      if (product.modifiers) {
        product.modifiers.forEach(group => {
          group.options.forEach(opt => {
            const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
            if (qty > 0) {
              sideSum += (opt.extra_price || 0) * qty;
            }
          });
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
    const basePrice = this.customizerState.product.price;
    const extrasTotal = this.calculateExtrasTotal();
    const qty = this.customizerState.quantity;
    
    const unitPrice = basePrice + extrasTotal;
    const combinedTotal = unitPrice * qty;
    
    const topPriceEl = document.getElementById('customizer-base-price');
    if (topPriceEl) {
      topPriceEl.innerText = this.formatPesos(unitPrice);
    }
    
    const allValid = this.validateRequiredModifiers();
    
    const btn = document.getElementById('btn-confirm-add');
    if (btn) {
      btn.innerText = `Agregar al Carrito • ${this.formatPesos(combinedTotal)}`;
      btn.disabled = !allValid;
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

  closeCustomizerModal() {
    document.getElementById('customizer-modal').classList.remove('open');
    if (window.history.state && window.history.state.view === 'modal' && window.history.state.modalId === 'customizer-modal') {
      window.history.back();
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
      
      // 1. Base ingredients (exclusions and extras)
      if (product.exclusions) {
        product.exclusions.forEach(item => {
          const itemName = item.name || item;
          const qty = this.customizerState.quantities[sideKey]['base_' + itemName] || 0;
          if (qty === 0) {
            exclusions.push({ name: prefix + `Sin ${itemName}` });
          } else if (qty > 1) {
            addOns.push({
              name: prefix + `${itemName} Extra`,
              price_per_unit: 500,
              quantity: qty - 1
            });
          }
        });
      }

      // 2. Modifiers
      if (product.modifiers) {
        product.modifiers.forEach(group => {
          group.options.forEach(opt => {
            const qty = this.customizerState.quantities[sideKey]['opt_' + opt.option_id] || 0;
            if (qty > 0) {
              if (group.selection_type === 'single') {
                singleSelections.push({
                  group_name: prefix + group.group_name,
                  chosen_option: opt.name
                });
              } else {
                addOns.push({
                  name: prefix + opt.name,
                  price_per_unit: opt.extra_price || 0,
                  quantity: qty
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
    const basePrice = product.price;
    const extrasTotal = this.calculateExtrasTotal();
    const unitTotalCalculated = basePrice + extrasTotal;
    const qty = this.customizerState.quantity;
    const subtotalCombined = unitTotalCalculated * qty;
    
    const cartItemId = 'item-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    
    const cartItem = {
      cart_item_id: cartItemId,
      product_id: product.id,
      product_name: product.name,
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
      
      const badgeCount = document.getElementById('cart-badge-count');
      if (badgeCount) {
        badgeCount.classList.remove('badge-pop');
        void badgeCount.offsetWidth;
        badgeCount.classList.add('badge-pop');
      }
    }, 800);
  }

  updateQty(cartItemId, delta) {
    const itemIndex = this.cart.items.findIndex(item => item.cart_item_id === cartItemId);
    if (itemIndex === -1) return;

    const item = this.cart.items[itemIndex];
    item.quantity += delta;

    if (item.quantity <= 0) {
      this.cart.items.splice(itemIndex, 1);
    } else {
      item.subtotal_combined = item.unit_total_calculated * item.quantity;
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

    const totalCount = this.cart.items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = this.cart.items.reduce((sum, item) => sum + item.subtotal_combined, 0);

    if (totalCount > 0) {
      badgeCount.innerText = totalCount;
      badgeTotal.innerText = this.formatPesos(subtotal);
      
      badgeCount.classList.remove('badge-pop');
      void badgeCount.offsetWidth;
      badgeCount.classList.add('badge-pop');
      
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  }

  // Modals
  openCartModal() {
    const modal = document.getElementById('cart-modal');
    modal.classList.add('open');
    this.renderCartItems();
    this.setActiveMobileTab('cart');
    window.history.pushState({ view: 'modal', modalId: 'cart-modal' }, '');
  }

  closeCartModal() {
    document.getElementById('cart-modal').classList.remove('open');
    this.setActiveMobileTab('home');
    if (window.history.state && window.history.state.view === 'modal' && window.history.state.modalId === 'cart-modal') {
      window.history.back();
    }
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
          const qtyText = add.quantity > 1 ? ` x${add.quantity}` : '';
          specsParts.push(`+ ${add.name} (${this.formatPesos(add.price_per_unit)}${qtyText})`);
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
        totalDeliveryFee += uniqueShops[id].delivery_fee;
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

    const subtotal = this.cart.items.reduce((sum, item) => sum + item.subtotal_combined, 0);
    const total = subtotal + totalDeliveryFee;

    document.getElementById('cart-subtotal').innerText = this.formatPesos(subtotal);
    
    const deliveryCostSpan = document.getElementById('cart-delivery-cost');
    deliveryCostSpan.innerText = this.formatPesos(totalDeliveryFee);
    
    document.getElementById('cart-grand-total').innerText = this.formatPesos(total);
    
    const deliveryRow = document.querySelector('.delivery-cost-row');
    if (this.orderType === 'delivery') {
      deliveryRow.classList.remove('hidden');
      if (numShops === 1) {
        const singleShopId = shopIds[0];
        deliveryCostSpan.innerText = this.formatPesos(uniqueShops[singleShopId].delivery_fee);
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
    }

    this.renderCartItems();
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
      phone = document.getElementById('order-phone').value.trim();
      address = document.getElementById('order-address').value.trim();
      if (!customerName || !phone || !address) {
        alert('Por favor, completa todos los campos de entrega.');
        return;
      }
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

    const shopIds = Object.keys(groupedItems);
    
    try {
      // Send a separate request for each merchant
      const promises = shopIds.map(async (shopId) => {
        const shop = groupedItems[shopId];
        const shopSubtotal = shop.items.reduce((sum, item) => sum + item.subtotal_combined, 0);
        const shopDeliveryCost = this.orderType === 'delivery' ? shop.delivery_fee : 0;
        
        // Generate random 4-digit security code for delivery
        const randomCode = this.orderType === 'delivery' ? Math.floor(1000 + Math.random() * 9000).toString() : null;
        
        const orderData = {
          establishmentId: shop.id,
          establishmentName: shop.name,
          items: shop.items.map(item => ({
            id: item.product_id,
            name: item.product_name,
            price: item.unit_total_calculated,
            quantity: item.quantity,
            specifications: this.getSpecsStringForKitchen(item.selected_specifications),
            selected_specifications: item.selected_specifications,
            unit_total_calculated: item.unit_total_calculated,
            subtotal_combined: item.subtotal_combined
          })),
          total: shopSubtotal + shopDeliveryCost,
          orderType: this.orderType,
          customerName,
          tableNumber: tableNumber ? parseInt(tableNumber, 10) : null,
          deliveryDetails: this.orderType === 'delivery' ? { phone, address, code: randomCode } : null
        };

        const response = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderData)
        });

        if (!response.ok) {
          throw new Error(`Error en el pedido para ${shop.name}`);
        }
        return response;
      });

      await Promise.all(promises);

      this.showToast('🔔 ¡Pedido enviado en tiempo real a cocina!');
      this.clearCart();
      this.closeCartModal();
      
      // Reset form values
      document.getElementById('order-customer-name').value = '';
      if (document.getElementById('order-table-number')) document.getElementById('order-table-number').value = '';
      if (document.getElementById('order-phone')) document.getElementById('order-phone').value = '';
      if (document.getElementById('order-address')) document.getElementById('order-address').value = '';
      document.getElementById('checkout-accept-terms').checked = false;
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
        const qty = add.quantity > 1 ? ` (x${add.quantity})` : '';
        parts.push(`+ ${add.name}${qty}`);
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

  formatPesos(val) {
    if (isNaN(val)) return '$0';
    return '$' + Math.round(val).toLocaleString('de-DE');
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
    this.dismissLocationTutorial();
    const modal = document.getElementById('location-modal');
    if (modal) {
      modal.classList.add('open');
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
    document.getElementById('cart-modal')?.classList.remove('open');
    document.getElementById('location-modal')?.classList.remove('open');
    document.getElementById('terms-modal')?.classList.remove('open');
    document.getElementById('customizer-modal')?.classList.remove('open');
  }

  handlePopState(event) {
    const state = event.state;
    
    // Deactivate open classes without modifying history again
    document.getElementById('cart-modal')?.classList.remove('open');
    document.getElementById('location-modal')?.classList.remove('open');
    document.getElementById('terms-modal')?.classList.remove('open');
    document.getElementById('customizer-modal')?.classList.remove('open');

    if (!state || state.view === 'home') {
      this.goHome(false);
    } else if (state.view === 'establishment') {
      this.openEstablishment(state.estId, false);
    } else if (state.view === 'modal') {
      const modal = document.getElementById(state.modalId);
      if (modal) modal.classList.add('open');
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
}

const MarketplaceApp = new MarketplaceController();
window.MarketplaceApp = MarketplaceApp;

document.addEventListener('DOMContentLoaded', () => {
  MarketplaceApp.init();
});
