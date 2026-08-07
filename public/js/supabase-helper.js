/* Supabase Helper Client Logic (supabase-helper.js) */

class SupabaseHelper {
  constructor() {
    this.client = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      const response = await fetch('/api/config/supabase');
      const config = await response.json();
      
      if (config.supabaseUrl && config.supabaseAnonKey) {
        if (typeof supabase !== 'undefined') {
          this.client = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
          this.initialized = true;
          console.log('Supabase client initialized successfully.');
        } else {
          console.warn('Supabase SDK not loaded on window.');
        }
      } else {
        console.warn('Supabase configuration missing in .env. Setup required.');
      }
    } catch (err) {
      console.error('Failed to retrieve Supabase config:', err);
    }
  }

  async loginWithGoogle(redirectToPage) {
    await this.init();
    if (!this.client) {
      alert('Supabase no está configurado. Por favor, define SUPABASE_URL y SUPABASE_ANON_KEY en tu archivo .env');
      return;
    }
    
    // Redirect back to the same page or specified page
    const redirectUrl = window.location.origin + (redirectToPage || window.location.pathname);
    
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl
      }
    });

    if (error) {
      console.error('Error logging in with Google:', error.message);
      alert('Error de login: ' + error.message);
    }
  }

  async logout() {
    await this.init();
    if (this.client) {
      await this.client.auth.signOut();
    }
  }

  async getCurrentSession() {
    await this.init();
    if (!this.client) return null;
    try {
      const { data } = await this.client.auth.getSession();
      if (data && data.session) return data.session;
      const { data: userData } = await this.client.auth.getUser();
      if (userData && userData.user) {
        return { user: userData.user };
      }
    } catch (e) {
      console.warn('Error fetching session:', e);
    }
    return null;
  }

  async getUserRole(email) {
    await this.init();
    if (!this.client) return null;
    
    // Query user_roles table for role mappings
    const { data, error } = await this.client
      .from('user_roles')
      .select('role, establishment_id')
      .eq('email', email)
      .single();
      
    if (error) {
      console.warn('No custom role found in user_roles or error querying:', error.message);
      return null;
    }
    
    return data; // { role: 'customer'|'merchant'|'owner', establishment_id }
  }
}

const SupabaseApp = new SupabaseHelper();
window.SupabaseApp = SupabaseApp;
