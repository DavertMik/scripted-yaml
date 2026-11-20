import { Formula, type Marker } from '../../../src/index';
import { Parser } from '../parser';

/** A shell command found in a pipeline. Kept, not run: the runner decides when. */
export class ShellCommand {
  constructor(
    readonly shell: string,
    private readonly succeeds: (shell: string) => boolean,
  ) {}

  /** Called by scripted-yaml only when a formula reads this value: "1" when the command succeeds. */
  toString(): string {
    return this.succeeds(this.shell) ? '1' : '0';
  }
}

export interface PlannedStage {
  id: string;
  title: string;
  runs: boolean;
  /** The shell command of the stage, as written. Not run. */
  command?: string;
  /** The prompt of the stage, with its `{{ }}` filled in. */
  task?: string;
  /** When the stage does not run: the message of each prerequisite that is not met. */
  skipped?: string[];
}

export interface Plan {
  name: string;
  stages: PlannedStage[];
}

type Prerequisite = { $value: unknown; message: string };
type Stage = { id: string; title: string; when?: unknown; run?: unknown; task?: string };

/** Loads a pipeline and says which stages run, and with which command. It runs none of them. */
export class PipelineParser extends Parser<Plan> {
  /** `succeeds` answers a command a condition depends on, such as `$value!sh: git diff --quiet`. */
  constructor(private readonly succeeds: (shell: string) => boolean) {
    super();
  }

  protected markers(): Record<string, Marker> {
    return { sh: (source: string) => new ShellCommand(source, this.succeeds) };
  }

  async parse(file: string, vars: Record<string, unknown> = {}): Promise<Plan> {
    const pipeline = await this.load(file);
    const result = await pipeline.resolve({ vars });
    const prerequisites: Record<string, Prerequisite> = result.prerequisites ?? {};

    const stages = (result.stages as Stage[]).map((stage, index) => {
      const planned: PlannedStage = { id: stage.id, title: stage.title, runs: stage.when !== false };
      if (stage.run instanceof ShellCommand) planned.command = stage.run.shell;
      if (stage.task !== undefined) planned.task = stage.task;
      const condition = pipeline.data.stages[index].when;
      if (!planned.runs && condition instanceof Formula) planned.skipped = this.reasons(condition, prerequisites);
      return planned;
    });
    return { name: result.name, stages };
  }

  /** The messages of the prerequisites a condition reads and that are not met. */
  private reasons(condition: Formula, prerequisites: Record<string, Prerequisite>): string[] {
    return condition.reads
      .map((read) => read.split('.'))
      .filter(([head, name]) => head === 'prerequisites' && name !== undefined && prerequisites[name]?.$value === false)
      .map(([, name]) => prerequisites[name!]!.message);
  }
}
