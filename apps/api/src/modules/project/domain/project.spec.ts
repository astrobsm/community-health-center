import { describe, expect, it } from 'vitest';

import {
  assessReadiness,
  canAdvanceTo,
  COMMISSIONING_CHECKS,
  readinessSummary,
  type CommissioningChecks,
} from './commissioning';
import {
  completionPercent,
  computeSchedule,
  ScheduleCycleError,
  UnknownPredecessorError,
  type ScheduleDependency,
  type ScheduleTask,
} from './critical-path';

// -----------------------------------------------------------------------------
// Commissioning — acceptance criterion F
// -----------------------------------------------------------------------------

const allChecks = (overrides: Partial<CommissioningChecks> = {}): CommissioningChecks => ({
  functionalTestPassed: true,
  safetyCheckPassed: true,
  staffTrained: true,
  consumablesAvailable: true,
  utilitiesConnected: true,
  ...overrides,
});

const noChecks: CommissioningChecks = {
  functionalTestPassed: false,
  safetyCheckPassed: false,
  staffTrained: false,
  consumablesAvailable: false,
  utilitiesConnected: false,
};

describe('commissioning readiness', () => {
  it('is ready only when every check passes', () => {
    expect(assessReadiness(allChecks()).ready).toBe(true);
    expect(assessReadiness(allChecks({ staffTrained: false })).ready).toBe(false);
  });

  it('fails on any single outstanding check, whichever it is', () => {
    // "Every" is the point. Equipment that works but has nobody trained on it
    // is not a service the facility offers.
    for (const check of COMMISSIONING_CHECKS) {
      const one = allChecks({ [check.key]: false } as Partial<CommissioningChecks>);

      expect(assessReadiness(one).ready, check.label).toBe(false);
      expect(assessReadiness(one).outstanding.map((o) => o.key)).toEqual([check.key]);
    }
  });

  it('names what is outstanding rather than reporting a bare percentage', () => {
    const readiness = assessReadiness(allChecks({ consumablesAvailable: false, staffTrained: false }));

    expect(readiness.passed).toBe(3);
    expect(readiness.summary).toContain('staff trained');
    expect(readiness.summary).toContain('consumables available');
    expect(readiness.summary).toContain('not yet available for use');
  });

  it('says why each check matters, so it is not treated as a formality', () => {
    for (const check of COMMISSIONING_CHECKS) {
      expect(check.whyItMatters.length, check.label).toBeGreaterThan(30);
    }
  });
});

describe('advancing an asset through commissioning', () => {
  it('refuses COMMISSIONED until every check passes', () => {
    // Acceptance criterion F.
    const decision = canAdvanceTo('COMMISSIONED', 'TESTED', allChecks({ utilitiesConnected: false }));

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('utilities connected');
  });

  it('allows COMMISSIONED when they do', () => {
    expect(canAdvanceTo('COMMISSIONED', 'TESTED', allChecks()).allowed).toBe(true);
  });

  it('refuses TESTED without a functional test', () => {
    expect(canAdvanceTo('TESTED', 'INSTALLED', noChecks).allowed).toBe(false);
  });

  it('refuses to skip a step', () => {
    // Each step must have a date and a person against it.
    const decision = canAdvanceTo('COMMISSIONED', 'RECEIVED', allChecks());

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('INSTALLED first');
  });

  it('refuses to move backwards', () => {
    const decision = canAdvanceTo('RECEIVED', 'INSTALLED', allChecks());

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('cannot move back');
  });

  it('allows decommissioning from anywhere, because equipment breaks', () => {
    expect(canAdvanceTo('DECOMMISSIONED', 'RECEIVED', noChecks).allowed).toBe(true);
    expect(canAdvanceTo('DECOMMISSIONED', 'COMMISSIONED', allChecks()).allowed).toBe(true);
  });

  it('refuses to quietly recommission a decommissioned asset', () => {
    const decision = canAdvanceTo('COMMISSIONED', 'DECOMMISSIONED', allChecks());

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('receiving it again');
  });

  it('refuses a move to the status it already holds', () => {
    expect(canAdvanceTo('RECEIVED', 'RECEIVED', allChecks()).allowed).toBe(false);
  });
});

describe('service readiness across the register', () => {
  const assets = [
    { category: 'Theatre', commissioningStatus: 'COMMISSIONED' },
    { category: 'Theatre', commissioningStatus: 'INSTALLED' },
    { category: 'Laboratory', commissioningStatus: 'COMMISSIONED' },
    { category: 'Laboratory', commissioningStatus: 'RECEIVED' },
    { category: 'Laboratory', commissioningStatus: 'DECOMMISSIONED' },
  ];

  const summary = readinessSummary(assets);

  it('counts only commissioned assets as capacity', () => {
    // An asset in a crate is equipment the facility owns and cannot use.
    // Reporting it as capacity would put a figure in a government report the
    // facility cannot deliver against.
    expect(summary.commissioned).toBe(2);
    expect(summary.awaitingCommissioning).toBe(2);
    expect(summary.decommissioned).toBe(1);
  });

  it('breaks it down by category', () => {
    expect(summary.byCategory.Laboratory).toEqual({ total: 3, commissioned: 1 });
  });

  it('says plainly that the uncommissioned are excluded', () => {
    expect(summary.note).toContain('not yet available for use');
    expect(summary.note).toContain('excluded from service readiness');
  });

  it('says so when everything is accounted for', () => {
    const complete = readinessSummary([{ category: 'Theatre', commissioningStatus: 'COMMISSIONED' }]);

    expect(complete.note).toContain('either commissioned or decommissioned');
  });
});

// -----------------------------------------------------------------------------
// Schedule and critical path
// -----------------------------------------------------------------------------

const task = (reference: string, durationDays: number): ScheduleTask => ({
  id: reference,
  reference,
  name: reference,
  durationDays,
});

const dep = (
  taskId: string,
  predecessorId: string,
  dependencyType: ScheduleDependency['dependencyType'] = 'FS',
  lagDays = 0,
): ScheduleDependency => ({ taskId, predecessorId, dependencyType, lagDays });

describe('a simple chain', () => {
  /**
   *   A (5) -> B (3) -> D (2)
   *   A (5) -> C (1) -> D (2)
   *
   * A-B-D is 10 days; A-C-D is 8. The critical path is A, B, D and C has two
   * days of slack.
   */
  const tasks = [task('A', 5), task('B', 3), task('C', 1), task('D', 2)];
  const dependencies = [dep('B', 'A'), dep('C', 'A'), dep('D', 'B'), dep('D', 'C')];

  const schedule = computeSchedule(tasks, dependencies);
  const find = (reference: string) => schedule.tasks.find((t) => t.reference === reference)!;

  it('computes the project duration', () => {
    expect(schedule.durationDays).toBe(10);
  });

  it('computes earliest start and finish', () => {
    expect(find('A').earliestStart).toBe(0);
    expect(find('A').earliestFinish).toBe(5);
    expect(find('B').earliestStart).toBe(5);
    expect(find('D').earliestStart).toBe(8);
  });

  it('gives the longest route no slack', () => {
    expect(find('A').slackDays).toBe(0);
    expect(find('B').slackDays).toBe(0);
    expect(find('D').slackDays).toBe(0);
  });

  it('gives the shorter route the slack it actually has', () => {
    // C can slip two days before it starts moving D.
    expect(find('C').slackDays).toBe(2);
    expect(find('C').isCritical).toBe(false);
  });

  it('reports the critical path in schedule order', () => {
    expect(schedule.criticalPath).toEqual(['A', 'B', 'D']);
  });
});

describe('dependency types', () => {
  it('handles finish-to-start with a lag', () => {
    // Concrete must cure for seven days before the next task starts.
    const schedule = computeSchedule([task('POUR', 2), task('BUILD', 3)], [dep('BUILD', 'POUR', 'FS', 7)]);

    expect(schedule.tasks.find((t) => t.reference === 'BUILD')!.earliestStart).toBe(9);
    expect(schedule.durationDays).toBe(12);
  });

  it('handles start-to-start', () => {
    // Electrical first fix can start two days after plastering starts.
    const schedule = computeSchedule([task('PLASTER', 10), task('WIRE', 4)], [dep('WIRE', 'PLASTER', 'SS', 2)]);

    expect(schedule.tasks.find((t) => t.reference === 'WIRE')!.earliestStart).toBe(2);
    expect(schedule.durationDays).toBe(10);
  });

  it('handles finish-to-finish', () => {
    // Snagging must not finish before the works finish.
    const schedule = computeSchedule([task('WORKS', 10), task('SNAG', 3)], [dep('SNAG', 'WORKS', 'FF')]);

    const snag = schedule.tasks.find((t) => t.reference === 'SNAG')!;

    expect(snag.earliestFinish).toBe(10);
    expect(snag.earliestStart).toBe(7);
  });

  it('never schedules a task before the project starts', () => {
    const schedule = computeSchedule([task('A', 10), task('B', 2)], [dep('B', 'A', 'FF')]);

    for (const scheduled of schedule.tasks) {
      expect(scheduled.earliestStart).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('a schedule that cannot be computed', () => {
  it('refuses a cycle rather than breaking it arbitrarily', () => {
    // A schedule silently computed from a graph the planner did not intend is
    // worse than an error telling them what they drew.
    expect(() => computeSchedule([task('A', 1), task('B', 1)], [dep('A', 'B'), dep('B', 'A')])).toThrow(
      ScheduleCycleError,
    );
  });

  it('names the tasks caught in the cycle', () => {
    try {
      computeSchedule([task('A', 1), task('B', 1), task('C', 1)], [dep('A', 'B'), dep('B', 'A')]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ScheduleCycleError).taskIds).toEqual(['A', 'B']);
    }
  });

  it('refuses a dependency on a task that is not in the project', () => {
    expect(() => computeSchedule([task('A', 1)], [dep('A', 'GHOST')])).toThrow(UnknownPredecessorError);
  });

  it('handles an empty project without inventing a duration', () => {
    expect(computeSchedule([], [])).toEqual({ tasks: [], durationDays: 0, criticalPath: [] });
  });

  it('handles tasks with no dependencies at all', () => {
    const schedule = computeSchedule([task('A', 3), task('B', 7)], []);

    expect(schedule.durationDays).toBe(7);
    // A can slip four days before it matters; B cannot slip at all.
    expect(schedule.tasks.find((t) => t.reference === 'A')!.slackDays).toBe(4);
    expect(schedule.criticalPath).toEqual(['B']);
  });

  it('treats a zero-duration task as the milestone it is', () => {
    const schedule = computeSchedule(
      [task('WORKS', 5), task('SIGNOFF', 0), task('HANDOVER', 2)],
      [dep('SIGNOFF', 'WORKS'), dep('HANDOVER', 'SIGNOFF')],
    );

    const milestone = schedule.tasks.find((t) => t.reference === 'SIGNOFF')!;

    expect(milestone.earliestStart).toBe(5);
    expect(milestone.earliestFinish).toBe(5);
    expect(schedule.durationDays).toBe(7);
  });

  it('is deterministic however the tasks are ordered on input', () => {
    const tasks = [task('A', 5), task('B', 3), task('C', 1), task('D', 2)];
    const dependencies = [dep('B', 'A'), dep('C', 'A'), dep('D', 'B'), dep('D', 'C')];

    const forward = computeSchedule(tasks, dependencies);
    const reversed = computeSchedule(tasks, [...dependencies].reverse());

    expect(forward.criticalPath).toEqual(reversed.criticalPath);
    expect(forward.durationDays).toBe(reversed.durationDays);
  });
});

describe('project completion', () => {
  it('weights tasks rather than counting them', () => {
    // Pouring a floor slab and ordering a kettle are both one task. A count
    // would report this project half done when the slab was not poured.
    const percent = completionPercent([
      { weight: 9, percentComplete: 0, status: 'NOT_STARTED' },
      { weight: 1, percentComplete: 100, status: 'COMPLETED' },
    ]).percent;

    expect(percent).toBe(10);
  });

  it('ignores cancelled tasks', () => {
    const result = completionPercent([
      { weight: 1, percentComplete: 100, status: 'COMPLETED' },
      { weight: 1, percentComplete: 0, status: 'CANCELLED' },
    ]);

    expect(result.percent).toBe(100);
    expect(result.countedTasks).toBe(1);
  });

  it('says a project with no tasks has no measurable progress', () => {
    // Not 100%, which would read as finished, and not silently 0%.
    const result = completionPercent([]);

    expect(result.percent).toBe(0);
    expect(result.note).toContain('no tasks');
  });

  it('says so rather than dividing by zero when every weight is zero', () => {
    const result = completionPercent([{ weight: 0, percentComplete: 50, status: 'IN_PROGRESS' }]);

    expect(result.percent).toBe(0);
    expect(result.note).toContain('Give the tasks weights');
  });
});
