/**
 * Temporal Functions - Testing Utilities
 *
 * Utilities for testing functions and workflows.
 * Import from 'temporal-functions/testing'.
 */

import type {
  FunctionDef,
  WorkflowDef,
  WorkflowContext,
  WorkflowInfo,
} from '../types.js';

// =============================================================================
// Mock Context
// =============================================================================

/**
 * Create a mock workflow context for testing
 */
function createMockContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  const signalHandlers = new Map<string, (payload: unknown) => void>();
  const queryHandlers = new Map<string, () => unknown>();

  const mockInfo: WorkflowInfo = {
    workflowId: 'test-workflow-id',
    runId: 'test-run-id',
    taskQueue: 'test-queue',
    workflowType: 'test-workflow',
    namespace: 'default',
  };

  return {
    run: async <TInput, TOutput>(
      fn: FunctionDef<TInput, TOutput>,
      input: TInput
    ): Promise<TOutput> => {
      return fn.handler(input);
    },
    sleep: async () => {
      // No-op in tests by default
    },
    now: () => new Date(),
    startChild: async () => {
      throw new Error('startChild not implemented in mock context');
    },
    continueAsNew: async () => {
      throw new Error('continueAsNew not implemented in mock context');
    },
    onSignal: <TPayload = unknown>(signalName: string, handler: (payload: TPayload) => void) => {
      signalHandlers.set(signalName, handler as (payload: unknown) => void);
    },
    onQuery: (queryName, handler) => {
      queryHandlers.set(queryName, handler);
    },
    info: mockInfo,
    ...overrides,
  };
}

// =============================================================================
// Test Environment
// =============================================================================

interface MockedFunction<TInput, TOutput> {
  fn: FunctionDef<TInput, TOutput>;
  mock: (input: TInput) => Promise<TOutput>;
}

/**
 * Test environment for running workflows in isolation
 */
class TestEnvironment {
  private mocks: Map<string, (input: unknown) => Promise<unknown>> = new Map();
  private currentTime: Date = new Date();

  /**
   * Mock a function's implementation
   */
  mock<TInput, TOutput>(
    fn: FunctionDef<TInput, TOutput>,
    implementation: (input: TInput) => Promise<TOutput> | TOutput
  ): this {
    this.mocks.set(fn.name, async (input: unknown) => {
      return implementation(input as TInput);
    });
    return this;
  }

  /**
   * Set the current time for the test
   */
  setTime(time: Date): this {
    this.currentTime = time;
    return this;
  }

  /**
   * Execute a workflow with the test environment
   */
  async execute<TInput, TOutput>(
    workflow: WorkflowDef<TInput, TOutput>,
    input: TInput
  ): Promise<TOutput> {
    const ctx = this.createContext();
    return workflow.handler(ctx, input);
  }

  /**
   * Start a workflow and return a handle for interaction
   */
  async start<TInput, TOutput>(
    workflow: WorkflowDef<TInput, TOutput>,
    input: TInput
  ): Promise<TestWorkflowHandle<TOutput>> {
    const signalHandlers = new Map<string, (payload: unknown) => void>();
    const queryHandlers = new Map<string, () => unknown>();

    const ctx = this.createContext({
      onSignal: <TPayload = unknown>(signalName: string, handler: (payload: TPayload) => void) => {
        signalHandlers.set(signalName, handler as (payload: unknown) => void);
      },
      onQuery: (queryName, handler) => {
        queryHandlers.set(queryName, handler);
      },
    });

    const resultPromise = workflow.handler(ctx, input);

    return {
      result: () => resultPromise,
      signal: async <TPayload>(signalName: string, payload: TPayload) => {
        const handler = signalHandlers.get(signalName);
        if (handler) {
          handler(payload);
        }
      },
      query: <TResult>(queryName: string): TResult => {
        const handler = queryHandlers.get(queryName);
        if (handler) {
          return handler() as TResult;
        }
        throw new Error(`Query handler not found: ${queryName}`);
      },
    };
  }

  /**
   * Create a workflow context with mocks applied
   */
  private createContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
    return createMockContext({
      run: async <TInput, TOutput>(
        fn: FunctionDef<TInput, TOutput>,
        input: TInput
      ): Promise<TOutput> => {
        const mock = this.mocks.get(fn.name);
        if (mock) {
          return mock(input) as Promise<TOutput>;
        }
        // Fall back to actual implementation
        return fn.handler(input);
      },
      now: () => this.currentTime,
      ...overrides,
    });
  }
}

/**
 * Handle to a test workflow execution
 */
interface TestWorkflowHandle<TOutput> {
  /** Wait for the workflow result */
  result(): Promise<TOutput>;
  /** Send a signal to the workflow */
  signal<TPayload>(signalName: string, payload: TPayload): Promise<void>;
  /** Query the workflow */
  query<TResult>(queryName: string): TResult;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a test environment
 *
 * @example
 * ```typescript
 * import { tfn } from 'temporal-functions/testing';
 *
 * const env = await tfn.testEnv();
 *
 * env.mock(sendEmail, async (params) => ({
 *   messageId: 'test-id',
 * }));
 *
 * const result = await env.execute(myWorkflow, { data: 'test' });
 * ```
 */
async function createTestEnv(): Promise<TestEnvironment> {
  return new TestEnvironment();
}

// =============================================================================
// Export
// =============================================================================

export const tfn = {
  testEnv: createTestEnv,
  mockContext: createMockContext,
};

export { createTestEnv, createMockContext, TestEnvironment };
export type { TestWorkflowHandle };
export default tfn;
