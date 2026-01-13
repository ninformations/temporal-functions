import { describe, it, expect } from 'vitest';
import { tfn, registry, isFunction, isWorkflow } from './index';

describe('tfn.fn', () => {
  it('should create a function definition', () => {
    const greet = tfn.fn('greet', async (name: string) => `Hello, ${name}!`);

    expect(greet.name).toBe('greet');
    expect(greet.__type).toBe('function');
    expect(greet.options.startToCloseTimeout).toBe('1m');
    expect(registry.functions.has('greet')).toBe(true);
  });

  it('should create a function with custom options', () => {
    const process = tfn.fn(
      'processData',
      async (data: { value: number }) => data.value * 2,
      { startToCloseTimeout: '5m', retry: { maximumAttempts: 5 } }
    );

    expect(process.options.startToCloseTimeout).toBe('5m');
    expect(process.options.retry?.maximumAttempts).toBe(5);
  });

  it('should execute the handler correctly', async () => {
    const add = tfn.fn('add', async (nums: { a: number; b: number }) => nums.a + nums.b);
    const result = await add.handler({ a: 2, b: 3 });
    expect(result).toBe(5);
  });
});

describe('tfn.workflow', () => {
  it('should create a workflow definition', () => {
    const myWorkflow = tfn.workflow('myWorkflow', async (ctx, input: string) => {
      return `processed: ${input}`;
    });

    expect(myWorkflow.name).toBe('myWorkflow');
    expect(myWorkflow.__type).toBe('workflow');
    expect(myWorkflow.options.taskQueue).toBe('default');
    expect(registry.workflows.has('myWorkflow')).toBe(true);
  });

  it('should create a workflow with custom task queue', () => {
    const orderWorkflow = tfn.workflow(
      'orderWorkflow',
      async (ctx, order: { id: string }) => ({ orderId: order.id }),
      { taskQueue: 'orders' }
    );

    expect(orderWorkflow.options.taskQueue).toBe('orders');
  });
});

describe('isFunction / isWorkflow', () => {
  it('should correctly identify function definitions', () => {
    const fn = tfn.fn('testFn', async () => 'test');
    const wf = tfn.workflow('testWf', async () => 'test');

    expect(isFunction(fn)).toBe(true);
    expect(isFunction(wf)).toBe(false);
    expect(isFunction({})).toBe(false);
    expect(isFunction(null)).toBe(false);
  });

  it('should correctly identify workflow definitions', () => {
    const fn = tfn.fn('testFn2', async () => 'test');
    const wf = tfn.workflow('testWf2', async () => 'test');

    expect(isWorkflow(wf)).toBe(true);
    expect(isWorkflow(fn)).toBe(false);
    expect(isWorkflow({})).toBe(false);
    expect(isWorkflow(undefined)).toBe(false);
  });
});

describe('triggers', () => {
  it('should register http triggers', () => {
    const wf = tfn.workflow('httpWorkflow', async () => 'done');
    tfn.http('POST', '/api/test', wf);
    // Trigger registration is fire-and-forget, just ensure no errors
  });

  it('should register cron triggers', () => {
    const wf = tfn.workflow('cronWorkflow', async () => 'done');
    tfn.cron('0 * * * *', wf);
  });

  it('should register interval triggers', () => {
    const wf = tfn.workflow('intervalWorkflow', async () => 'done');
    tfn.interval('5m', wf);
  });
});
