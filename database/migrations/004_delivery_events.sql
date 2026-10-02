create table delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  event_type varchar(50) not null,
  status delivery_status,
  message varchar(500) not null,
  tracking_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists delivery_events_delivery_idx on delivery_events(delivery_id, created_at desc);
create index if not exists deliveries_queue_idx on deliveries(status, created_at desc);
