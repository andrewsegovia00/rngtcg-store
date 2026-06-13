-- ============================================================================
-- R&G TCG MVP — Supabase schema
-- Block 7: order storage + inventory reservation.
-- Run this in Supabase SQL Editor, then run seed.sql.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key,
  category text not null,
  name text not null,
  set_code text not null,
  language text not null default 'english' check (language in ('english','japanese','chinese')),
  badge text,
  tone text,
  symbol text,
  image_label text,
  sale_percent integer check (sale_percent is null or (sale_percent >= 0 and sale_percent <= 90)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  sku text primary key,
  product_id text not null references public.products(id) on delete cascade,
  format text not null check (format in ('pack','box')),
  price_cents integer not null check (price_cents >= 0),
  stock_on_hand integer not null default 0 check (stock_on_hand >= 0),
  stock_reserved integer not null default 0 check (stock_reserved >= 0),
  stock_sold integer not null default 0 check (stock_sold >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, format),
  constraint stock_not_negative check (stock_on_hand >= stock_reserved + stock_sold)
);

create table if not exists public.checkout_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  status text not null default 'pending' check (status in ('pending','paid','released','expired','cancelled','failed')),
  customer_email text,
  shipping_method text not null default 'standard' check (shipping_method in ('standard','express')),
  currency text not null default 'usd',
  subtotal_cents integer not null default 0,
  shipping_cents integer not null default 0,
  total_before_tax_cents integer not null default 0,
  stripe_session_id text unique,
  stripe_payment_intent text,
  stripe_customer_id text,
  stripe_customer_email text,
  ship_name text,
  ship_phone text,
  ship_line1 text,
  ship_line2 text,
  ship_city text,
  ship_state text,
  ship_postal_code text,
  ship_country text,
  expires_at timestamptz,
  paid_at timestamptz,
  released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checkout_order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.checkout_orders(id) on delete cascade,
  product_id text not null references public.products(id),
  sku text not null references public.product_variants(sku),
  format text not null check (format in ('pack','box')),
  language text not null,
  category text not null,
  title text not null,
  set_code text not null,
  quantity integer not null check (quantity > 0),
  unit_amount_cents integer not null check (unit_amount_cents >= 0),
  line_amount_cents integer not null check (line_amount_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_checkout_orders_status on public.checkout_orders(status);
create index if not exists idx_checkout_orders_stripe_session on public.checkout_orders(stripe_session_id);
create index if not exists idx_checkout_order_items_order_id on public.checkout_order_items(order_id);
create index if not exists idx_product_variants_product_format on public.product_variants(product_id, format);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
before update on public.products
for each row execute function public.touch_updated_at();

drop trigger if exists product_variants_touch_updated_at on public.product_variants;
create trigger product_variants_touch_updated_at
before update on public.product_variants
for each row execute function public.touch_updated_at();

drop trigger if exists checkout_orders_touch_updated_at on public.checkout_orders;
create trigger checkout_orders_touch_updated_at
before update on public.checkout_orders
for each row execute function public.touch_updated_at();

create or replace function public.make_order_number()
returns text
language sql
as $$
  select 'RG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

create or replace function public.get_inventory_snapshot()
returns table(
  product_id text,
  format text,
  sku text,
  stock_on_hand integer,
  stock_reserved integer,
  stock_sold integer,
  available integer
)
language sql
security definer
set search_path = public
as $$
  select
    pv.product_id,
    pv.format,
    pv.sku,
    pv.stock_on_hand,
    pv.stock_reserved,
    pv.stock_sold,
    greatest(pv.stock_on_hand - pv.stock_reserved - pv.stock_sold, 0) as available
  from public.product_variants pv
  join public.products p on p.id = pv.product_id
  where pv.active = true and p.active = true
  order by pv.product_id, pv.format;
$$;

create or replace function public.create_checkout_reservation(
  p_customer_email text,
  p_shipping_method text,
  p_cart jsonb,
  p_hold_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_subtotal integer := 0;
  v_shipping integer := 0;
  v_total integer := 0;
  v_item_count integer := 0;
  v_hold_minutes integer := least(greatest(coalesce(p_hold_minutes, 30), 5), 120);
  v_expires_at timestamptz := now() + (least(greatest(coalesce(p_hold_minutes, 30), 5), 120)::text || ' minutes')::interval;
  v_lines jsonb := '[]'::jsonb;
  v_expected integer := 0;
  v_updated integer := 0;
begin
  if jsonb_typeof(p_cart) is distinct from 'array' then
    raise exception 'Cart must be an array.';
  end if;

  drop table if exists pg_temp._cart_reservation;
  create temporary table _cart_reservation on commit drop as
    select
      x.product_id::text as product_id,
      case when x.format = 'box' then 'box' else 'pack' end::text as format,
      sum(x.quantity::integer)::integer as quantity
    from jsonb_to_recordset(p_cart) as x(product_id text, format text, quantity integer)
    group by x.product_id, case when x.format = 'box' then 'box' else 'pack' end;

  if not exists (select 1 from _cart_reservation) then
    raise exception 'Your chest is empty.';
  end if;

  if exists (select 1 from _cart_reservation where quantity is null or quantity < 1 or quantity > 20) then
    raise exception 'Invalid quantity in cart.';
  end if;

  select count(*) into v_expected from _cart_reservation;

  -- Lock selected variants so two checkout sessions cannot reserve the same units at once.
  perform 1
  from public.product_variants pv
  join _cart_reservation c on c.product_id = pv.product_id and c.format = pv.format
  for update of pv;

  if exists (
    select 1
    from _cart_reservation c
    left join public.product_variants pv on pv.product_id = c.product_id and pv.format = c.format and pv.active = true
    left join public.products p on p.id = c.product_id and p.active = true
    where pv.sku is null or p.id is null
  ) then
    raise exception 'A product in your chest is no longer available.';
  end if;

  if exists (
    select 1
    from _cart_reservation c
    join public.product_variants pv on pv.product_id = c.product_id and pv.format = c.format
    where (pv.stock_on_hand - pv.stock_reserved - pv.stock_sold) < c.quantity
  ) then
    raise exception 'Not enough inventory left for one or more items.';
  end if;

  update public.product_variants pv
  set stock_reserved = pv.stock_reserved + c.quantity
  from _cart_reservation c
  where pv.product_id = c.product_id
    and pv.format = c.format
    and (pv.stock_on_hand - pv.stock_reserved - pv.stock_sold) >= c.quantity;

  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception 'Inventory changed while reserving. Please try again.';
  end if;

  select
    coalesce(sum(pv.price_cents * c.quantity), 0)::integer,
    coalesce(sum(c.quantity), 0)::integer
  into v_subtotal, v_item_count
  from _cart_reservation c
  join public.product_variants pv on pv.product_id = c.product_id and pv.format = c.format;

  if coalesce(p_shipping_method, 'standard') = 'express' then
    v_shipping := 1500;
  elsif v_subtotal >= 7500 then
    v_shipping := 0;
  else
    v_shipping := 500;
  end if;
  v_total := v_subtotal + v_shipping;

  v_order_number := public.make_order_number();
  insert into public.checkout_orders (
    order_number,
    status,
    customer_email,
    shipping_method,
    subtotal_cents,
    shipping_cents,
    total_before_tax_cents,
    expires_at,
    metadata
  ) values (
    v_order_number,
    'pending',
    nullif(trim(coalesce(p_customer_email,'')), ''),
    case when p_shipping_method = 'express' then 'express' else 'standard' end,
    v_subtotal,
    v_shipping,
    v_total,
    v_expires_at,
    jsonb_build_object('hold_minutes', v_hold_minutes, 'item_count', v_item_count)
  ) returning id into v_order_id;

  insert into public.checkout_order_items (
    order_id,
    product_id,
    sku,
    format,
    language,
    category,
    title,
    set_code,
    quantity,
    unit_amount_cents,
    line_amount_cents
  )
  select
    v_order_id,
    p.id,
    pv.sku,
    pv.format,
    p.language,
    p.category,
    p.name,
    p.set_code,
    c.quantity,
    pv.price_cents,
    pv.price_cents * c.quantity
  from _cart_reservation c
  join public.product_variants pv on pv.product_id = c.product_id and pv.format = c.format
  join public.products p on p.id = c.product_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', i.product_id,
    'sku', i.sku,
    'format', i.format,
    'language', i.language,
    'category', i.category,
    'title', i.title,
    'set_code', i.set_code,
    'quantity', i.quantity,
    'unit_amount_cents', i.unit_amount_cents,
    'line_amount_cents', i.line_amount_cents
  ) order by i.id), '[]'::jsonb)
  into v_lines
  from public.checkout_order_items i
  where i.order_id = v_order_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'status', 'pending',
    'expires_at', v_expires_at,
    'item_count', v_item_count,
    'subtotal_cents', v_subtotal,
    'shipping_cents', v_shipping,
    'total_before_tax_cents', v_total,
    'lines', v_lines
  );
exception
  when others then
    raise;
end;
$$;

create or replace function public.attach_stripe_session(
  p_order_id uuid,
  p_stripe_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.checkout_orders%rowtype;
begin
  update public.checkout_orders
  set stripe_session_id = p_stripe_session_id,
      updated_at = now()
  where id = p_order_id
    and status = 'pending'
  returning * into v_order;

  if v_order.id is null then
    raise exception 'Pending order was not found.';
  end if;

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'stripe_session_id', v_order.stripe_session_id);
end;
$$;

create or replace function public.release_order_reservation(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.checkout_orders%rowtype;
begin
  select * into v_order
  from public.checkout_orders
  where id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order was not found.';
  end if;

  if v_order.status <> 'pending' then
    return jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'released', false);
  end if;

  update public.product_variants pv
  set stock_reserved = greatest(pv.stock_reserved - i.quantity, 0)
  from public.checkout_order_items i
  where i.order_id = v_order.id
    and i.sku = pv.sku;

  update public.checkout_orders
  set status = 'released', released_at = now(), updated_at = now()
  where id = v_order.id;

  return jsonb_build_object('order_id', v_order.id, 'status', 'released', 'released', true);
end;
$$;

create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_stripe_session_id text,
  p_payment_intent text,
  p_customer_id text,
  p_customer_email text,
  p_payload jsonb default '{}'::jsonb,
  p_shipping jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.checkout_orders%rowtype;
begin
  select * into v_order
  from public.checkout_orders
  where id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'Order was not found.';
  end if;

  if v_order.status = 'paid' then
    return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'status', 'paid', 'already_paid', true);
  end if;

  if v_order.status <> 'pending' then
    raise exception 'Order is %, not pending.', v_order.status;
  end if;

  update public.product_variants pv
  set stock_reserved = greatest(pv.stock_reserved - i.quantity, 0),
      stock_sold = pv.stock_sold + i.quantity
  from public.checkout_order_items i
  where i.order_id = v_order.id
    and i.sku = pv.sku;

  update public.checkout_orders
  set status = 'paid',
      stripe_session_id = coalesce(p_stripe_session_id, stripe_session_id),
      stripe_payment_intent = p_payment_intent,
      stripe_customer_id = p_customer_id,
      stripe_customer_email = p_customer_email,
      ship_name = coalesce(nullif(p_shipping->>'name', ''), ship_name),
      ship_phone = coalesce(nullif(p_shipping->>'phone', ''), ship_phone),
      ship_line1 = coalesce(nullif(p_shipping->>'line1', ''), ship_line1),
      ship_line2 = coalesce(nullif(p_shipping->>'line2', ''), ship_line2),
      ship_city = coalesce(nullif(p_shipping->>'city', ''), ship_city),
      ship_state = coalesce(nullif(p_shipping->>'state', ''), ship_state),
      ship_postal_code = coalesce(nullif(p_shipping->>'postal_code', ''), ship_postal_code),
      ship_country = coalesce(nullif(p_shipping->>'country', ''), ship_country),
      paid_at = now(),
      metadata = metadata || jsonb_build_object('stripe_event_payload', p_payload),
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'status', v_order.status);
end;
$$;

create or replace function public.release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select id from public.checkout_orders
    where status = 'pending' and expires_at is not null and expires_at < now()
    for update skip locked
  loop
    perform public.release_order_reservation(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Keep RLS off for MVP service-role-only access. Do not expose service role key in browser.
alter table public.products disable row level security;
alter table public.product_variants disable row level security;
alter table public.checkout_orders disable row level security;
alter table public.checkout_order_items disable row level security;
