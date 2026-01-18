/**
 * Temporal Functions - Client Package
 *
 * Lightweight client for triggering workflows.
 * Import from 'temporal-functions/client'.
 */

import { Client, Connection, type ClientOptions } from '@temporalio/client';
import type {
  ClientConfig,
  WorkflowDef,
  StartWorkflowOptions,
  WorkflowHandle,
  TFNClient,
} from '../types.js';

// =============================================================================
// Client Implementation
// =============================================================================

class TemporalFunctionsClient implements TFNClient {
  private client: Client | null = null;
  private config: ClientConfig;
  private connectionPromise: Promise<Client> | null = null;

  constructor(config: ClientConfig) {
    this.config = {
      ...config,
      temporal: {
        namespace: 'default',
        ...config.temporal,
      },
      taskQueue: config.taskQueue || 'default',
    };
  }

  /**
   * Lazily connect to Temporal
   */
  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      const connection = await Connection.connect({
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

      // Build client options with optional interceptors
      const clientOptions: ClientOptions = {
        connection,
        namespace: this.config.temporal.namespace!,
      };

      // Add workflow interceptors if configured (e.g., for OpenTelemetry)
      if (this.config.interceptors?.workflow) {
        clientOptions.interceptors = {
          workflow: this.config.interceptors.workflow,
        };
      }

      this.client = new Client(clientOptions);

      return this.client;
    })();

    return this.connectionPromise;
  }

  /**
   * Generate a workflow ID if not provided
   */
  private generateWorkflowId(workflowName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${workflowName}-${timestamp}-${random}`;
  }

  /**
   * Start a workflow and wait for the result
   */
  async invoke<TInput, TOutput>(
    workflow: WorkflowDef<TInput, TOutput>,
    input: TInput,
    options: StartWorkflowOptions = {}
  ): Promise<TOutput> {
    const handle = await this.start(workflow, input, options);
    return handle.result();
  }

  /**
   * Start a workflow without waiting (fire and forget)
   */
  async start<TInput, TOutput>(
    workflow: WorkflowDef<TInput, TOutput>,
    input: TInput,
    options: StartWorkflowOptions = {}
  ): Promise<WorkflowHandle<TOutput>> {
    const client = await this.getClient();

    const workflowId = options.workflowId || this.generateWorkflowId(workflow.name);
    const taskQueue = options.taskQueue || workflow.options.taskQueue || this.config.taskQueue || 'default';

    const handle = await client.workflow.start(workflow.name, {
      workflowId,
      taskQueue,
      args: [input],
      workflowExecutionTimeout: options.workflowExecutionTimeout,
      memo: options.memo,
      // searchAttributes requires specific types, omit for now if not properly typed
    });

    return this.wrapHandle<TOutput>(handle);
  }

  /**
   * Get a handle to an existing workflow
   */
  getHandle<TOutput = unknown>(workflowId: string): WorkflowHandle<TOutput> {
    // Create a lazy handle that connects when needed
    return {
      workflowId,
      runId: '', // Will be populated when we fetch
      result: async () => {
        const client = await this.getClient();
        const handle = client.workflow.getHandle(workflowId);
        return handle.result() as Promise<TOutput>;
      },
      query: async <TResult = unknown>(queryName: string) => {
        const client = await this.getClient();
        const handle = client.workflow.getHandle(workflowId);
        return handle.query<TResult>(queryName);
      },
      signal: async <TPayload = unknown>(signalName: string, payload: TPayload) => {
        const client = await this.getClient();
        const handle = client.workflow.getHandle(workflowId);
        await handle.signal(signalName, payload);
      },
      cancel: async () => {
        const client = await this.getClient();
        const handle = client.workflow.getHandle(workflowId);
        await handle.cancel();
      },
      terminate: async (reason?: string) => {
        const client = await this.getClient();
        const handle = client.workflow.getHandle(workflowId);
        await handle.terminate(reason);
      },
    };
  }

  /**
   * Signal an existing workflow
   */
  async signal<TPayload = unknown>(
    workflowId: string,
    signalName: string,
    payload: TPayload
  ): Promise<void> {
    const client = await this.getClient();
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal(signalName, payload);
  }

  /**
   * Query an existing workflow
   */
  async query<TResult = unknown>(
    workflowId: string,
    queryName: string
  ): Promise<TResult> {
    const client = await this.getClient();
    const handle = client.workflow.getHandle(workflowId);
    return handle.query<TResult>(queryName);
  }

  /**
   * Wrap a Temporal workflow handle in our interface
   */
  private wrapHandle<TOutput>(
    handle: Awaited<ReturnType<Client['workflow']['start']>>
  ): WorkflowHandle<TOutput> {
    return {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      result: () => handle.result() as Promise<TOutput>,
      query: <TResult = unknown>(queryName: string) =>
        handle.query<TResult>(queryName),
      signal: <TPayload = unknown>(signalName: string, payload: TPayload) =>
        handle.signal(signalName, payload),
      cancel: async () => {
        await handle.cancel();
      },
      terminate: async (reason?: string) => {
        await handle.terminate(reason);
      },
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Temporal Functions client
 *
 * @example
 * ```typescript
 * import { tfn } from 'temporal-functions/client';
 *
 * const client = tfn.client({
 *   temporal: {
 *     address: 'localhost:7233',
 *     namespace: 'default',
 *   },
 *   taskQueue: 'my-queue',
 * });
 *
 * const result = await client.invoke(myWorkflow, { data: 'hello' });
 * ```
 */
function createClient(config: ClientConfig): TFNClient {
  return new TemporalFunctionsClient(config);
}

// =============================================================================
// Export
// =============================================================================

export const tfn = {
  client: createClient,
};

export { createClient };
export type { ClientConfig, TFNClient, WorkflowHandle, StartWorkflowOptions };
export default tfn;
