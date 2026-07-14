-- =======================================================
-- SCRIPT DE BASE DE DATOS: TABLAS DE PERSISTENCIA COMPLETAS
-- Ejecuta este script en el editor SQL de Supabase (SQL Editor)
-- =======================================================

-- 1. Crear tabla de Establecimientos
create table if not exists establishments (
  id text primary key,
  name text not null,
  category text not null,
  description text,
  logo text,
  "bannerType" text,
  banner text,
  "linkKey" text,
  "deliveryFee" numeric(10, 2) default 0.00,
  "themeColor" text,
  "logoImage" text,
  tables jsonb default '[]'::jsonb,
  layout jsonb default '[]'::jsonb,
  products jsonb default '[]'::jsonb,
  "prepTime" integer,
  "deliveryTime" integer,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Crear tabla de Pedidos
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
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Habilitar RLS (Row Level Security) en ambas tablas
alter table establishments enable row level security;
alter table orders enable row level security;

-- 4. Crear Políticas de acceso público (Lectura y Escritura ilimitadas con la Anon Key)
-- Esto permite que tu servidor Node.js guarde los datos sin dar error de credenciales.

-- Políticas para Establecimientos
drop policy if exists "Lectura pública de establecimientos" on establishments;
create policy "Lectura pública de establecimientos" on establishments for select using (true);

drop policy if exists "Inserción pública de establecimientos" on establishments;
create policy "Inserción pública de establecimientos" on establishments for insert with check (true);

drop policy if exists "Actualización pública de establecimientos" on establishments;
create policy "Actualización pública de establecimientos" on establishments for update using (true) with check (true);

drop policy if exists "Eliminación pública de establecimientos" on establishments;
create policy "Eliminación pública de establecimientos" on establishments for delete using (true);

-- Políticas para Pedidos
drop policy if exists "Lectura pública de pedidos" on orders;
create policy "Lectura pública de pedidos" on orders for select using (true);

drop policy if exists "Inserción pública de pedidos" on orders;
create policy "Inserción pública de pedidos" on orders for insert with check (true);

drop policy if exists "Actualización pública de pedidos" on orders;
create policy "Actualización pública de pedidos" on orders for update using (true) with check (true);

drop policy if exists "Eliminación pública de pedidos" on orders;
create policy "Eliminación pública de pedidos" on orders for delete using (true);
