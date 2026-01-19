/**
 * Temporal Functions - Observability Package
 *
 * OpenTelemetry integration for Temporal workers with trace context propagation.
 * Import from '@astami/temporal-functions/observability'.
 */

import { trace } from '@opentelemetry/api';
import {
  OpenTelemetryActivityInboundInterceptor,
} from '@temporalio/interceptors-opentelemetry';
import type { Context as ActivityContext } from '@temporalio/activity';
import type {
  ActivityInboundCallsInterceptor,
  ActivityExecuteInput,
  Next,
} from '@temporalio/worker';
import type { WorkerInterceptors } from '../types.js';

// =============================================================================
// Types
// =============================================================================

export interface WorkerInterceptorsConfig {
  /** Service/processor name for logging */
  serviceName: string;
  /** Optional custom logger (defaults to console) */
  logger?: {
    info: (obj: Record<string, unknown>, msg: string) => void;
    error: (obj: Record<string, unknown>, msg: string) => void;
  };
}

// =============================================================================
// Tracing Activity Interceptor
// =============================================================================

/**
 * Creates an activity interceptor that combines OpenTelemetry tracing with structured logging
 *
 * Uses Temporal's OpenTelemetryActivityInboundInterceptor for trace propagation,
 * and wraps it with additional structured logging that includes trace IDs.
 */
class TracingActivityInterceptor implements ActivityInboundCallsInterceptor {
  private readonly otelInterceptor: OpenTelemetryActivityInboundInterceptor;
  private readonly config: WorkerInterceptorsConfig;
  private readonly ctx: ActivityContext;

  constructor(ctx: ActivityContext, config: WorkerInterceptorsConfig) {
    this.ctx = ctx;
    this.config = config;
    // Use Temporal's built-in OTel interceptor for proper trace context propagation
    this.otelInterceptor = new OpenTelemetryActivityInboundInterceptor(ctx);
  }

  async execute(
    input: ActivityExecuteInput,
    next: Next<ActivityInboundCallsInterceptor, 'execute'>
  ): Promise<unknown> {
    const activityType = this.ctx.info.activityType;
    const workflowId = this.ctx.info.workflowExecution.workflowId;
    const startTime = Date.now();
    const config = this.config;
    const logger = config.logger ?? console;

    // Wrap the next function to add logging INSIDE the OTel span context
    const loggingNext: Next<ActivityInboundCallsInterceptor, 'execute'> = async (
      nextInput: ActivityExecuteInput
    ) => {
      // Now we're inside the OTel interceptor's span context
      const currentSpan = trace.getActiveSpan();
      const spanContext = currentSpan?.spanContext();

      logger.info(
        {
          activity: activityType,
          workflowId,
          processor: config.serviceName,
          trace_id: spanContext?.traceId,
          span_id: spanContext?.spanId,
        },
        'Activity started'
      );

      try {
        const result = await next(nextInput);

        logger.info(
          {
            activity: activityType,
            workflowId,
            duration: Date.now() - startTime,
            trace_id: spanContext?.traceId,
            span_id: spanContext?.spanId,
          },
          'Activity completed'
        );

        return result;
      } catch (error) {
        logger.error(
          {
            activity: activityType,
            workflowId,
            error,
            duration: Date.now() - startTime,
            trace_id: spanContext?.traceId,
            span_id: spanContext?.spanId,
          },
          'Activity failed'
        );

        throw error;
      }
    };

    // Delegate to Temporal's OTel interceptor which sets up the span context,
    // then our loggingNext will execute with the proper trace context
    return this.otelInterceptor.execute(input, loggingNext);
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates worker interceptors configuration with OpenTelemetry trace propagation
 *
 * This returns a WorkerInterceptors object that can be passed directly to
 * the worker configuration. It includes:
 * - Activity inbound interceptors for tracing and logging
 *
 * **IMPORTANT**: For end-to-end trace propagation from client -> workflow -> activities,
 * your workflow module must also export an `interceptors` factory function:
 *
 * ```typescript
 * // In your workflows/index.ts
 * import type { WorkflowInterceptorsFactory } from '@temporalio/workflow';
 * import {
 *   OpenTelemetryInboundInterceptor,
 *   OpenTelemetryOutboundInterceptor,
 *   OpenTelemetryInternalsInterceptor,
 * } from '@temporalio/interceptors-opentelemetry/lib/workflow';
 *
 * export const interceptors: WorkflowInterceptorsFactory = () => ({
 *   inbound: [new OpenTelemetryInboundInterceptor()],
 *   outbound: [new OpenTelemetryOutboundInterceptor()],
 *   internals: [new OpenTelemetryInternalsInterceptor()],
 * });
 * ```
 *
 * @example
 * ```typescript
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
export function createWorkerInterceptors(config: WorkerInterceptorsConfig): WorkerInterceptors {
  return {
    activityInbound: [
      (ctx: ActivityContext) => new TracingActivityInterceptor(ctx, config),
    ],
  };
}

// =============================================================================
// Re-exports from Temporal OTel package
// =============================================================================

export {
  OpenTelemetryActivityInboundInterceptor,
} from '@temporalio/interceptors-opentelemetry';

// Re-export workflow interceptors for convenience
export {
  OpenTelemetryInboundInterceptor,
  OpenTelemetryOutboundInterceptor,
  OpenTelemetryInternalsInterceptor,
} from '@temporalio/interceptors-opentelemetry/lib/workflow';
