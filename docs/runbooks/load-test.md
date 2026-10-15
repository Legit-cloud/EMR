# Load test (performance targets, CLAUDE.md Section 6)

Targets: chart open p95 < 2 s; booking API p95 < 500 ms.

## Running

On a **non-production** environment seeded with synthetic data:

```sh
python manage.py seed_demo_data --password <pw> --patients 300   # DEBUG only; prints tokens
python scripts/load_test.py --base-url https://<staging-host> \
    --doctor-token <token> --desk-token <token> --concurrency 20 --requests 200
```

Add `--behind-tls-proxy` when hitting a production-mode container directly over HTTP.
Raise `USER_THROTTLE_RATE` on the target for the run: two tokens making thousands of
requests are otherwise rate limited, as intended. Run the load generator on a different
machine from the app; on one machine they compete for CPU and the numbers mean little.

`scripts/profile_request.py` profiles one chart open in-process.

## Results so far (development laptop, Docker Desktop, 8 CPUs, 2026-10-15)

Load generator, app and PostgreSQL on the same machine. Indicative only.

| Server | Clients | Chart open p95 | Booking p95 | Notes |
| --- | --- | --- | --- | --- |
| any | 1 | 393 ms | 213 ms | per-request cost is within target |
| ASGI, 3 uvicorn workers | 20 | 4.5 s | 3.7 s | Django runs sync views on one thread per ASGI worker |
| WSGI, 3 x 8 gthread | 20 | 3.2 s | 3.1 s | CPU-bound (about 290% of 300%) |
| WSGI, 8 x 4 gthread | 8 | 1.2 s | 1.1 s | chart target met; booking not |
| WSGI, 8 x 4 gthread | 20 | 5.5 s | 4.1 s | machine saturated (generator on the same CPUs); 5 timeouts |

Found and fixed during these runs:

- **PostgreSQL ran out of connections** ("too many clients") under ASGI: per-thread
  persistent connections. Fixed with Django's psycopg connection pool (`DB_POOL_*`).
- **Every PHI read queued on one audit lock per tenant.** Fixed by spreading each tenant's
  hash chain over `AUDIT_CHAIN_SHARDS` (16) independent chains; lock waits went to zero.
- **Per-request queries cut from 9 to 5** (tenant lookups cached and invalidated on save;
  the MFA check skips its query for verified tokens).

Still open (decisions for a human):

1. **ASGI or WSGI for HTTP.** Under ASGI, Django runs synchronous views one at a time per
   worker process, which halves throughput here. Options: serve HTTP with gunicorn gthread
   (WSGI) and run a separate ASGI service only for WebSockets (needs its own hostname on
   Railway), or keep ASGI and scale workers and replicas.
2. **Measure on staging** with Railway-sized instances and the generator elsewhere, then
   set worker and replica counts from those numbers.
3. **Booking latency** includes queuing the SMS and email confirmation in the request
   transaction; moving that to an event handler would take it off the booking path.
