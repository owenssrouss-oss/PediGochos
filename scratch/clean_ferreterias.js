const url = 'https://bvdwxgfixirisqaavskj.supabase.co';
const key = 'sb_publishable_8n4-tEnAx5J98ZMh_QwZiw_Qcncleqx';

async function run() {
  try {
    // 1. Fetch categories
    console.log('Fetching categories...');
    const catRes = await fetch(`${url}/rest/v1/categories`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    
    if (!catRes.ok) {
      throw new Error(`Failed to fetch categories: ${catRes.statusText}`);
    }
    
    const categories = await catRes.json();
    console.log('Current categories in Supabase:', categories);
    
    // Find categories matching 'ferreteria'
    const targetCats = categories.filter(c => 
      c.name.toLowerCase().includes('ferreter') || 
      c.slug.toLowerCase().includes('ferreter')
    );
    
    console.log('Matching categories to delete:', targetCats);
    
    for (const cat of targetCats) {
      console.log(`Deleting category: ${cat.name} (ID: ${cat.id})...`);
      const delRes = await fetch(`${url}/rest/v1/categories?id=eq.${cat.id}`, {
        method: 'DELETE',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Prefer': 'representation'
        }
      });
      if (delRes.ok) {
        console.log(`Deleted category ${cat.name} successfully!`);
      } else {
        console.error(`Failed to delete category ${cat.name}:`, delRes.statusText);
      }
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
