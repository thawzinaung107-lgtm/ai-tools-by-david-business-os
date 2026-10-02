
## Staff provisioning

Only a user with `users.manage` can call these endpoints:

- `GET /api/v1/users` — list active and invited staff without password data.
- `POST /api/v1/users` — create an active role-scoped staff account.

Create a CS account:

```json
{
  "email": "cs@example.com",
  "display_name": "CS Agent 1",
  "password": "minimum 12 characters",
  "role_code": "CS_AGENT"
}
```

Allowed staff roles from this endpoint are `OPERATIONS_MANAGER`, `CS_AGENT`, and `FULFILMENT_AGENT`. Owner accounts are intentionally excluded from ordinary staff provisioning. The action writes an audit-log entry and never returns a password hash.
