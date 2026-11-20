import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { RouterParser } from './router';

const file = join(import.meta.dir, 'fixtures/router.yml');
const parser = new RouterParser();
const line = (route: { method: string; path: string; handler: string }) => `${route.method} ${route.path} -> ${route.handler}`;

describe('router parser', () => {
  test('the fixture is a valid router', async () => {
    expect(await parser.validate(file)).toEqual([]);
  });

  test('a router file becomes a flat list of routes', async () => {
    const routes = await parser.parse(file);
    expect(routes.map(line)).toEqual([
      'GET /health -> Health.show',
      'POST /login -> Sessions.create',
      'GET /api/me -> Users.me',
      'GET /api/projects -> Projects.index',
      'POST /api/projects -> Projects.create',
      'GET /api/projects/:project -> Projects.show',
      'GET /api/projects/:project/runs -> Runs.index',
      'POST /api/projects/:project/runs -> Runs.create',
      'GET /api/projects/:project/runs/:run -> Runs.show',
      'PATCH /api/projects/:project/runs/:run -> Runs.update',
      'DELETE /api/projects/:project/runs/:run -> Runs.destroy',
      'POST /api/projects/:project/runs/:run/rerun -> Runs.rerun',
      'DELETE /admin/projects/:project -> Projects.destroy',
    ]);
  });

  test('each route carries the access rules of the groups around it, outermost first', async () => {
    const routes = await parser.parse(file);
    const rules = (path: string, method = 'GET') => routes.find((route) => route.path === path && route.method === method)!.allow;
    expect(rules('/health')).toEqual([]);
    expect(rules('/api/me')).toEqual(['signed_in']);
    expect(rules('/api/projects/:project')).toEqual(['signed_in', 'if vars.method = "GET" then in_project else writer']);
    expect(rules('/admin/projects/:project', 'DELETE')).toEqual(['admin']);
  });

  test('a route knows the names its rules depend on', async () => {
    const routes = await parser.parse(file);
    const show = routes.find((route) => route.handler === 'Projects.show')!;
    expect(show.reads).toEqual(['signed_in', 'vars.method', 'in_project', 'writer']);
  });

  test('a request finds its route and its path parameters', async () => {
    const match = await parser.match(file, { method: 'POST', path: '/api/projects/shop/runs/7/rerun' });
    expect(match?.route.handler).toBe('Runs.rerun');
    expect(match?.params).toEqual({ project: 'shop', run: '7' });
    expect(await parser.match(file, { method: 'GET', path: '/nowhere' })).toBeUndefined();
  });

  test('the access rule is computed for a request: all the rules around the route must hold', async () => {
    const viewer = { role: 'viewer', projects: ['shop'] };
    const editor = { role: 'editor', projects: ['shop'] };
    const allowed = (method: string, path: string, user?: object) => parser.allowed(file, { method, path, user });

    expect(await allowed('GET', '/health')).toBe(true);
    expect(await allowed('GET', '/api/me')).toBe(false);
    expect(await allowed('GET', '/api/me', viewer)).toBe(true);
    expect(await allowed('GET', '/api/projects/shop', viewer)).toBe(true);
    expect(await allowed('GET', '/api/projects/other', viewer)).toBe(false);
    expect(await allowed('POST', '/api/projects/shop/runs', viewer)).toBe(false);
    expect(await allowed('POST', '/api/projects/shop/runs', editor)).toBe(true);
    expect(await allowed('DELETE', '/admin/projects/shop', editor)).toBe(false);
    expect(await allowed('DELETE', '/admin/projects/shop', { role: 'admin', projects: [] })).toBe(true);
  });

  test('the handler of a matched route is the function the file imported', async () => {
    const match = await parser.match(file, { method: 'DELETE', path: '/api/projects/shop/runs/7' });
    expect(match?.handle()).toBe('run deleted');
  });

  test('the examples/router.yml file gives its routes too', async () => {
    const routes = await parser.parse(join(import.meta.dir, '../../../examples/router.yml'));
    expect(routes.length).toBe(29);
    expect(routes.map(line)).toContain('DELETE /admin/members/:member -> Admin.Members.destroy');
    expect(routes.map(line)).toContain('GET /api/v1/projects/:project/runs/:run/report.pdf -> Runs.report');
  });
});
