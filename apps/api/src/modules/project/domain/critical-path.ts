/**
 * Schedule, slack and the critical path (doc 15 §3).
 *
 * Answers the only scheduling question a project manager really needs: which
 * tasks, if they slip by a day, move the completion date by a day.
 *
 * Pure: durations in days, no calendar. Working days, holidays and site
 * closures belong to a calendar the facility configures; folding them in here
 * would bake one country's holidays into the engine.
 *
 * A dependency cycle is REFUSED rather than broken arbitrarily. A schedule
 * silently computed from a graph the planner did not intend is worse than an
 * error telling them what they drew.
 */

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface ScheduleTask {
  id: string;
  reference: string;
  name: string;
  /** Estimated duration. A zero-duration task is a milestone. */
  durationDays: number;
}

export interface ScheduleDependency {
  taskId: string;
  predecessorId: string;
  dependencyType: DependencyType;
  lagDays: number;
}

export interface ScheduledTask extends ScheduleTask {
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  /** Days this task may slip without moving the project's finish date. */
  slackDays: number;
  isCritical: boolean;
}

export interface Schedule {
  tasks: ScheduledTask[];
  /** Days from project start to the last finish. */
  durationDays: number;
  /** References of the tasks with no slack, in schedule order. */
  criticalPath: string[];
}

export class ScheduleCycleError extends Error {
  constructor(readonly taskIds: string[]) {
    super(
      `These tasks depend on each other in a cycle and cannot be scheduled: ${taskIds.join(' -> ')}. ` +
        'Remove one of the dependencies.',
    );
    this.name = 'ScheduleCycleError';
  }
}

export class UnknownPredecessorError extends Error {
  constructor(readonly taskId: string, readonly predecessorId: string) {
    super(`Task ${taskId} depends on ${predecessorId}, which is not among the tasks being scheduled.`);
    this.name = 'UnknownPredecessorError';
  }
}

export function computeSchedule(
  tasks: readonly ScheduleTask[],
  dependencies: readonly ScheduleDependency[],
): Schedule {
  if (tasks.length === 0) {
    return { tasks: [], durationDays: 0, criticalPath: [] };
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));

  for (const dependency of dependencies) {
    if (!byId.has(dependency.predecessorId)) {
      throw new UnknownPredecessorError(dependency.taskId, dependency.predecessorId);
    }
    if (!byId.has(dependency.taskId)) {
      throw new UnknownPredecessorError(dependency.taskId, dependency.predecessorId);
    }
  }

  const order = topologicalOrder(tasks, dependencies);

  const predecessorsOf = new Map<string, ScheduleDependency[]>();
  const successorsOf = new Map<string, ScheduleDependency[]>();

  for (const dependency of dependencies) {
    predecessorsOf.set(dependency.taskId, [...(predecessorsOf.get(dependency.taskId) ?? []), dependency]);
    successorsOf.set(dependency.predecessorId, [...(successorsOf.get(dependency.predecessorId) ?? []), dependency]);
  }

  // Forward pass: the earliest each task can start and finish.
  const earliestStart = new Map<string, number>();
  const earliestFinish = new Map<string, number>();

  for (const id of order) {
    const task = byId.get(id)!;
    let start = 0;

    for (const dependency of predecessorsOf.get(id) ?? []) {
      const predecessorStart = earliestStart.get(dependency.predecessorId)!;
      const predecessorFinish = earliestFinish.get(dependency.predecessorId)!;
      const lag = dependency.lagDays;

      switch (dependency.dependencyType) {
        case 'FS':
          start = Math.max(start, predecessorFinish + lag);
          break;
        case 'SS':
          start = Math.max(start, predecessorStart + lag);
          break;
        case 'FF':
          // This task must finish no earlier than the predecessor finishes,
          // so its start is pushed back by its own duration.
          start = Math.max(start, predecessorFinish + lag - task.durationDays);
          break;
        case 'SF':
          start = Math.max(start, predecessorStart + lag - task.durationDays);
          break;
      }
    }

    earliestStart.set(id, start);
    earliestFinish.set(id, start + task.durationDays);
  }

  const projectFinish = Math.max(...order.map((id) => earliestFinish.get(id)!));

  // Backward pass: the latest each task can run without moving that finish.
  const latestFinish = new Map<string, number>();
  const latestStart = new Map<string, number>();

  for (const id of [...order].reverse()) {
    const task = byId.get(id)!;
    const successors = successorsOf.get(id) ?? [];

    let finish = successors.length === 0 ? projectFinish : Number.POSITIVE_INFINITY;

    for (const dependency of successors) {
      const successor = byId.get(dependency.taskId)!;
      const successorStart = latestStart.get(dependency.taskId)!;
      const successorFinish = latestFinish.get(dependency.taskId)!;
      const lag = dependency.lagDays;

      switch (dependency.dependencyType) {
        case 'FS':
          finish = Math.min(finish, successorStart - lag);
          break;
        case 'SS':
          finish = Math.min(finish, successorStart - lag + task.durationDays);
          break;
        case 'FF':
          finish = Math.min(finish, successorFinish - lag);
          break;
        case 'SF':
          finish = Math.min(finish, successorFinish - lag + task.durationDays);
          break;
      }

      // Keeps the compiler honest about the unused binding while documenting
      // that the successor's duration plays no part in these relations.
      void successor;
    }

    latestFinish.set(id, finish);
    latestStart.set(id, finish - task.durationDays);
  }

  const scheduled: ScheduledTask[] = order.map((id) => {
    const task = byId.get(id)!;
    const slack = latestStart.get(id)! - earliestStart.get(id)!;

    return {
      ...task,
      earliestStart: earliestStart.get(id)!,
      earliestFinish: earliestFinish.get(id)!,
      latestStart: latestStart.get(id)!,
      latestFinish: latestFinish.get(id)!,
      slackDays: slack,
      // Floating point never enters here: durations and lags are whole days.
      isCritical: slack === 0,
    };
  });

  return {
    tasks: scheduled,
    durationDays: projectFinish,
    criticalPath: scheduled.filter((task) => task.isCritical).map((task) => task.reference),
  };
}

/**
 * Tasks in an order where every predecessor comes first.
 *
 * Kahn's algorithm, with ties broken by the task's own order so the result is
 * deterministic — two runs over the same project must produce the same
 * critical path, or nobody can tell whether a change moved it.
 */
function topologicalOrder(
  tasks: readonly ScheduleTask[],
  dependencies: readonly ScheduleDependency[],
): string[] {
  const position = new Map(tasks.map((task, index) => [task.id, index]));
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const dependency of dependencies) {
    indegree.set(dependency.taskId, (indegree.get(dependency.taskId) ?? 0) + 1);
    outgoing.set(dependency.predecessorId, [
      ...(outgoing.get(dependency.predecessorId) ?? []),
      dependency.taskId,
    ]);
  }

  const ready = tasks
    .filter((task) => indegree.get(task.id) === 0)
    .map((task) => task.id)
    .sort((a, b) => position.get(a)! - position.get(b)!);

  const order: string[] = [];

  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);

    for (const next of outgoing.get(id) ?? []) {
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);

      if (remaining === 0) {
        ready.push(next);
        ready.sort((a, b) => position.get(a)! - position.get(b)!);
      }
    }
  }

  if (order.length !== tasks.length) {
    // Whatever is left is in, or downstream of, a cycle.
    const stuck = tasks.filter((task) => !order.includes(task.id)).map((task) => task.reference);
    throw new ScheduleCycleError(stuck);
  }

  return order;
}

/**
 * Project completion, weighted by the tasks' own weights.
 *
 * Weighted because tasks are not equal: pouring a floor slab and ordering a
 * kettle are both one task, and a simple count would report a project half
 * done when the slab had not been poured (§10 — derived on read, never stored).
 */
export function completionPercent(
  tasks: ReadonlyArray<{ weight: number; percentComplete: number; status: string }>,
): { percent: number; countedTasks: number; note?: string } {
  const counted = tasks.filter((task) => task.status !== 'CANCELLED');

  if (counted.length === 0) {
    return { percent: 0, countedTasks: 0, note: 'This project has no tasks, so it has no measurable progress.' };
  }

  const totalWeight = counted.reduce((sum, task) => sum + task.weight, 0);

  if (totalWeight === 0) {
    return {
      percent: 0,
      countedTasks: counted.length,
      note: 'Every task carries a weight of zero, so progress cannot be weighted. Give the tasks weights.',
    };
  }

  const weighted = counted.reduce((sum, task) => sum + task.weight * task.percentComplete, 0);

  return { percent: Math.round((weighted / totalWeight) * 100) / 100, countedTasks: counted.length };
}
