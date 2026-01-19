/**
 * Temporal Functions - Worker Package
 *
 * Full worker implementation for executing functions and workflows.
 * Import from 'temporal-functions/worker'.
 */

import { Worker, NativeConnection } from '@temporalio/worker';
import type {
  WorkerConfig,
  FunctionDef,
  WorkflowDef,
  TFNWorker,
} from '../types.js';
import { isFunction, isWorkflow } from '../index.js';

// =============================================================================
// Worker Implementation
// =============================================================================

class TemporalFunctionsWorker implements TFNWorker {
  private config: WorkerConfig;
  private functions: Map<string, FunctionDef> = new Map();
  private workflows: Map<string, WorkflowDef> = new Map();
  private worker: Worker | null = null;
  private shutdownRequested = false;

  constructor(config: WorkerConfig) {
    this.config = {
      ...config,
      temporal: {
        namespace: 'default',
        ...config.temporal,
      },
      maxConcurrentActivities: config.maxConcurrentActivities ?? 100,
      maxConcurrentWorkflows: config.maxConcurrentWorkflows ?? 50,
    };
  }

  /**
   * Register a function or workflow
   */
  register(def: FunctionDef | WorkflowDef): void {
    if (isFunction(def)) {
      this.functions.set(def.name, def);
    } else if (isWorkflow(def)) {
      this.workflows.set(def.name, def);
    } else {
      throw new Error('Invalid definition: must be a function or workflow created with tfn.fn() or tfn.workflow()');
    }
  }

  /**
   * Register all exported functions and workflows from a module
   */
  registerModule(module: Record<string, unknown>): void {
    for (const [, value] of Object.entries(module)) {
      if (isFunction(value) || isWorkflow(value)) {
        this.register(value);
      }
    }
  }

  /**
   * Build activities object from registered functions
   */
  private buildActivities(): Record<string, (...args: unknown[]) => Promise<unknown>> {
    const activities: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

    for (const [name, def] of this.functions) {
      activities[name] = async (input: unknown) => {
        return def.handler(input);
      };
    }

    return activities;
  }

  /**
   * Generate workflow wrapper code for Temporal
   *
   * This creates the workflow module that Temporal requires,
   * wrapping our user-defined workflow handlers with the proper
   * Temporal workflow context.
   */
  private generateWorkflowBundle(): string {
    const workflowNames = Array.from(this.workflows.keys());

    // Generate the workflow module code
    const code = `
      import { proxyActivities, sleep, workflowInfo, setHandler, defineSignal, defineQuery, condition, CancellationScope } from '@temporalio/workflow';

      // Proxy all activities
      const activities = proxyActivities({
        startToCloseTimeout: '1 minute',
      });

      // Create workflow context
      function createContext() {
        const signalHandlers = new Map();
        const queryHandlers = new Map();
        const signalPayloads = new Map();
        const signalReceived = new Map();

        return {
          run: async (fn, input, options = {}) => {
            const activity = activities[fn.name];
            if (!activity) {
              throw new Error(\`Function \${fn.name} not registered\`);
            }
            return activity(input);
          },
          sleep: async (duration) => {
            if (typeof duration === 'string') {
              const ms = parseDuration(duration);
              return sleep(ms);
            }
            return sleep(duration);
          },
          now: () => new Date(),
          startChild: async (workflow, input, options = {}) => {
            throw new Error('startChild not yet implemented');
          },
          continueAsNew: async (input) => {
            throw new Error('continueAsNew not yet implemented');
          },
          onSignal: (signalName, handler) => {
            signalHandlers.set(signalName, handler);
            const signal = defineSignal(signalName);
            setHandler(signal, handler);
          },
          waitForSignal: async (signalName, options = {}) => {
            // Register signal handler if not already registered
            if (!signalReceived.has(signalName)) {
              signalReceived.set(signalName, false);
              signalPayloads.set(signalName, undefined);
              const signal = defineSignal(signalName);
              setHandler(signal, (payload) => {
                signalPayloads.set(signalName, payload);
                signalReceived.set(signalName, true);
              });
            }

            // Wait for signal with optional timeout
            const timeoutMs = options.timeout ? parseDuration(options.timeout) : undefined;
            const received = await condition(() => signalReceived.get(signalName), timeoutMs);

            if (!received) {
              throw new Error(\`Timeout waiting for signal: \${signalName}\`);
            }

            // Reset for potential reuse
            const payload = signalPayloads.get(signalName);
            signalReceived.set(signalName, false);
            signalPayloads.set(signalName, undefined);

            return payload;
          },
          onQuery: (queryName, handler) => {
            queryHandlers.set(queryName, handler);
            const query = defineQuery(queryName);
            setHandler(query, handler);
          },
          get info() {
            const info = workflowInfo();
            return {
              workflowId: info.workflowId,
              runId: info.runId,
              taskQueue: info.taskQueue,
              workflowType: info.workflowType,
              namespace: info.namespace,
            };
          },
        };
      }

      // Parse duration string to milliseconds
      function parseDuration(duration) {
        const match = duration.match(/^(\\d+(?:\\.\\d+)?)(ms|s|m|h|d)$/);
        if (!match) {
          throw new Error(\`Invalid duration: \${duration}\`);
        }
        const value = parseFloat(match[1]);
        const unit = match[2];
        switch (unit) {
          case 'ms': return value;
          case 's': return value * 1000;
          case 'm': return value * 60 * 1000;
          case 'h': return value * 60 * 60 * 1000;
          case 'd': return value * 24 * 60 * 60 * 1000;
          default: throw new Error(\`Unknown duration unit: \${unit}\`);
        }
      }

      // Export workflow functions
      ${workflowNames.map((name) => `
      export async function ${name}(input) {
        const ctx = createContext();
        const handler = __workflowHandlers__.get('${name}');
        if (!handler) {
          throw new Error('Workflow handler not found: ${name}');
        }
        return handler(ctx, input);
      }
      `).join('\n')}
    `;

    return code;
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    // Allow starting with external workflowsPath and activities
    const hasRegisteredFunctions = this.functions.size > 0 || this.workflows.size > 0;
    const hasExternalConfig = this.config.workflowsPath || this.config.activities;

    if (!hasRegisteredFunctions && !hasExternalConfig) {
      throw new Error('No functions, workflows, or external config provided. Either call register() or provide workflowsPath/activities.');
    }

    console.log(`Starting Temporal Functions worker...`);
    console.log(`  Temporal: ${this.config.temporal.address}`);
    console.log(`  Namespace: ${this.config.temporal.namespace}`);
    console.log(`  Task Queue: ${this.config.taskQueue}`);
    if (this.config.workflowsPath) {
      console.log(`  Workflows Path: ${this.config.workflowsPath}`);
    }
    if (hasRegisteredFunctions) {
      console.log(`  Registered Functions: ${this.functions.size}`);
      console.log(`  Registered Workflows: ${this.workflows.size}`);
    }

    // Connect to Temporal
    const connection = await NativeConnection.connect({
      address: this.config.temporal.address,
      tls: this.config.temporal.tls
        ? {
            clientCertPair: this.config.temporal.tls.clientCertPath
              ? {
                  crt: await import('fs').then((fs) =>
                    fs.promises.readFile(this.config.temporal.tls!.clientCertPath!)
                  ),
                  key: await import('fs').then((fs) =>
                    fs.promises.readFile(this.config.temporal.tls!.clientKeyPath!)
                  ),
                }
              : undefined,
          }
        : undefined,
    });

    // Build activities - merge registered functions with external activities
    const registeredActivities = this.buildActivities();
    const activities = {
      ...registeredActivities,
      ...this.config.activities,
    };

    // Build worker options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerOptions: any = {
      connection,
      namespace: this.config.temporal.namespace,
      taskQueue: this.config.taskQueue,
      activities: Object.keys(activities).length > 0 ? activities : undefined,
      maxConcurrentActivityTaskExecutions: this.config.maxConcurrentActivities,
      maxConcurrentWorkflowTaskExecutions: this.config.maxConcurrentWorkflows,
    };

    // Add workflowsPath if provided (for external workflow files)
    if (this.config.workflowsPath) {
      workerOptions.workflowsPath = this.config.workflowsPath;
    }

    // Add interceptors if provided
    if (this.config.interceptors || this.config.workflowsPath) {
      workerOptions.interceptors = {};

      if (this.config.interceptors?.activityInbound) {
        workerOptions.interceptors.activityInbound = this.config.interceptors.activityInbound;
      }

      // Build workflow modules list:
      // 1. Include any explicitly configured workflowModules
      // 2. IMPORTANT: Also include the workflowsPath so its `interceptors` export is picked up
      //    This enables OpenTelemetry trace propagation from the workflow module
      const workflowModules: string[] = [];

      if (this.config.interceptors?.workflowModules) {
        workflowModules.push(...this.config.interceptors.workflowModules);
      }

      // Auto-include the workflows module as an interceptor module
      // This allows the workflow module to export an `interceptors` factory function
      // that will be automatically invoked by the Temporal runtime
      if (this.config.workflowsPath) {
        workflowModules.push(this.config.workflowsPath);
      }

      if (workflowModules.length > 0) {
        workerOptions.interceptors.workflowModules = workflowModules;
      }
    }

    // Create worker
    this.worker = await Worker.create(workerOptions);

    // Handle graceful shutdown
    const shutdown = async () => {
      if (this.shutdownRequested) return;
      this.shutdownRequested = true;
      console.log('\nShutting down worker...');
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('\nWorker started. Press Ctrl+C to stop.\n');

    // Run the worker (blocks until shutdown)
    await this.worker.run();
  }

  /**
   * Gracefully shutdown the worker
   */
  async shutdown(): Promise<void> {
    if (this.worker) {
      this.worker.shutdown();
      this.worker = null;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Temporal Functions worker
 *
 * @example
 * ```typescript
 * // Option 1: Using registered functions (tfn pattern)
 * import { tfn } from 'temporal-functions/worker';
 * import { validateOrder, processOrder } from './functions';
 *
 * const worker = tfn.worker({
 *   temporal: { address: 'localhost:7233', namespace: 'default' },
 *   taskQueue: 'my-queue',
 * });
 *
 * worker.register(validateOrder);
 * worker.register(processOrder);
 * await worker.start();
 * ```
 *
 * @example
 * ```typescript
 * // Option 2: Using external workflowsPath and activities (processor pattern)
 * import { createWorker } from '@astami/temporal-functions/worker';
 * import { createWorkerInterceptors } from '@astami/temporal-functions/observability';
 * import * as activities from './activities';
 *
 * const worker = createWorker({
 *   temporal: { address: 'localhost:7233', namespace: 'loop' },
 *   taskQueue: 'stripe-payments',
 *   workflowsPath: './dist/workflows/index.js',
 *   activities,
 *   interceptors: createWorkerInterceptors({ serviceName: 'stripe' }),
 * });
 *
 * await worker.start();
 * ```
 */
function createWorker(config: WorkerConfig): TFNWorker {
  return new TemporalFunctionsWorker(config);
}

// =============================================================================
// Export
// =============================================================================

export const tfn = {
  worker: createWorker,
};

export { createWorker };
export type { WorkerConfig, TFNWorker };
export default tfn;
