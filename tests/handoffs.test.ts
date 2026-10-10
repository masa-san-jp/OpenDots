import { expect, it } from 'vitest';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import {
  completeHandoff,
  createHandoff,
  HANDOFF_MAX_PER_THREAD,
} from '../src/server/handoffs.js';

function setup() {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const space = workspace.spaces()[0];
  const prep = workspace.createDot(space.id, 'Prep', 'Check mail', true, true);
  const writer = workspace.createDot(space.id, 'Writer', 'Draft', true, true);
  workspace.bindThread('owner-thread', prep.id, 'Check-in');
  return { store, workspace, prep, writer };
}

it('queues a handoff in a new thread of the target Dot and returns the result to the sender', () => {
  const { store, workspace, prep, writer } = setup();
  const sent = createHandoff(store, workspace, prep.id, 'owner-thread', {
    dot: 'writer',
    task: 'Draft a reply to Sato',
    context: 'Sato asked for the revised estimate.',
  });
  expect(sent).toMatchObject({ to: 'Writer', status: 'queued' });
  const request = store
    .tasks()
    .find((task) => task.prompt.includes('Draft a reply to Sato'))!;
  expect(request.prompt).toContain('Sato asked for the revised estimate.');
  const requestThread = workspace.taskThread(request.id)!;
  expect(workspace.requireThread(requestThread, writer.id).dotId).toBe(
    writer.id,
  );
  expect(workspace.handoffDepth(requestThread)).toBe(1);

  completeHandoff(store, workspace, request.id, { text: 'Dear Sato, ...' });
  const reply = store
    .tasks()
    .find((task) => task.prompt.includes('Dear Sato'))!;
  expect(workspace.taskThread(reply.id)).toBe('owner-thread');
  expect(workspace.handoffForTask(request.id)?.status).toBe('completed');

  // Finishing the reply closes the loop without queueing anything else.
  const before = store.tasks().length;
  completeHandoff(store, workspace, reply.id, {
    text: 'Summary for the owner',
  });
  expect(store.tasks()).toHaveLength(before);
  expect(workspace.handoffForTask(reply.id)?.status).toBe('completed');
  store.close();
  workspace.close();
});

it('reports a failed handoff back to the sender', () => {
  const { store, workspace, prep } = setup();
  createHandoff(store, workspace, prep.id, 'owner-thread', {
    dot: 'Writer',
    task: 'Draft it',
  });
  const request = store.tasks()[0];
  completeHandoff(store, workspace, request.id, {
    error: 'Time limit reached.',
  });
  expect(workspace.handoffForTask(request.id)?.status).toBe('failed');
  const reply = store
    .tasks()
    .find((task) => task.prompt.includes('Time limit reached.'))!;
  expect(workspace.taskThread(reply.id)).toBe('owner-thread');
  store.close();
  workspace.close();
});

it('rejects unknown targets, self handoffs, deep chains, and runaway conversations', () => {
  const { store, workspace, prep, writer } = setup();
  expect(() =>
    createHandoff(store, workspace, prep.id, 'owner-thread', {
      dot: 'Nobody',
      task: 'Help',
    }),
  ).toThrow(/Available: Dot, Writer/);
  expect(() =>
    createHandoff(store, workspace, prep.id, 'owner-thread', {
      dot: 'Prep',
      task: 'Help',
    }),
  ).toThrow();

  createHandoff(store, workspace, prep.id, 'owner-thread', {
    dot: 'Writer',
    task: 'Level one',
  });
  const levelOne = workspace.taskThread(store.tasks()[0].id)!;
  createHandoff(store, workspace, writer.id, levelOne, {
    dot: 'Prep',
    task: 'Level two',
  });
  const levelTwo = workspace.taskThread(
    store.tasks().find((task) => task.prompt.includes('Level two'))!.id,
  )!;
  expect(() =>
    createHandoff(store, workspace, prep.id, levelTwo, {
      dot: 'Writer',
      task: 'Level three',
    }),
  ).toThrow(/already handed off/);

  for (let i = 1; i < HANDOFF_MAX_PER_THREAD; i++)
    createHandoff(store, workspace, prep.id, 'owner-thread', {
      dot: 'Writer',
      task: `Task ${i}`,
    });
  expect(() =>
    createHandoff(store, workspace, prep.id, 'owner-thread', {
      dot: 'Writer',
      task: 'One more',
    }),
  ).toThrow(/limit/);
  store.close();
  workspace.close();
});
