# Ship It Shop agents

Two AI SDK agents for the Ship It Shop storefront, built for the Vercel Agent Foundations certification. Store data comes from the live Vercel Swag Store API.

Live demo: https://ship-it-shop-k7q2.vercel.app

- The shopping agent runs in the storefront side panel. It searches the catalog, shows product cards, looks up orders and starts returns.
- The admin agent at `/admin` reads support tickets, returns, stock and sales. It computes joins and rates in a Vercel Sandbox and remembers the admin's definitions.

## Features

| Area | What it does |
|---|---|
| Shopping tools | `searchProducts`, `getAllCategories`, `getProductDetails`, `getOrderDetails`, `returnOrder` |
| Generative UI | Each tool state has its own card: loading, result, empty, not found, error |
| Durable chat | Each chat turn runs as a workflow. A page refresh reconnects to the running turn |
| Return workflow | Checks the order, preauthorizes the refund, files the return, waits for the decision webhook and polls as a fallback |
| Admin tools | `getSupportTickets`, `getReturnsHistory`, `getInventoryStock`, `getSalesAnalytics`, catalog search |
| Sandbox | `loadStoreData` copies store data into a sandbox with no network access. `bash` runs joins and rates there |
| Memory | `saveMemory` keeps dated definitions in the sandbox. Each new admin chat reads them |

## Stack

- Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4, shadcn/ui, AI Elements
- AI SDK 7 with `WorkflowAgent` from `@ai-sdk/workflow`, Workflow DevKit (`workflow@5`)
- `@vercel/sandbox` for the admin agent
- Model through the Vercel AI Gateway, or an OpenAI-compatible gateway for development (`lib/ai/gateway.ts`)
- pnpm

## Getting started

Requirements: Node.js 24 and pnpm.

```bash
pnpm install
cp .env.example .env.local    # fill in BYPASS_SECRET, ADMIN_PASSWORD and the model settings
pnpm dev
```

The admin sandbox needs a Vercel OIDC token. Link a Vercel project, then pull the token into a separate file:

```bash
vercel link
vercel env pull .env.sandbox.local --yes
set -a; source .env.sandbox.local; set +a; pnpm dev
```

The token expires after 12 hours. Without it, the admin agent works without the sandbox and memory and says so.

## Environment variables

| Name | Required | Purpose |
|---|---|---|
| `BYPASS_SECRET` | yes | Store API access. Server-side only |
| `ADMIN_PASSWORD` | yes | Password for `/admin`. Without it, admin sign-in fails |
| `API_BASE_URL` | no | Store API base URL |
| `MODEL_GATEWAY` | no | `vercel` (default) or `ica` |
| `VERCEL_GATEWAY_MODEL` | for `vercel` | Model id, for example `anthropic/claude-sonnet-5.5` |
| `AI_GATEWAY_API_KEY` | local only | AI Gateway key. On Vercel the OIDC token is used |
| `ICA_GATEWAY_URL`, `ICA_GATEWAY_API_KEY`, `ICA_GATEWAY_MODEL` | for `ica` | OpenAI-compatible gateway |
| `ADMIN_SANDBOX_NAME` | no | Sandbox base name. The Vercel environment is appended |
| `NEXT_PUBLIC_SITE_URL` | no | Public site URL for metadata and Open Graph links. Defaults to `http://localhost:3000` |

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build`, `pnpm start` | Production build and server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Route types and `tsc --noEmit` |
| `pnpm test:secrets` | Secret leak test (see Tests) |
| `pnpm test:failures` | Failure tests (see Tests) |

## Demo data

The store API provides all data. The app adds none.

| Order | Status | Items | Return possible |
|---|---|---|---|
| `11111` | fulfilled | 1x Black Pullover Hoodie, 1x Black Desk Mat | yes |
| `22222` | fulfilled | 2x Black Crewneck T-Shirt, 1x Glossy Black Ceramic Mug | yes |
| `33333` | fulfilled | 1x Minimal Black Backpack, 1x Matte Black Stainless Steel Water Bottle, 2x Black Crew Socks | yes |
| `44444` | paid | 1x Black Wireless Charger Pad, 1x Black Phone Case | no, not shipped |
| `55555` | cancelled | 1x Black Hardcover Book (Blank Cover), 2x Black Click Pen | no |

- Any other order id returns "not found".
- The API decides each return (approved, rejected or needs info). Returns filed in the demo stay in the shared demo API.
- The back-office endpoints give the admin agent support tickets, returns history, stock for 28 products and daily sales.

Example prompts:

- Shop: "Show me black hoodies", "What is the status of order 11111?", "I want to return the mug from order 22222"
- Admin: "Which urgent support tickets are open?", "Which products have the highest return rates over the last 90 days?", "Remember: return rate means returned units divided by units sold over 90 days"

## Admin access

Sign in at `/admin/login` with the value of `ADMIN_PASSWORD`. The cookie holds an HMAC of the password. The proxy, the admin page and the admin API routes all check it in constant time.

## Tests

Both suites run against a production server and call the real model and store API.

```bash
pnpm build
set -a; source .env.sandbox.local; set +a; pnpm start -p 3006
pnpm test:secrets     # second shell
pnpm test:failures
```

- `test:secrets` sends prompt-injection turns to both agents and checks the full streams for the admin password, `BYPASS_SECRET`, gateway keys and the OIDC token. It also scans the client bundles, prerendered pages and stored workflow data. It checks that the shopping agent never calls an admin tool and that admin routes reject requests without the cookie.
- `test:failures` covers invalid JSON, invalid messages, oversized bodies, bad run ids, a missing order and an empty search. For the API-down case, start a second server with `API_BASE_URL=http://127.0.0.1:9 pnpm start -p 3005` and set `API_DOWN_BASE_URL=http://localhost:3005`.
- Set `BASE_URL` to test a different server. The default is `http://localhost:3006`.

## Project structure

```
app/
  (store)/                 storefront: home, search, product pages
  admin/                   admin login and admin chat
  api/chat/                shopping chat: POST starts a turn, [id]/stream reconnects
  api/admin/chat/          admin chat, same shape, admin cookie required
lib/
  ai/gateway.ts            chat model for both gateways
  agent.ts, tools.ts       shopping instructions and tools
  admin-agent.ts           admin instructions and memory block
  admin-tools.ts           read-only back-office tools
  admin-sandbox*.ts        sandbox access, sandbox tools, memory
  workflows/               chat, admin chat and return workflows
  chat/route-helpers.ts    request checks, run start, reconnect
  tool-guard.ts            maps API failures to safe messages
  api.ts                   store API client (server-only)
components/
  durable-chat.tsx         chat client with refresh resume
  agent-ui/                tool cards for both agents
scripts/                   gateway smoke test and the test suites
```

## Security

- Secrets stay on the server. Client code gets only UI messages and tool outputs.
- The shopping agent and the admin agent have separate tool sets, workflows and routes. The public reconnect route serves only shopping runs.
- The sandbox has no network access and holds no secrets. Memory notes are cleaned before they go into the prompt.
- Chat images load only from the store's blob storage, and links that leave the shop open in a new tab.

Known limits of the demo:

- The store API has no customer accounts. Anyone who knows an order id can look up that order and start a return.
- The public chat has no rate limit. Add a Vercel Firewall rate limit rule before you open the app to traffic.
- The client sends the chat history with each turn, so a client can change earlier assistant messages. Tools check every input on the server again.

## Deployment

Deploy to Vercel with Node.js 24 and set `BYPASS_SECRET`, `ADMIN_PASSWORD`, `MODEL_GATEWAY=vercel` and `VERCEL_GATEWAY_MODEL`. On Vercel, the AI Gateway and the sandbox authenticate with the project's OIDC token.

The live demo runs `nvidia/nemotron-3.5-lightning-free` on the AI Gateway free tier. Development used Claude Sonnet 5.5, which handles the multi-step admin questions more reliably.
