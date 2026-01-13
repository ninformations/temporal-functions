# Temporal Functions

A lightweight TypeScript framework that provides a **lambda-like developer experience** on top of **Temporal's durable execution engine**.

Write only function bodies and trigger bindings — the framework handles all Temporal boilerplate (workers, activities, workflows, serialization).

## Why Temporal Functions?

| Aspect | Lambda/Serverless | Raw Temporal | Temporal Functions |
|--------|-------------------|--------------|-------------------|
| Function definition | Simple | Verbose | Simple |
| Durable execution | No | Yes | Yes |
| Retries/timeouts | Limited | Powerful | Powerful |
| Worker management | Managed | Manual | Abstracted |
| Type safety | Varies | Yes | Yes |

## Quick Example

```typescript
import { tfn } from 'temporal-functions';

// Define functions (activities)
export const validateOrder = tfn.fn('validateOrder', async (order: Order) => {
  // validation logic
});

export const chargePayment = tfn.fn('chargePayment', async (order: ValidatedOrder) => {
  // payment logic
});

// Define workflow
export const processOrder = tfn.workflow('processOrder', async (ctx, order: Order) => {
  const validated = await ctx.run(validateOrder, order);
  const paid = await ctx.run(chargePayment, validated);
  return { orderId: paid.id, status: 'complete' };
});
```

**That's it.** No worker setup, no activity proxies, no boilerplate.

## Key Principles

1. **Lambda-like DX** — Write functions, not infrastructure
2. **Temporal underneath** — Get durability, retries, exactly-once semantics for free
3. **TypeScript native** — Full type safety, great IDE support
4. **Client-Worker separation** — Scale triggers and executors independently
5. **Minimal abstraction** — Thin layer, not a new platform

## Installation

```bash
npm install temporal-functions
```

## Usage

### Define Functions

```typescript
import { tfn } from 'temporal-functions';

export const sendEmail = tfn.fn(
  'sendEmail',
  async (params: EmailParams): Promise<EmailResult> => {
    return await emailService.send(params);
  },
  {
    timeout: '30s',
    retries: 3,
  }
);
```

### Define Workflows

```typescript
export const processOrder = tfn.workflow(
  'processOrder',
  async (ctx, order: Order) => {
    const validated = await ctx.run(validateOrder, order);

    // Parallel execution
    const [inventory, pricing] = await Promise.all([
      ctx.run(checkInventory, validated.items),
      ctx.run(calculatePricing, validated.items),
    ]);

    // Durable sleep
    await ctx.sleep('5 minutes');

    const payment = await ctx.run(processPayment, {
      amount: pricing.total,
      orderId: order.id,
    });

    return { orderId: order.id, status: 'complete' };
  }
);
```

### Client (Trigger Workflows)

```typescript
import { tfn } from 'temporal-functions/client';
import { processOrder } from '@myproject/functions';

const client = tfn.client({
  temporal: {
    address: 'localhost:7233',
    namespace: 'default',
  },
  taskQueue: 'orders',
});

// Fire and wait
const result = await client.invoke(processOrder, order);

// Fire and forget
const handle = await client.start(processOrder, order, {
  workflowId: `order-${order.id}`,
});
```

### Worker (Execute Functions)

```typescript
import { tfn } from 'temporal-functions/worker';
import { validateOrder, chargePayment, processOrder } from '@myproject/functions';

const worker = tfn.worker({
  temporal: {
    address: 'localhost:7233',
    namespace: 'default',
  },
  taskQueue: 'orders',
});

worker.register(validateOrder);
worker.register(chargePayment);
worker.register(processOrder);

await worker.start();
```

## Triggers

```typescript
// HTTP
tfn.http('POST', '/api/orders', processOrder);

// Cron
tfn.cron('0 9 * * *', dailyReport);

// Signal
tfn.signal('order.cancel', handleCancellation);
```

## Project Structure

```
my-project/
├── packages/
│   ├── functions/          # Shared function definitions
│   │   └── src/
│   │       ├── orders/
│   │       └── notifications/
│   ├── worker/             # Worker service
│   │   └── src/index.ts
│   └── api/                # API/Client service
│       └── src/index.ts
└── package.json
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TEMPORAL FUNCTIONS                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   SHARED: Function Definitions                               │
│   tfn.fn()    tfn.workflow()    Types & Interfaces          │
│                                                              │
│        │                              │                      │
│        ▼                              ▼                      │
│   ┌──────────────┐            ┌──────────────┐              │
│   │    CLIENT    │            │    WORKER    │              │
│   │  Lightweight │            │   Full SDK   │              │
│   │    ~20KB     │            │    ~2MB      │              │
│   │              │            │              │              │
│   │  • start()   │            │  • register()│              │
│   │  • invoke()  │            │  • start()   │              │
│   │  • signal()  │            │              │              │
│   └──────┬───────┘            └──────┬───────┘              │
│          │                           │                       │
│          └───────────┬───────────────┘                       │
│                      ▼                                       │
│            ┌─────────────────┐                               │
│            │ TEMPORAL CLUSTER │                               │
│            └─────────────────┘                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Documentation

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture document.

## Status

**Design Phase** — This project is currently in the design and early implementation phase.

## License

MIT
