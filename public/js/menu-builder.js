/* Menu Builder Service (menu-builder.js) */

class MenuBuilderService {
  constructor() {
    this.supabase = null;
  }

  // Ensure Supabase client is initialized from the global helper
  async init() {
    if (typeof SupabaseApp === 'undefined') {
      console.error('SupabaseApp helper is not loaded.');
      return false;
    }
    await SupabaseApp.init();
    this.supabase = SupabaseApp.client;
    return this.supabase !== null;
  }

  // ==========================================
  // PILLAR 2: IMAGE COMPRESSION & STORAGE
  // ==========================================

  // Compress image using canvas before uploading
  async compressImage(file, maxWidth = 800) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          // Calculate new size
          let width = img.width;
          let height = img.height;
          
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          // Draw on canvas to compress
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Convert canvas back to blob (JPEG format with 0.8 quality)
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Canvas compression failed'));
              }
            },
            'image/jpeg',
            0.8
          );
        };
      };
      reader.onerror = (error) => reject(error);
    });
  }

  // Upload image to Supabase Storage bucket 'menu_images'
  async uploadProductImage(file) {
    const hasClient = await this.init();
    if (!hasClient) throw new Error('Supabase Client not ready');

    // 1. Compress the file client-side
    const compressedBlob = await this.compressImage(file);

    // 2. Generate unique filename
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}.${fileExt}`;
    const filePath = `uploads/${fileName}`;

    // 3. Upload to Supabase Storage Bucket
    const { data, error } = await this.supabase.storage
      .from('menu_images')
      .upload(filePath, compressedBlob, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('Supabase storage upload error:', error.message);
      throw error;
    }

    // 4. Retrieve public URL
    const { data: publicUrlData } = this.supabase.storage
      .from('menu_images')
      .getPublicUrl(filePath);

    return publicUrlData.publicUrl;
  }

  // ==========================================
  // PILLAR 3: CRUD OPERATIONS & REALTIME
  // ==========================================

  // Fetch all categories
  async getCategories() {
    const hasClient = await this.init();
    if (!hasClient) return [];
    
    const { data, error } = await this.supabase
      .from('categories')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    return data;
  }

  // Create new category
  async createCategory(name, slug) {
    const hasClient = await this.init();
    if (!hasClient) throw new Error('Supabase Client not ready');

    const { data, error } = await this.supabase
      .from('categories')
      .insert([{ name, slug }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Create new product
  async createProduct(categoryId, name, description, price, imageUrl) {
    const hasClient = await this.init();
    if (!hasClient) throw new Error('Supabase Client not ready');

    const { data, error } = await this.supabase
      .from('products')
      .insert([{
        category_id: categoryId,
        name,
        description,
        price: parseFloat(price),
        image_url: imageUrl
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Create product variant (additional specs)
  async createProductVariant(productId, name, extraPrice) {
    const hasClient = await this.init();
    if (!hasClient) throw new Error('Supabase Client not ready');

    const { data, error } = await this.supabase
      .from('product_variants')
      .insert([{
        product_id: productId,
        name,
        extra_price: parseFloat(extraPrice)
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Setup Supabase Realtime subscription to sync menu updates instantly across clients
  subscribeToMenuUpdates(onInsert, onUpdate, onDelete) {
    this.init().then((hasClient) => {
      if (!hasClient) return;

      this.supabase
        .channel('menu-realtime-channel')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'products' },
          (payload) => {
            console.log('Realtime product inserted:', payload.new);
            if (onInsert) onInsert(payload.new);
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'products' },
          (payload) => {
            console.log('Realtime product updated:', payload.new);
            if (onUpdate) onUpdate(payload.new);
          }
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'products' },
          (payload) => {
            console.log('Realtime product deleted:', payload.old);
            if (onDelete) onDelete(payload.old);
          }
        )
        .subscribe((status) => {
          console.log('Supabase Realtime subscription status:', status);
        });
    });
  }
}

const MenuBuilder = new MenuBuilderService();
window.MenuBuilder = MenuBuilder;
