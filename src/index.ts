/**
 * Temporal Functions - Main Entry Point
 *
 * This module provides the core API for defining functions and workflows.
 * Import from 'temporal-functions' for function/workflow definitions.
 * Import from 'temporal-functions/client' for triggering workflows.
 * Import from 'temporal-functions/worker' for running workers.
 */

import type {
  FunctionDef,
  FunctionOptions,
  WorkflowDef,
  WorkflowOptions,
  WorkflowHandler,
  Registry,
  HttpTriggerOptions,
  CronTriggerOptions,
} from './types.js';

// =============================================================================
// Global Registry
// =============================================================================

/**
 * Global registry for all defined functions and workflows
 */
export const registry: Registry = {
  functions: new Map(),
  workflows: new Map(),
};

// =============================================================================
// Function Definition
// =============================================================================

/**
 * Define a function (maps to a Temporal Activity)
 *
 * @example
 * ```typescript
 * export const sendEmail = tfn.fn(
 *   'sendEmail',
 *   async (params: EmailParams) => {
 *     return await emailService.send(params);
 *   },
 *   { timeout: '30s', retries: 3 }
 * );
 * ```
 */
function fn<TInput, TOutput>(
  name: string,
  handler: (input: TInput) => Promise<TOutput>,
  options: FunctionOptions = {}
): FunctionDef<TInput, TOutput> {
  const def: FunctionDef<TInput, TOutput> = {
    name,
    handler,
    options: {
      startToCloseTimeout: '1m',
      ...options,
    },
    __type: 'function',
  };

  registry.functions.set(name, def as FunctionDef);
  return def;
}

// =============================================================================
// Workflow Definition
// =============================================================================

/**
 * Define a workflow
 *
 * @example
 * ```typescript
 * export const processOrder = tfn.workflow(
 *   'processOrder',
 *   async (ctx, order: Order) => {
 *     const validated = await ctx.run(validateOrder, order);
 *     const paid = await ctx.run(chargePayment, validated);
 *     return { orderId: paid.id, status: 'complete' };
 *   }
 * );
 * ```
 */
function workflow<TInput, TOutput>(
  name: string,
  handler: WorkflowHandler<TInput, TOutput>,
  options: WorkflowOptions = {}
): WorkflowDef<TInput, TOutput> {
  const def: WorkflowDef<TInput, TOutput> = {
    name,
    handler,
    options: {
      taskQueue: 'default',
      ...options,
    },
    __type: 'workflow',
  };

  registry.workflows.set(name, def as WorkflowDef);
  return def;
}

// =============================================================================
// Trigger Definitions (Declarative)
// =============================================================================

interface HttpTriggerDef {
  type: 'http';
  method: string;
  path: string;
  workflow: WorkflowDef;
  options: HttpTriggerOptions;
}

interface CronTriggerDef {
  type: 'cron';
  schedule: string;
  workflow: WorkflowDef;
  options: CronTriggerOptions;
}

interface SignalTriggerDef {
  type: 'signal';
  signalName: string;
  handler: (payload: unknown) => void | Promise<void>;
}

type TriggerDef = HttpTriggerDef | CronTriggerDef | SignalTriggerDef;

/**
 * Registry for trigger definitions
 */
export const triggers: TriggerDef[] = [];

/**
 * Define an HTTP trigger for a workflow
 *
 * @example
 * ```typescript
 * tfn.http('POST', '/api/orders', processOrder);
 * ```
 */
function http<TInput, TOutput>(
  method: string,
  path: string,
  workflow: WorkflowDef<TInput, TOutput>,
  options: HttpTriggerOptions = {}
): void {
  triggers.push({
    type: 'http',
    method: method.toUpperCase(),
    path,
    workflow: workflow as WorkflowDef,
    options,
  });
}

/**
 * Define a cron/scheduled trigger for a workflow
 *
 * @example
 * ```typescript
 * tfn.cron('0 9 * * *', dailyReport); // Every day at 9am
 * ```
 */
function cron<TInput, TOutput>(
  schedule: string,
  workflow: WorkflowDef<TInput, TOutput>,
  options: CronTriggerOptions = {}
): void {
  triggers.push({
    type: 'cron',
    schedule,
    workflow: workflow as WorkflowDef,
    options,
  });
}

/**
 * Define an interval trigger (convenience wrapper around cron)
 *
 * @example
 * ```typescript
 * tfn.interval('5m', healthCheck); // Every 5 minutes
 * ```
 */
function interval<TInput, TOutput>(
  duration: string,
  workflow: WorkflowDef<TInput, TOutput>,
  options: CronTriggerOptions = {}
): void {
  // Convert duration to cron expression
  const cronSchedule = durationToCron(duration);
  cron(cronSchedule, workflow, options);
}

/**
 * Define a signal trigger
 *
 * @example
 * ```typescript
 * tfn.signal('order.cancel', handleCancellation);
 * ```
 */
function signal(
  signalName: string,
  handler: (payload: unknown) => void | Promise<void>
): void {
  triggers.push({
    type: 'signal',
    signalName,
    handler,
  });
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Convert a duration string to a cron expression
 */
function durationToCron(duration: string): string {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like '5m', '1h', '30s'`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      if (value < 60) {
        return `*/${value} * * * * *`; // Every N seconds (non-standard)
      }
      throw new Error('Seconds interval must be less than 60');
    case 'm':
      return `*/${value} * * * *`; // Every N minutes
    case 'h':
      return `0 */${value} * * *`; // Every N hours
    case 'd':
      return `0 0 */${value} * *`; // Every N days
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Check if a definition is a function
 */
export function isFunction(def: unknown): def is FunctionDef {
  return (def as FunctionDef)?.__type === 'function';
}

/**
 * Check if a definition is a workflow
 */
export function isWorkflow(def: unknown): def is WorkflowDef {
  return (def as WorkflowDef)?.__type === 'workflow';
}

// =============================================================================
// Main API Export
// =============================================================================

/**
 * The main Temporal Functions API
 */
export const tfn = {
  /** Define a function (activity) */
  fn,
  /** Define a workflow */
  workflow,
  /** Define an HTTP trigger */
  http,
  /** Define a cron trigger */
  cron,
  /** Define an interval trigger */
  interval,
  /** Define a signal trigger */
  signal,
};

// Re-export types
export type {
  FunctionDef,
  FunctionOptions,
  WorkflowDef,
  WorkflowOptions,
  WorkflowContext,
  WorkflowHandler,
  WorkflowInfo,
  RetryPolicy,
  HttpTriggerOptions,
  CronTriggerOptions,
  TemporalConfig,
  ClientConfig,
  WorkerConfig,
  StartWorkflowOptions,
  WorkflowHandle,
  TFNClient,
  TFNWorker,
} from './types.js';

export default tfn;
