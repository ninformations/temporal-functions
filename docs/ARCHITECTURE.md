# Temporal Functions VM - Architecture Document

> **Version**: 1.0  
> **Last Updated**: January 2026  
> **Status**: Design Phase

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Design Philosophy](#3-design-philosophy)
4. [Architecture Overview](#4-architecture-overview)
5. [Core Concepts](#5-core-concepts)
6. [Client-Worker Separation](#6-client-worker-separation)
7. [Function Definitions](#7-function-definitions)
8. [Trigger System](#8-trigger-system)
9. [Runtime Execution](#9-runtime-execution)
10. [Developer Experience](#10-developer-experience)
11. [Deployment Patterns](#11-deployment-patterns)
12. [Implementation Roadmap](#12-implementation-roadmap)
13. [Technical Decisions](#13-technical-decisions)
14. [Open Questions](#14-open-questions)

---

## 1. Executive Summary

### What We're Building

**Temporal Functions** is a lightweight TypeScript framework that provides a **lambda-like developer experience** on top of **Temporal's durable execution engine**. Developers write only function bodies and trigger bindings - the framework handles all Temporal boilerplate (workers, activities, workflows, serialization).

### The One-Liner

```typescript
// This is ALL you write:
export const processOrder = tfn.workflow('processOrder', async (ctx, order) => {
  const validated = await ctx.run(validateOrder, order);
  const paid = await ctx.run(chargePayment, validated);
  return { orderId: order.id, status: 'complete' };
});
```

### Key Principles

1. **Lambda-like DX** - Write functions, not infrastructure
2. **Temporal underneath** - Get durability, retries, exactly-once semantics for free
3. **TypeScript native** - Full type safety, great IDE support
4. **Client-Worker separation** - Scale triggers and executors independently
5. **Minimal abstraction** - Thin layer, not a new platform

---

## 2. Problem Statement

### Current State: Raw Temporal SDK

Writing a simple workflow with Temporal requires significant boilerplate:

```typescript
// activities.ts - Define activities
import { proxyActivities } from '@temporalio/workflow';

export async function validateOrder(order: Order): Promise<ValidatedOrder> {
  // validation logic
}

export async function chargePayment(order: ValidatedOrder): Promise<PaidOrder> {
  // payment logic
}

// workflows.ts - Define workflow
import * as activities from './activities';

const { validateOrder, chargePayment } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

export async function processOrderWorkflow(order: Order): Promise<Result> {
  const validated = await validateOrder(order);
  const paid = await chargePayment(validated);
  return { orderId: paid.id };
}

// worker.ts - Setup worker
import { Worker } from '@temporalio/worker';
import * as activities from './activities';

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: 'orders',
  });
  await worker.run();
}

// client.ts - Start workflow
import { Client } from '@temporalio/client';

async function startOrder(order: Order) {
  const client = new Client();
  const handle = await client.workflow.start('processOrderWorkflow', {
    taskQueue: 'orders',
    workflowId: `order-${order.id}`,
    args: [order],
  });
  return handle.result();
}
```

**Lines of code**: ~80+ for a simple 2-step workflow

### Desired State: Lambda-like

```typescript
// functions/orders.ts
import { tfn } from 'temporal-functions';

export const validateOrder = tfn.fn('validateOrder', async (order: Order) => {
  // validation logic
});

export const chargePayment = tfn.fn('chargePayment', async (order: ValidatedOrder) => {
  // payment logic
});

export const processOrder = tfn.workflow('processOrder', async (ctx, order: Order) => {
  const validated = await ctx.run(validateOrder, order);
  const paid = await ctx.run(chargePayment, validated);
  return { orderId: paid.id };
});
```

**Lines of code**: ~15 for the same functionality

### Gap Analysis

| Aspect | Lambda/Serverless | Raw Temporal | Temporal Functions |
|--------|-------------------|--------------|-------------------|
| Function definition | ✅ Simple | ❌ Verbose | ✅ Simple |
| Durable execution | ❌ No | ✅ Yes | ✅ Yes |
| Retries/timeouts | ❌ Limited | ✅ Powerful | ✅ Powerful |
| Worker management | ✅ Managed | ❌ Manual | ✅ Abstracted |
| Type safety | ⚠️ Varies | ✅ Yes | ✅ Yes |
| Local development | ⚠️ Hard | ✅ Good | ✅ Great |

---

## 3. Design Philosophy

### Core Beliefs

1. **Temporal is the right foundation** - Don't reinvent durable execution
2. **Abstraction, not replacement** - Build on top of Temporal SDK, don't hide it
3. **TypeScript first** - Leverage the type system fully
4. **Convention over configuration** - Sensible defaults, escape hatches when needed
5. **Separation of concerns** - Clients trigger, workers execute

### What We're NOT Building

- ❌ A new workflow engine
- ❌ A complex microservices platform
- ❌ A Kubernetes operator (initially)
- ❌ A managed cloud service
- ❌ A replacement for Temporal

### What We ARE Building

- ✅ A thin TypeScript framework (~500-1000 lines)
- ✅ Developer ergonomics layer
- ✅ Auto-generation of Temporal constructs
- ✅ Flexible trigger system
- ✅ Clean client-worker separation

---

## 4. Architecture Overview

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TEMPORAL FUNCTIONS                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    SHARED: Function Definitions                      │    │
│  │                                                                      │    │
│  │   tfn.fn()          tfn.workflow()         Types & Interfaces       │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                          │                          │                        │
│            ┌─────────────┴──────────┐   ┌──────────┴─────────────┐          │
│            ▼                        │   │                        ▼          │
│  ┌──────────────────────┐          │   │          ┌──────────────────────┐  │
│  │   CLIENT PACKAGE     │          │   │          │   WORKER PACKAGE     │  │
│  │                      │          │   │          │                      │  │
│  │  temporal-functions  │          │   │          │  temporal-functions  │  │
│  │      /client         │          │   │          │      /worker         │  │
│  │                      │          │   │          │                      │  │
│  │  • start()           │          │   │          │  • register()        │  │
│  │  • invoke()          │          │   │          │  • start()           │  │
│  │  • signal()          │          │   │          │  • Executes code     │  │
│  │  • query()           │          │   │          │                      │  │
│  │                      │          │   │          │                      │  │
│  │  Lightweight ~20KB   │          │   │          │  Full SDK ~2MB       │  │
│  └──────────┬───────────┘          │   │          └──────────┬───────────┘  │
│             │                      │   │                     │              │
│             │                      │   │                     │              │
│             └──────────────────────┼───┼─────────────────────┘              │
│                                    │   │                                    │
│                                    ▼   ▼                                    │
│                        ┌─────────────────────────┐                          │
│                        │    TEMPORAL CLUSTER     │                          │
│                        │   (Cloud or Self-host)  │                          │
│                        └─────────────────────────┘                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Package Structure

```
temporal-functions/
├── package.json
├── src/
│   ├── index.ts              # Shared: fn(), workflow(), types
│   ├── client/
│   │   └── index.ts          # Client: start(), invoke(), signal()
│   ├── worker/
│   │   └── index.ts          # Worker: register(), start()
│   └── types.ts              # Shared type definitions
```

### Exports

```typescript
// Main package - function definitions
import { tfn } from 'temporal-functions';
tfn.fn(...)
tfn.workflow(...)

// Client package - lightweight, for triggering
import { tfn } from 'temporal-functions/client';
tfn.client({...})

// Worker package - full implementation
import { tfn } from 'temporal-functions/worker';
tfn.worker({...})
```

---

## 5. Core Concepts

### 5.1 Functions (Activities)

A **Function** is a single unit of work that:
- Has a unique name
- Takes typed input, returns typed output
- Is automatically registered as a Temporal Activity
- Can be called from workflows via `ctx.run()`

```typescript
// Definition
export const sendEmail = tfn.fn(
  'sendEmail',  // Unique identifier
  async (params: EmailParams): Promise<EmailResult> => {
    // Implementation
    return await emailService.send(params);
  },
  {
    // Optional configuration
    timeout: '30s',
    retries: 3,
  }
);

// Usage in workflow
const result = await ctx.run(sendEmail, { to: 'user@example.com', ... });
```

### 5.2 Workflows

A **Workflow** is a durable orchestration that:
- Coordinates multiple functions
- Survives failures and restarts
- Has exactly-once execution guarantees
- Can run for seconds to years

```typescript
export const processOrder = tfn.workflow(
  'processOrder',  // Unique identifier
  async (ctx: WorkflowContext, order: Order) => {
    // Each ctx.run() is a durable step
    const validated = await ctx.run(validateOrder, order);
    
    // Can use workflow primitives
    await ctx.sleep('5 minutes');
    
    const paid = await ctx.run(chargePayment, validated);
    
    return { orderId: paid.id, status: 'complete' };
  },
  {
    // Optional configuration
    taskQueue: 'orders',
  }
);
```

### 5.3 Workflow Context

The `ctx` object provides workflow capabilities:

```typescript
interface WorkflowContext {
  // Run a function (activity)
  run<I, O>(fn: FunctionDef<I, O>, input: I): Promise<O>;
  
  // Sleep for duration
  sleep(duration: string | number): Promise<void>;
  
  // Get current workflow time
  now(): Date;
  
  // Start a child workflow
  startChild<I, O>(workflow: WorkflowDef<I, O>, input: I): Promise<O>;
  
  // Continue as new (for long-running workflows)
  continueAsNew<I>(input: I): Promise<never>;
  
  // Workflow info
  info: {
    workflowId: string;
    runId: string;
    taskQueue: string;
  };
}
```

### 5.4 Triggers

**Triggers** define how workflows are started:

```typescript
// HTTP Trigger
tfn.http('POST', '/api/orders', processOrder);

// Cron Trigger
tfn.cron('0 9 * * *', dailyReport);

// Signal Trigger
tfn.signal('order.cancel', handleCancellation);

// Event Trigger (future)
tfn.event('kafka', 'user.created', handleUserCreated);
```

---

## 6. Client-Worker Separation

### Why Separate?

| Concern | Client | Worker |
|---------|--------|--------|
| **Purpose** | Trigger workflows | Execute functions |
| **Scaling** | Scale with API traffic | Scale with workload |
| **Dependencies** | Minimal (~20KB) | Full SDK (~2MB) |
| **Deployment** | Serverless-friendly | Dedicated hosts |
| **Failure domain** | API availability | Execution capacity |

### Client Implementation

```typescript
// packages/api/src/client.ts
import { tfn } from 'temporal-functions/client';
import { processOrder } from '@myproject/functions';

// Create client instance
const client = tfn.client({
  temporal: {
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    namespace: 'production',
  },
  taskQueue: 'orders',
});

// API route handler
export async function createOrder(req: Request) {
  const order = await req.json();
  
  // Option 1: Fire and wait
  const result = await client.invoke(processOrder, order);
  return Response.json(result);
  
  // Option 2: Fire and forget
  const handle = await client.start(processOrder, order, {
    workflowId: `order-${order.id}`,  // Idempotent
  });
  return Response.json({ 
    workflowId: handle.workflowId,
    status: 'started' 
  });
}

// Check status
export async function getOrderStatus(workflowId: string) {
  const handle = client.getHandle(workflowId);
  const status = await handle.query('status');
  return Response.json({ status });
}

// Send signal
export async function cancelOrder(workflowId: string) {
  await client.signal(workflowId, 'cancel', { reason: 'user_requested' });
  return Response.json({ cancelled: true });
}
```

### Worker Implementation

```typescript
// packages/worker/src/index.ts
import { tfn } from 'temporal-functions/worker';

// Import function implementations
import { 
  validateOrder,
  chargePayment,
  sendConfirmation,
  processOrder,
} from '@myproject/functions';

async function main() {
  const worker = tfn.worker({
    temporal: {
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      namespace: 'production',
    },
    taskQueue: 'orders',
    // Optional: worker-specific config
    maxConcurrentActivities: 100,
    maxConcurrentWorkflows: 50,
  });

  // Register functions
  worker.register(validateOrder);
  worker.register(chargePayment);
  worker.register(sendConfirmation);
  worker.register(processOrder);

  // Or register entire modules
  // worker.registerModule(require('@myproject/functions'));

  console.log('Worker starting on task queue: orders');
  await worker.start();
}

main().catch(console.error);
```

### Project Structure

```
my-project/
├── packages/
│   │
│   ├── functions/                 # Shared definitions
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts          # Export all functions
│   │   │   ├── orders/
│   │   │   │   ├── validate.ts
│   │   │   │   ├── payment.ts
│   │   │   │   └── workflow.ts
│   │   │   └── notifications/
│   │   │       └── email.ts
│   │   └── tsconfig.json
│   │
│   ├── worker/                    # Worker service
│   │   ├── package.json
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── tsconfig.json
│   │
│   └── api/                       # API/Client service
│       ├── package.json
│       ├── src/
│       │   ├── index.ts
│       │   └── routes/
│       │       └── orders.ts
│       └── tsconfig.json
│
├── package.json                   # Monorepo root
├── pnpm-workspace.yaml
└── turbo.json
```

### Deployment Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRODUCTION DEPLOYMENT                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   CLIENTS (Trigger Layer)              WORKERS (Execution Layer)            │
│                                                                              │
│   ┌─────────────────────┐             ┌─────────────────────────────────┐   │
│   │   API Service       │             │   Order Workers                  │   │
│   │   (Vercel/Fly.io)   │             │   (3-10 replicas, auto-scale)   │   │
│   │                     │             │                                  │   │
│   │   • Next.js API     │             │   ┌─────┐ ┌─────┐ ┌─────┐       │   │
│   │   • Express         │             │   │ W1  │ │ W2  │ │ W3  │ ...   │   │
│   │   • Webhooks        │             │   └──┬──┘ └──┬──┘ └──┬──┘       │   │
│   └─────────┬───────────┘             └──────┼──────┼──────┼────────────┘   │
│             │                                │      │      │                │
│   ┌─────────┴───────────┐             ┌──────┴──────┴──────┴────────────┐   │
│   │   Cron Service      │             │   Notification Workers          │   │
│   │   (Single replica)  │             │   (2-5 replicas)                │   │
│   │                     │             │                                  │   │
│   │   • Scheduled jobs  │             │   ┌─────┐ ┌─────┐               │   │
│   │   • Temporal Sched. │             │   │ W1  │ │ W2  │               │   │
│   └─────────┬───────────┘             └───┴──┬──┴─┴──┬──┴───────────────┘   │
│             │                                │      │                       │
│             └────────────────┬───────────────┴──────┘                       │
│                              │                                              │
│                              ▼                                              │
│             ┌────────────────────────────────────┐                          │
│             │         TEMPORAL CLUSTER           │                          │
│             │      (Temporal Cloud / K8s)        │                          │
│             │                                    │                          │
│             │  ┌──────┐ ┌──────┐ ┌──────┐       │                          │
│             │  │ FE   │ │ Hist │ │ Match│       │                          │
│             │  └──────┘ └──────┘ └──────┘       │                          │
│             └────────────────────────────────────┘                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Function Definitions

### Basic Function

```typescript
import { tfn } from 'temporal-functions';

// Simple function
export const greet = tfn.fn(
  'greet',
  async (name: string): Promise<string> => {
    return `Hello, ${name}!`;
  }
);
```

### Function with Options

```typescript
export const processPayment = tfn.fn(
  'processPayment',
  async (payment: PaymentRequest): Promise<PaymentResult> => {
    const result = await stripe.charges.create({
      amount: payment.amount,
      currency: payment.currency,
    });
    return { chargeId: result.id, status: 'success' };
  },
  {
    // Temporal activity options
    startToCloseTimeout: '30s',
    heartbeatTimeout: '10s',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 2,
      initialInterval: '1s',
      maximumInterval: '30s',
    },
  }
);
```

### Workflow Definition

```typescript
export const processOrder = tfn.workflow(
  'processOrder',
  async (ctx, order: Order): Promise<OrderResult> => {
    // Step 1: Validate
    const validated = await ctx.run(validateOrder, order);
    
    // Step 2: Check inventory (parallel)
    const [inventory, pricing] = await Promise.all([
      ctx.run(checkInventory, validated.items),
      ctx.run(calculatePricing, validated.items),
    ]);
    
    // Step 3: Process payment
    const payment = await ctx.run(processPayment, {
      amount: pricing.total,
      orderId: order.id,
    });
    
    // Step 4: Send confirmation (fire and forget)
    ctx.run(sendConfirmation, { order, payment }).catch(() => {});
    
    return {
      orderId: order.id,
      status: 'complete',
      chargeId: payment.chargeId,
    };
  },
  {
    taskQueue: 'orders',
  }
);
```

### Workflow with Signals and Queries

```typescript
export const orderWithCancellation = tfn.workflow(
  'orderWithCancellation',
  async (ctx, order: Order) => {
    let cancelled = false;
    let status = 'processing';
    
    // Handle cancellation signal
    ctx.onSignal('cancel', (reason: string) => {
      cancelled = true;
      status = 'cancelled';
    });
    
    // Handle status query
    ctx.onQuery('status', () => status);
    
    // Process steps
    const validated = await ctx.run(validateOrder, order);
    if (cancelled) return { status: 'cancelled' };
    
    status = 'charging';
    const payment = await ctx.run(processPayment, validated);
    if (cancelled) {
      await ctx.run(refundPayment, payment);
      return { status: 'cancelled' };
    }
    
    status = 'complete';
    return { orderId: order.id, status: 'complete' };
  }
);
```

---

## 8. Trigger System

### HTTP Triggers

```typescript
// Simple HTTP trigger
tfn.http('POST', '/api/orders', processOrder);

// With middleware/options
tfn.http('POST', '/api/orders', processOrder, {
  // Custom workflow ID from request
  workflowId: (req) => `order-${req.body.id}`,
  // Async mode - return immediately
  async: true,
  // Auth middleware
  middleware: [authMiddleware],
});
```

### Schedule/Cron Triggers

```typescript
// Cron expression
tfn.cron('0 9 * * *', dailyReport);  // Every day at 9am

// With options
tfn.cron('*/15 * * * *', healthCheck, {
  overlap: false,  // Don't start if previous still running
  timezone: 'America/New_York',
});

// Interval-based
tfn.interval('5m', syncData);  // Every 5 minutes
```

### Signal Triggers

```typescript
// Define signal handler
tfn.signal('order.cancel', handleOrderCancellation);

// Signal an existing workflow
await client.signal(workflowId, 'order.cancel', { reason: 'user_requested' });
```

### Event Triggers (Future)

```typescript
// NATS
tfn.event('nats', 'orders.created', handleOrderCreated);

// Kafka
tfn.event('kafka', 'user-events', handleUserEvent, {
  consumerGroup: 'order-service',
});

// Redis Streams
tfn.event('redis', 'events:orders', handleOrderEvent);
```

---

## 9. Runtime Execution

### How It Works Under the Hood

```
┌─────────────────────────────────────────────────────────────────────┐
│                       FRAMEWORK INTERNALS                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  YOUR CODE                        GENERATED TEMPORAL CODE            │
│                                                                      │
│  ┌──────────────────┐            ┌──────────────────────────────┐   │
│  │ tfn.fn(          │            │ // Activity                   │   │
│  │   'validateOrder'│   ──────▶  │ export async function         │   │
│  │   async (order)  │            │ validateOrder(order: Order) { │   │
│  │   => {...}       │            │   return impl(order);         │   │
│  │ )                │            │ }                             │   │
│  └──────────────────┘            └──────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────┐            ┌──────────────────────────────┐   │
│  │ tfn.workflow(    │            │ // Workflow                   │   │
│  │   'processOrder' │   ──────▶  │ export async function         │   │
│  │   async (ctx, o) │            │ processOrder(order: Order) {  │   │
│  │   => {...}       │            │   const acts = proxyActivities│   │
│  │ )                │            │   return impl(ctx, order);    │   │
│  └──────────────────┘            │ }                             │   │
│                                  └──────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────┐            ┌──────────────────────────────┐   │
│  │ tfn.worker({     │            │ Worker.create({               │   │
│  │   ...            │   ──────▶  │   activities: {...},          │   │
│  │ }).start()       │            │   workflowsPath: '...',       │   │
│  └──────────────────┘            │ }).run()                      │   │
│                                  └──────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Worker Startup Sequence

```typescript
// What happens when you call worker.start()

async function start() {
  // 1. Collect all registered functions
  const activities = {};
  for (const [name, def] of registry.functions) {
    activities[name] = def.handler;
  }
  
  // 2. Generate workflow wrappers
  const workflowsPath = generateWorkflowModule(registry.workflows);
  
  // 3. Create Temporal worker
  const worker = await Worker.create({
    connection: await NativeConnection.connect({
      address: options.temporal.address,
    }),
    namespace: options.temporal.namespace,
    taskQueue: options.taskQueue,
    activities,
    workflowsPath,
  });
  
  // 4. Start polling
  await worker.run();
}
```

### Workflow Context Implementation

```typescript
// How ctx.run() works

function createWorkflowContext(): WorkflowContext {
  // Proxy all registered activities
  const activities = proxyActivities({
    startToCloseTimeout: '1 minute',
  });
  
  return {
    async run(fn, input) {
      // Look up the activity by function name
      const activity = activities[fn.name];
      if (!activity) {
        throw new Error(`Function ${fn.name} not registered`);
      }
      return activity(input);
    },
    
    async sleep(duration) {
      return workflow.sleep(duration);
    },
    
    now() {
      return new Date(workflow.now());
    },
    
    get info() {
      return workflow.workflowInfo();
    },
  };
}
```

---

## 10. Developer Experience

### CLI Commands

```bash
# Initialize new project
npx tfn init my-project

# Create new function
npx tfn new:fn validateOrder --path functions/orders

# Create new workflow
npx tfn new:workflow processOrder --path functions/orders

# Local development (hot reload)
npx tfn dev

# Build for production
npx tfn build

# Start production worker
npx tfn start:worker

# Start production client/API
npx tfn start:api
```

### Local Development

```bash
$ npx tfn dev

  ╔═══════════════════════════════════════════════════════╗
  ║           Temporal Functions - Dev Mode               ║
  ╠═══════════════════════════════════════════════════════╣
  ║  Temporal: localhost:7233                             ║
  ║  Task Queue: default                                  ║
  ║  HTTP Server: http://localhost:3000                   ║
  ╚═══════════════════════════════════════════════════════╝

  Functions loaded:
    • validateOrder (activity)
    • chargePayment (activity)
    • sendEmail (activity)
    • processOrder (workflow)
    • dailyReport (workflow)

  Triggers active:
    • POST /api/orders → processOrder
    • CRON 0 9 * * * → dailyReport

  Watching for changes...
```

### Testing

```typescript
// functions/orders.test.ts
import { tfn } from 'temporal-functions/testing';
import { processOrder, validateOrder } from './orders';

describe('processOrder', () => {
  it('should process a valid order', async () => {
    // Create test environment
    const env = await tfn.testEnv();
    
    // Mock activities if needed
    env.mock(chargePayment, async (order) => ({
      chargeId: 'test-charge',
    }));
    
    // Execute workflow
    const result = await env.execute(processOrder, {
      id: '123',
      items: [{ sku: 'ABC', qty: 1 }],
    });
    
    expect(result.status).toBe('complete');
    expect(result.orderId).toBe('123');
  });
  
  it('should handle cancellation', async () => {
    const env = await tfn.testEnv();
    
    // Start workflow
    const handle = await env.start(processOrder, order);
    
    // Send signal
    await handle.signal('cancel', { reason: 'test' });
    
    // Wait for result
    const result = await handle.result();
    expect(result.status).toBe('cancelled');
  });
});
```

---

## 11. Deployment Patterns

### Pattern 1: Single Process (Development/Simple)

```bash
# Everything in one process
npx tfn start --mode all
```

```
┌─────────────────────────────────────┐
│         Single Process              │
│  [API] [Worker] [Triggers]          │
└─────────────────────────────────────┘
```

### Pattern 2: Separated Services (Production)

```bash
# Separate processes
npx tfn start --mode api      # API/triggers
npx tfn start --mode worker   # Workers
```

```
┌──────────────┐    ┌──────────────┐
│     API      │    │   Workers    │
│  (1 replica) │    │ (N replicas) │
└──────┬───────┘    └──────┬───────┘
       │                   │
       └─────────┬─────────┘
                 ▼
       ┌─────────────────┐
       │    Temporal     │
       └─────────────────┘
```

### Pattern 3: Multi-Queue (Scaling)

```typescript
// workers/critical.ts
const worker = tfn.worker({ taskQueue: 'critical' });
worker.register(processPayment);
worker.register(processOrder);

// workers/batch.ts  
const worker = tfn.worker({ taskQueue: 'batch' });
worker.register(generateReport);
worker.register(syncData);
```

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Critical   │    │   Critical   │    │    Batch     │
│   Worker     │    │   Worker     │    │   Worker     │
│  (priority)  │    │  (priority)  │    │  (low pri)   │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └─────────────────┬─┴───────────────────┘
                         ▼
               ┌─────────────────┐
               │    Temporal     │
               └─────────────────┘
```

### Docker Compose Example

```yaml
# docker-compose.yml
version: '3.8'

services:
  temporal:
    image: temporalio/auto-setup:latest
    ports:
      - "7233:7233"
  
  temporal-ui:
    image: temporalio/ui:latest
    ports:
      - "8080:8080"
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
  
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "3000:3000"
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
    depends_on:
      - temporal
  
  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
    depends_on:
      - temporal
    deploy:
      replicas: 3
```

### Kubernetes Example

```yaml
# k8s/worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-workers
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-worker
  template:
    metadata:
      labels:
        app: order-worker
    spec:
      containers:
        - name: worker
          image: myapp/worker:latest
          env:
            - name: TEMPORAL_ADDRESS
              value: temporal.temporal:7233
            - name: TASK_QUEUE
              value: orders
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-workers-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-workers
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: External
      external:
        metric:
          name: temporal_task_queue_depth
        target:
          type: AverageValue
          averageValue: "100"
```

---

## 12. Implementation Roadmap

### Phase 1: Core Framework (Weeks 1-2)

**Goal**: Minimal viable framework

- [ ] `tfn.fn()` - Function definition
- [ ] `tfn.workflow()` - Workflow definition  
- [ ] `tfn.worker()` - Worker creation
- [ ] `tfn.client()` - Client creation
- [ ] Basic TypeScript types
- [ ] Local development mode

**Deliverable**: Can write and execute simple workflows

### Phase 2: Triggers (Weeks 3-4)

**Goal**: Multiple trigger types

- [ ] `tfn.http()` - HTTP triggers
- [ ] `tfn.cron()` - Scheduled triggers
- [ ] `tfn.signal()` - Signal handlers
- [ ] Express/Fastify integration
- [ ] Trigger configuration

**Deliverable**: Full trigger system working

### Phase 3: Developer Experience (Weeks 5-6)

**Goal**: Great DX

- [ ] CLI tool (`tfn init`, `tfn dev`, etc.)
- [ ] Hot reload in dev mode
- [ ] Testing utilities
- [ ] Error messages and debugging
- [ ] Documentation

**Deliverable**: Pleasant development experience

### Phase 4: Production Readiness (Weeks 7-8)

**Goal**: Production-ready

- [ ] Logging and observability
- [ ] Metrics integration
- [ ] Health checks
- [ ] Graceful shutdown
- [ ] Docker examples
- [ ] Kubernetes examples

**Deliverable**: Can deploy to production

### Phase 5: Advanced Features (Future)

- [ ] Event triggers (Kafka, NATS, Redis)
- [ ] Workflow versioning helpers
- [ ] Saga pattern utilities
- [ ] Admin UI
- [ ] Multi-tenancy

---

## 13. Technical Decisions

### Decision 1: TypeScript Only (Initially)

**Choice**: TypeScript/Node.js only, no multi-language support

**Rationale**:
- Temporal TS SDK is mature and well-documented
- Type safety is crucial for workflow correctness
- Reduces complexity significantly
- Can add other languages later

### Decision 2: Thin Wrapper, Not Abstraction

**Choice**: Build on top of Temporal SDK, expose it when needed

**Rationale**:
- Users can drop down to raw Temporal when needed
- Don't reinvent what Temporal already does well
- Easier to maintain and upgrade
- Smaller API surface

### Decision 3: Client-Worker Separation from Day 1

**Choice**: Separate packages for client and worker

**Rationale**:
- Different deployment patterns
- Different dependency sizes
- Cleaner architecture
- Enables serverless clients

### Decision 4: Convention Over Configuration

**Choice**: Sensible defaults, override when needed

**Rationale**:
- Faster onboarding
- Less boilerplate
- Escape hatches for advanced users
- Follows TypeScript ecosystem conventions

### Decision 5: File-Based Structure

**Choice**: `functions/` directory convention

**Rationale**:
- Familiar to Next.js/Remix/etc. users
- Easy to understand and navigate
- Enables auto-discovery
- Works with existing tooling

---

## 14. Open Questions

### Q1: Workflow Versioning Strategy

How do we handle workflow versioning? Options:
1. Let Temporal handle it (workflow.patched)
2. Build versioning into function names
3. Separate deployment of workflow versions

### Q2: Multi-Tenancy

How do we support multi-tenant scenarios?
1. Namespace per tenant
2. Task queue per tenant
3. Workflow ID prefixing

### Q3: Error Handling DX

How do we make error handling intuitive?
1. Automatic retry configuration
2. Dead letter queues
3. Error notification hooks

### Q4: Integration with Existing Frameworks

How do we integrate with:
1. Next.js API routes
2. Express middleware
3. Fastify plugins
4. tRPC

### Q5: Observability

What's the best way to expose:
1. Metrics (Prometheus?)
2. Tracing (OpenTelemetry?)
3. Logging (Pino? Winston?)

---

## Appendix A: Comparison with Alternatives

| Feature | Temporal Functions | Trigger.dev | Inngest | Defer.run |
|---------|-------------------|-------------|---------|-----------|
| Durable execution | ✅ Temporal | ✅ Own engine | ✅ Own engine | ✅ Own engine |
| TypeScript native | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Self-hostable | ✅ Yes | ✅ Yes | ⚠️ Enterprise | ❌ No |
| Open source | ✅ Yes | ✅ Yes | ✅ Partial | ❌ No |
| Existing infra | ✅ Uses Temporal | ❌ New system | ❌ New system | ❌ Managed |
| Learning curve | Low | Low | Low | Low |
| Vendor lock-in | Low | Medium | Medium | High |

---

## Appendix B: Example Full Application

See `/examples/ecommerce` for a complete example including:

- Order processing workflow
- Payment integration
- Email notifications
- Scheduled reports
- Webhook handlers
- Testing setup
- Docker deployment

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial architecture document |

---

*This is a living document. Please update it as the architecture evolves.*