create table payment_proof_files (
  id uuid primary key default gen_random_uuid(),
  payment_proof_id uuid not null unique references payment_proofs(id) on delete cascade,
  storage_key text not null unique,
  original_filename varchar(255) not null,
  mime_type varchar(100) not null,
  byte_size bigint not null check (byte_size > 0),
  checksum_sha256 char(64) not null,
  uploaded_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index if not exists payment_proof_files_proof_idx on payment_proof_files(payment_proof_id);
