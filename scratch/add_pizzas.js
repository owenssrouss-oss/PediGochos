const url = 'https://bvdwxgfixirisqaavskj.supabase.co';
const key = 'sb_publishable_8n4-tEnAx5J98ZMh_QwZiw_Qcncleqx';

async function run() {
  try {
    // 1. Get Pizzas category
    let res = await fetch(`${url}/rest/v1/categories?name=ilike.*Pizza*`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    let categories = await res.json();
    let pizzaCategory = categories[0];

    if (!pizzaCategory) {
      console.log('No pizza category found. Creating one...');
      res = await fetch(`${url}/rest/v1/categories`, {
        method: 'POST',
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ name: '🍕 Pizzas', slug: 'pizzas' })
      });
      const newCats = await res.json();
      pizzaCategory = newCats[0];
    }
    
    console.log('Pizza Category ID:', pizzaCategory.id);

    // 2. Add two pizzas
    const pizzas = [
      {
        category_id: pizzaCategory.id,
        name: 'Pizza Margarita Clásica',
        description: 'La auténtica receta italiana con abundante mozzarella y albahaca fresca.',
        price: 12.00,
        image_url: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&auto=format&fit=crop',
        modifiers: [
          {
            group_id: 'g-tamanos-' + Date.now(),
            group_name: 'Tamaño',
            selection_type: 'single',
            required: true,
            options: [
              { id: 'opt-' + Date.now() + 1, option_id: 'opt-' + Date.now() + 1, name: 'Pequeña', extra_price: 0 },
              { id: 'opt-' + Date.now() + 2, option_id: 'opt-' + Date.now() + 2, name: 'Mediana', extra_price: 4 },
              { id: 'opt-' + Date.now() + 3, option_id: 'opt-' + Date.now() + 3, name: 'Grande', extra_price: 8 }
            ]
          },
          {
            group_id: 'g-extras-' + Date.now(),
            group_name: 'Adicionales',
            selection_type: 'multiple',
            required: false,
            options: [
              { id: 'opt-' + Date.now() + 4, option_id: 'opt-' + Date.now() + 4, name: 'Extra Queso', extra_price: 2.50 },
              { id: 'opt-' + Date.now() + 5, option_id: 'opt-' + Date.now() + 5, name: 'Borde Relleno', extra_price: 3.00 }
            ]
          }
        ]
      },
      {
        category_id: pizzaCategory.id,
        name: 'Pizza Pepperoni Especial',
        description: 'Doble porción de pepperoni y queso mozzarella sobre una base crujiente.',
        price: 14.00,
        image_url: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&auto=format&fit=crop',
        modifiers: [
          {
            group_id: 'g-tamanos-' + Date.now() + 10,
            group_name: 'Tamaño',
            selection_type: 'single',
            required: true,
            options: [
              { id: 'opt-' + Date.now() + 11, option_id: 'opt-' + Date.now() + 11, name: 'Pequeña', extra_price: 0 },
              { id: 'opt-' + Date.now() + 12, option_id: 'opt-' + Date.now() + 12, name: 'Mediana', extra_price: 5 },
              { id: 'opt-' + Date.now() + 13, option_id: 'opt-' + Date.now() + 13, name: 'Grande', extra_price: 9 }
            ]
          },
          {
            group_id: 'g-extras-' + Date.now() + 10,
            group_name: 'Adicionales',
            selection_type: 'multiple',
            required: false,
            options: [
              { id: 'opt-' + Date.now() + 14, option_id: 'opt-' + Date.now() + 14, name: 'Extra Pepperoni', extra_price: 3.50 },
              { id: 'opt-' + Date.now() + 15, option_id: 'opt-' + Date.now() + 15, name: 'Tocineta', extra_price: 2.00 }
            ]
          }
        ]
      }
    ];

    res = await fetch(`${url}/rest/v1/products`, {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(pizzas)
    });

    if (res.ok) {
      console.log('Pizzas added successfully!');
    } else {
      console.error('Error adding pizzas:', await res.text());
    }
  } catch (err) {
    console.error(err);
  }
}

run();
