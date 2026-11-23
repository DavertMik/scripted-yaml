// The editor UI skill has no examples to run: it must be a skill, short, and name what the editor builds on.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const skill = readFileSync(join(import.meta.dir, '../skills/scripted-yaml-ui/SKILL.md'), 'utf8');

describe('skills/scripted-yaml-ui/SKILL.md', () => {
  test('has the front matter of a skill and stays within 240 lines', () => {
    const front = parse(skill.slice(4, skill.indexOf('\n---\n', 4)));
    expect(Object.keys(front)).toEqual(['name', 'description']);
    expect(front.name).toBe('scripted-yaml-ui');
    expect(front.description).toStartWith('Use when');
    expect(skill.split('\n').length).toBeLessThanOrEqual(240);
  });

  test('keeps editing to local files and says so', () => {
    for (const word of ['local or dev mode', 'on the server', '127.0.0.1', 'Save to file', 'Local editing']) expect(skill).toContain(word);
  });

  test('builds on the package and the yaml document, not on JSON', () => {
    for (const word of ['validateText', 'parseDocument', '$dsl', '$schema', 'range[0]']) expect(skill).toContain(word);
  });
});
