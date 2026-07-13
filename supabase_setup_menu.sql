-- ==========================================
-- SCRIPT DE BASE DE DATOS: CREADOR DE MENÚ
-- ==========================================

-- 1. Tabla de Categorías (Hamburguesas, Pizzas, etc.)
create table categories (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  slug text not null unique,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Tabla de Productos (Vinculado a Categoría)
create table products (
  id uuid default gen_random_uuid() primary key,
  category_id uuid references categories(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10, 2) not null check (price >= 0),
  image_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Tabla de Variantes / Adicionales del Producto (Ej. "Con queso extra")
create table product_variants (
  id uuid default gen_random_uuid() primary key,
  product_id uuid references products(id) on delete cascade,
  name text not null,
  extra_price numeric(10, 2) not null default 0.00 check (extra_price >= 0),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Habilitar Row Level Security (RLS) en todas las tablas
alter table categories enable row level security;
alter table products enable row level security;
alter table product_variants enable row level security;

-- ==========================================
-- POLÍTICAS DE ACCESO RLS (Row Level Security)
-- ==========================================

-- A. Políticas de lectura: Cualquier usuario (clientes) puede ver el menú
create policy "Cualquier persona puede ver las categorías"
  on categories for select using (true);

create policy "Cualquier persona puede ver los productos"
  on products for select using (true);

create policy "Cualquier persona puede ver las variantes"
  on product_variants for select using (true);

-- B. Políticas de escritura: Solo los usuarios con rol 'owner' (admin) en user_roles pueden modificar el menú
create or replace function is_owner(email_param text)
returns boolean as $$
begin
  return exists (
    select 1 from user_roles 
    where email = email_param and role = 'owner'
  );
end;
$$ language plpgsql security definer;

-- Políticas para categorías (Inserts, Updates, Deletes)
create policy "Solo administradores pueden insertar categorías"
  on categories for insert
  with check (is_owner(auth.jwt()->>'email'));

create policy "Solo administradores pueden actualizar categorías"
  on categories for update
  using (is_owner(auth.jwt()->>'email'))
  with check (is_owner(auth.jwt()->>'email'));

create policy "Solo administradores pueden eliminar categorías"
  on categories for delete
  using (is_owner(auth.jwt()->>'email'));

-- Políticas para productos (Inserts, Updates, Deletes)
create policy "Solo administradores pueden insertar productos"
  on products for insert
  with check (is_owner(auth.jwt()->>'email'));

create policy "Solo administradores pueden actualizar productos"
  on products for update
  using (is_owner(auth.jwt()->>'email'))
  with check (is_owner(auth.jwt()->>'email'));

create policy "Solo administradores pueden eliminar productos"
  on products for delete
  using (is_owner(auth.jwt()->>'email'));

-- Políticas para variantes (Inserts, Updates, Deletes)
create policy "Solo administradores pueden insertar variantes"
  on product_variants for insert
  with check (is_owner(auth.jwt()->>'email'));

create policy "Solo administradores pueden actualizar variantes"
  on product_variants for update
  using (is_owner(auth.jwt()->>'email'))
  with check (is_owner(auth.jwt()->>'email'));

create policy "Solo administradores pueden eliminar variantes"
  on product_variants for delete
  using (is_owner(auth.jwt()->>'email'));

-- ==========================================
-- STORAGE BUCKET: menu_images
-- ==========================================
-- Nota: Recuerda crear el bucket "menu_images" desde la pestaña Storage de Supabase
-- y otorgarle permisos públicos de lectura, y permisos de subida para usuarios autenticados.
