-- =======================================================
-- SCRIPT COMPLETO DE CONFIGURACIÓN DE BASE DE DATOS Y PERMISOS
-- Ejecuta todo este script en el SQL Editor de tu panel de Supabase
-- =======================================================

-- 1. CREACIÓN DE TABLAS PRINCIPALES
create table if not exists establishments (
  id text primary key,
  name text not null,
  category text not null,
  description text,
  logo text,
  "bannerType" text,
  banner text,
  "linkKey" text,
  delivery_fee numeric(10, 2) default 0.00,
  "themeColor" text,
  "logoImage" text,
  tables jsonb default '[]'::jsonb,
  layout jsonb default '[]'::jsonb,
  products jsonb default '[]'::jsonb,
  prep_time integer,
  delivery_time integer,
  location text default 'San Antonio',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists orders (
  id text primary key,
  "establishmentId" text,
  "establishmentName" text,
  items jsonb default '[]'::jsonb,
  total numeric(10, 2) default 0.00,
  "orderType" text,
  "customerName" text,
  "tableNumber" text,
  "deliveryDetails" jsonb default '{}'::jsonb,
  status text default 'Pendiente',
  "cancelReason" text,
  "paymentStatus" text default 'Pendiente',
  "createdAt" timestamp with time zone default timezone('utc'::text, now()) not null,
  "updatedAt" timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists user_roles (
  id uuid default gen_random_uuid() primary key,
  email text not null unique,
  role text not null default 'merchant',
  establishment_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. HABILITAR RLS (ROW LEVEL SECURITY)
alter table establishments enable row level security;
alter table orders enable row level security;
alter table user_roles enable row level security;

-- 3. POLÍTICAS DE ACCESO PÚBLICO (ESTABLECIMIENTOS)
drop policy if exists "Public select establishments" on establishments;
create policy "Public select establishments" on establishments for select using (true);

drop policy if exists "Public insert establishments" on establishments;
create policy "Public insert establishments" on establishments for insert with check (true);

drop policy if exists "Public update establishments" on establishments;
create policy "Public update establishments" on establishments for update using (true) with check (true);

drop policy if exists "Public delete establishments" on establishments;
create policy "Public delete establishments" on establishments for delete using (true);

-- 4. POLÍTICAS DE ACCESO PÚBLICO (PEDIDOS)
drop policy if exists "Public select orders" on orders;
create policy "Public select orders" on orders for select using (true);

drop policy if exists "Public insert orders" on orders;
create policy "Public insert orders" on orders for insert with check (true);

drop policy if exists "Public update orders" on orders;
create policy "Public update orders" on orders for update using (true) with check (true);

drop policy if exists "Public delete orders" on orders;
create policy "Public delete orders" on orders for delete using (true);

-- 5. POLÍTICAS DE ACCESO PÚBLICO (ROLES DE USUARIOS)
drop policy if exists "Public select user_roles" on user_roles;
create policy "Public select user_roles" on user_roles for select using (true);

drop policy if exists "Public insert user_roles" on user_roles;
create policy "Public insert user_roles" on user_roles for insert with check (true);

drop policy if exists "Public update user_roles" on user_roles;
create policy "Public update user_roles" on user_roles for update using (true) with check (true);

drop policy if exists "Public delete user_roles" on user_roles;
create policy "Public delete user_roles" on user_roles for delete using (true);

-- 6. ASIGNACIÓN DE ROLES DE ADMINISTRADOR (DUEÑOS)
insert into user_roles (email, role, establishment_id)
values 
  ('sergioantia@gmail.com', 'owner', null),
  ('owenssrouss@gmail.com', 'owner', null)
on conflict (email) 
do update set role = 'owner';

-- 7. CONFIGURACIÓN DEL BUCKET DE FOTOS Y ARCHIVOS (STORAGE)
insert into storage.buckets (id, name, public)
values ('menu_images', 'menu_images', true)
on conflict (id) do update set public = true;

drop policy if exists "Public select storage menu_images" on storage.objects;
create policy "Public select storage menu_images" on storage.objects for select using ( bucket_id = 'menu_images' );

drop policy if exists "Public insert storage menu_images" on storage.objects;
create policy "Public insert storage menu_images" on storage.objects for insert with check ( bucket_id = 'menu_images' );

drop policy if exists "Public update storage menu_images" on storage.objects;
create policy "Public update storage menu_images" on storage.objects for update using ( bucket_id = 'menu_images' );

drop policy if exists "Public delete storage menu_images" on storage.objects;
create policy "Public delete storage menu_images" on storage.objects for delete using ( bucket_id = 'menu_images' );
