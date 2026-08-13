import type { ScreeningEngine, RunRecord } from '../services/screening.js';
import { demoCompanyRound, demoRoleRound } from './candidates.js';

/** Network-free connector that emits the same persisted run states as the screening engine. */
export class DemoConnector {
  constructor(private readonly engine: ScreeningEngine) {}

  start(jobId: string): RunRecord { return this.engine.startRun(jobId, [demoCompanyRound, demoRoleRound]); }
  pause(runId: string): RunRecord { return this.engine.pauseRun(runId); }
  resume(runId: string): RunRecord { return this.engine.resumeRun(runId); }
  get(runId: string): RunRecord { return this.engine.getRun(runId); }
  async process(runId: string, limit: number): Promise<RunRecord> {
    let run = this.engine.getRun(runId);
    for (let index = 0; index < limit && run.status === 'running'; index += 1) run = await this.engine.processNext(runId);
    return run;
  }
}
