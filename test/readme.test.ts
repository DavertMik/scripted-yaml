// The example of README.md, run: the values written beside each line there are these.
import { expect, test } from 'bun:test';
import { Formula, ScriptedYaml, Text } from '../src/index';

class ShellCommand {
  constructor(readonly shell: string) {}
}

const text = `$vars:
  EXPLORBOT_URL: { optional: true }

prerequisites:
  staging:
    $value!: vars.EXPLORBOT_URL != null
    message: No staging URL. Set EXPLORBOT_URL to test in a browser.

stages:
  - id: plan
    title: Test plan
    when!: prerequisites.staging
    task: Turn the scenarios into a test plan for {{ vars.EXPLORBOT_URL }}.
    run!sh: npx explorbot plan
`;

test('the README example gives the values the README shows', async () => {
  const scripted = new ScriptedYaml({ markers: { sh: (source: string) => new ShellCommand(source) } });
  expect(await scripted.validate(text, { file: 'pipeline.yml' })).toEqual([]);

  const [problem] = await scripted.validate(text.replace('when!: prerequisites.staging', 'when!: prerequisite.staging'), { file: 'pipeline.yml' });
  expect(`${problem!.severity} ${problem}`).toBe('error pipeline.yml:12  stages.plan.when!  unknown name "prerequisite"; did you mean "prerequisites"?');

  const document = await scripted.parse(text, { file: 'pipeline.yml' });
  const plan = document.data.stages[0];
  expect(plan.when).toBeInstanceOf(Formula);
  expect(plan.when.source).toBe('prerequisites.staging');
  expect(plan.when.reads).toEqual(['prerequisites.staging']);
  expect(plan.task).toBeInstanceOf(Text);
  expect(plan.task.reads).toEqual(['vars.EXPLORBOT_URL']);
  expect(plan.run).toEqual(new ShellCommand('npx explorbot plan'));

  const result = await document.resolve({ vars: { EXPLORBOT_URL: 'https://staging.example.com' } });
  expect(result.stages[0].when).toBe(true);
  expect(result.stages[0].task).toBe('Turn the scenarios into a test plan for https://staging.example.com.');
  expect(result.prerequisites.staging).toEqual({ $value: true, message: 'No staging URL. Set EXPLORBOT_URL to test in a browser.' });
  expect(result.stages[0].run).toBe(plan.run);
  expect(document.variables.map((variable) => variable.name)).toEqual(['EXPLORBOT_URL']);
});
