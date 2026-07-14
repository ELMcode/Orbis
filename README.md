# Orbis

**The Single Source of Infrastructure Truth.**

Orbis is a multi-tenant infrastructure documentation and operations platform for inventory, topology, network discovery, IPAM, DCIM, monitoring, security, reporting, and controlled collaboration.

## Capabilities

- Infrastructure inventory with organization and site hierarchy
- Interactive diagrams with device types, links, layout, history, and visual comparison
- Collector-based network discovery with import, scan, CDP/LLDP/ARP, SNMP, and reconciliation
- IPAM for VRFs, VLANs, prefixes, addresses, reservations, and conflicts
- DCIM for racks, providers, circuits, patch panels, and physical cabling
- Source-of-truth workflows for dependencies, contracts, lifecycle, custom fields, tags, and saved views
- Monitoring events, alert policies, maintenance windows, incidents, and notification channels
- Scheduled CSV/PDF reporting and email delivery tests
- API keys, signed webhooks, SSO integration, RBAC, audit trails, mentions, and comments
- French and English user interface with persisted language selection

## Architecture

- Frontend: React, TypeScript, Vite, React Flow, Tailwind CSS
- Backend: Fastify, TypeScript, Prisma
- Database: PostgreSQL
- Collector: TypeScript network discovery agent
- Deployment: Docker Compose

## Requirements

- Node.js 20 or newer
- pnpm 9 or newer
- Docker Desktop with Compose v2

## Local development

1. Copy `.env.example` to `.env` and replace every development or production secret with a locally generated value.
2. Start the application and database:

   ```bash
   docker compose up --build
   ```

3. Open `http://localhost:8080`.

The backend health endpoint is available at `http://localhost:8080/health`.

## Verification

```bash
pnpm --filter @orbis/frontend typecheck
pnpm --filter @orbis/frontend test
pnpm --filter @orbis/frontend build
pnpm --filter @orbis/backend typecheck
pnpm --filter @orbis/backend build
```

The package names currently retain the internal workspace identifiers used by the build configuration. They do not change the Orbis product name.

## Collector deployment

Collectors run inside the customer network and send authenticated discovery results to Orbis. Deployment templates are provided for Docker, Linux, Windows, and virtual appliance workflows under `deploy/collector/`. Generated installers and release archives are intentionally excluded from Git; the release workflow builds them when required.

## Security

Never commit `.env` files, credentials, private keys, database dumps, uploads, local databases, or generated release packages. Use the example environment files as templates only. Production deployments must provide unique secrets, HTTPS, a restricted CORS policy, a configured integration encryption key, and a secure email/SSO configuration.

## Repository workflow

- `main` is the protected production branch.
- `develop` is the integration branch.
- Work is performed on short-lived branches such as `feat/discovery-import` or `fix/alert-refresh`.
- Feature branches are pushed first and merged into `develop` with Conventional Commits.
- Production releases are promoted to `main` separately.

## License

Orbis is proprietary software owned by ELMcode. See [LICENSE](LICENSE). No right to use, copy, modify, distribute, or sublicense the source code is granted without prior written permission.
