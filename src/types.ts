/**
 * Core type definitions for Temporal Functions
 */

// =============================================================================
// Function (Activity) Types
// =============================================================================

/**
 * Options for configuring a function (activity)
 */
export interface FunctionOptions {
  /** Start-to-close timeout (e.g., '30s', '5m') */
  startToCloseTimeout?: string;
  /** Schedule-to-close timeout */
  scheduleToCloseTimeout?: string;
  /** Heartbeat timeout for long-running activities */
  heartbeatTimeout?: string;
  /** Retry policy configuration */
  retry?: RetryPolicy;
}

/**
 * Retry policy for functions
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maximumAttempts?: number;
  /** Initial retry interval (e.g., '1s') */
  initialInterval?: string;
  /** Maximum retry interval (e.g., '30s') */
  maximumInterval?: string;
  /** Backoff coefficient for exponential backoff */
  backoffCoefficient?: number;
  /** List of error types that should not be retried */
  nonRetryableErrorTypes?: string[];
}

/**
 * Definition of a function (maps to Temporal Activity)
 */
export interface FunctionDef<TInput = unknown, TOutput = unknown> {
  /** Unique identifier for the function */
  name: string;
  /** The function implementation */
  handler: (input: TInput) => Promise<TOutput>;
  /** Configuration options */
  options: FunctionOptions;
  /** Type marker */
  __type: 'function';
}

// =============================================================================
// Workflow Types
// =============================================================================

/**
 * Options for configuring a workflow
 */
export interface WorkflowOptions {
  /** Task queue for this workflow (defaults to 'default') */
  taskQueue?: string;
  /** Workflow execution timeout */
  workflowExecutionTimeout?: string;
  /** Workflow run timeout */
  workflowRunTimeout?: string;
  /** Workflow task timeout */
  workflowTaskTimeout?: string;
  /** Retry policy for the workflow */
  retry?: RetryPolicy;
}

/**
 * Workflow information available at runtime
 */
export interface WorkflowInfo {
  /** Unique workflow ID */
  workflowId: string;
  /** Current run ID */
  runId: string;
  /** Task queue the workflow is running on */
  taskQueue: string;
  /** Workflow type name */
  workflowType: string;
  /** Namespace */
  namespace: string;
}

/**
 * Context object passed to workflow functions
 */
export interface WorkflowContext {
  /**
   * Run a function (activity) within the workflow
   */
  run<TInput, TOutput>(
    fn: FunctionDef<TInput, TOutput>,
    input: TInput,
    options?: Partial<FunctionOptions>
  ): Promise<TOutput>;

  /**
   * Sleep for a duration
   * @param duration - Duration string (e.g., '5m', '1h') or milliseconds
   */
  sleep(duration: string | number): Promise<void>;

  /**
   * Get the current workflow time (deterministic)
   */
  now(): Date;

  /**
   * Start a child workflow
   */
  startChild<TInput, TOutput>(
    workflow: WorkflowDef<TInput, TOutput>,
    input: TInput,
    options?: ChildWorkflowOptions
  ): Promise<TOutput>;

  /**
   * Continue as new with fresh history
   */
  continueAsNew<TInput>(input: TInput): Promise<never>;

  /**
   * Register a signal handler
   */
  onSignal<TPayload = unknown>(
    signalName: string,
    handler: (payload: TPayload) => void
  ): void;

  /**
   * Wait for a signal to be received
   * @param signalName - Name of the signal to wait for
   * @param options - Optional timeout configuration
   * @returns The signal payload when received
   * @throws TimeoutError if timeout is specified and signal not received in time
   */
  waitForSignal<TPayload = unknown>(
    signalName: string,
    options?: WaitForSignalOptions
  ): Promise<TPayload>;

  /**
   * Register a query handler
   */
  onQuery<TResult = unknown>(
    queryName: string,
    handler: () => TResult
  ): void;

  /**
   * Workflow information
   */
  readonly info: WorkflowInfo;
}

/**
 * Options for child workflows
 */
export interface ChildWorkflowOptions {
  workflowId?: string;
  taskQueue?: string;
  workflowExecutionTimeout?: string;
}

/**
 * Options for waitForSignal
 */
export interface WaitForSignalOptions {
  /** Timeout duration (e.g., '5m', '1h'). If not specified, waits indefinitely. */
  timeout?: string;
}

/**
 * Workflow handler function type
 */
export type WorkflowHandler<TInput = unknown, TOutput = unknown> = (
  ctx: WorkflowContext,
  input: TInput
) => Promise<TOutput>;

/**
 * Definition of a workflow
 */
export interface WorkflowDef<TInput = unknown, TOutput = unknown> {
  /** Unique identifier for the workflow */
  name: string;
  /** The workflow implementation */
  handler: WorkflowHandler<TInput, TOutput>;
  /** Configuration options */
  options: WorkflowOptions;
  /** Type marker */
  __type: 'workflow';
}

// =============================================================================
// Client Types
// =============================================================================

/**
 * Temporal connection configuration
 */
export interface TemporalConfig {
  /** Temporal server address (e.g., 'localhost:7233') */
  address: string;
  /** Namespace to use */
  namespace?: string;
  /** TLS configuration */
  tls?: TLSConfig;
}

/**
 * TLS configuration for secure connections
 */
export interface TLSConfig {
  /** Path to client certificate */
  clientCertPath?: string;
  /** Path to client key */
  clientKeyPath?: string;
  /** Path to CA certificate */
  serverRootCACertPath?: string;
}

/**
 * Client configuration options
 */
export interface ClientConfig {
  /** Temporal connection settings */
  temporal: TemporalConfig;
  /** Default task queue for workflows */
  taskQueue?: string;
}

/**
 * Options when starting a workflow
 */
export interface StartWorkflowOptions {
  /** Custom workflow ID (for idempotency) */
  workflowId?: string;
  /** Override the default task queue */
  taskQueue?: string;
  /** Workflow execution timeout */
  workflowExecutionTimeout?: string;
  /** Memo fields */
  memo?: Record<string, unknown>;
  /** Search attributes */
  searchAttributes?: Record<string, unknown>;
}

/**
 * Handle to a running workflow
 */
export interface WorkflowHandle<TOutput = unknown> {
  /** The workflow ID */
  workflowId: string;
  /** The run ID */
  runId: string;
  /** Wait for the workflow result */
  result(): Promise<TOutput>;
  /** Query the workflow */
  query<TResult = unknown>(queryName: string): Promise<TResult>;
  /** Signal the workflow */
  signal<TPayload = unknown>(signalName: string, payload: TPayload): Promise<void>;
  /** Cancel the workflow */
  cancel(): Promise<void>;
  /** Terminate the workflow */
  terminate(reason?: string): Promise<void>;
}

/**
 * Temporal Functions client interface
 */
export interface TFNClient {
  /**
   * Start a workflow and wait for the result
   */
  invoke<TInput, TOutput>(
    workflow: WorkflowDef<TInput, TOutput>,
    input: TInput,
    options?: StartWorkflowOptions
  ): Promise<TOutput>;

  /**
   * Start a workflow without waiting (fire and forget)
   */
  start<TInput, TOutput>(
    workflow: WorkflowDef<TInput, TOutput>,
    input: TInput,
    options?: StartWorkflowOptions
  ): Promise<WorkflowHandle<TOutput>>;

  /**
   * Get a handle to an existing workflow
   */
  getHandle<TOutput = unknown>(workflowId: string): WorkflowHandle<TOutput>;

  /**
   * Signal an existing workflow
   */
  signal<TPayload = unknown>(
    workflowId: string,
    signalName: string,
    payload: TPayload
  ): Promise<void>;

  /**
   * Query an existing workflow
   */
  query<TResult = unknown>(
    workflowId: string,
    queryName: string
  ): Promise<TResult>;
}

// =============================================================================
// Worker Types
// =============================================================================

/**
 * Worker configuration options
 */
export interface WorkerConfig {
  /** Temporal connection settings */
  temporal: TemporalConfig;
  /** Task queue to poll */
  taskQueue: string;
  /** Maximum concurrent activity executions */
  maxConcurrentActivities?: number;
  /** Maximum concurrent workflow executions */
  maxConcurrentWorkflows?: number;
  /** Enable sticky execution (default: true) */
  enableStickyExecution?: boolean;
}

/**
 * Temporal Functions worker interface
 */
export interface TFNWorker {
  /**
   * Register a function or workflow
   */
  register(def: FunctionDef | WorkflowDef): void;

  /**
   * Register all exports from a module
   */
  registerModule(module: Record<string, unknown>): void;

  /**
   * Start the worker (blocks until shutdown)
   */
  start(): Promise<void>;

  /**
   * Gracefully shutdown the worker
   */
  shutdown(): Promise<void>;
}

// =============================================================================
// Trigger Types
// =============================================================================

/**
 * HTTP trigger configuration
 */
export interface HttpTriggerOptions {
  /** Custom workflow ID generator */
  workflowId?: (req: unknown) => string;
  /** Return immediately without waiting for result */
  async?: boolean;
  /** Middleware functions */
  middleware?: Array<(req: unknown, res: unknown, next: () => void) => void>;
}

/**
 * Cron trigger configuration
 */
export interface CronTriggerOptions {
  /** Prevent overlapping executions */
  overlap?: boolean;
  /** Timezone for cron schedule */
  timezone?: string;
}

// =============================================================================
// Registry Types
// =============================================================================

/**
 * Internal registry for functions and workflows
 */
export interface Registry {
  functions: Map<string, FunctionDef>;
  workflows: Map<string, WorkflowDef>;
}
