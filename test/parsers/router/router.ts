import { type Document, Formula, type Marker } from '../../../src/index';
import { Parser } from '../parser';

export interface Request {
  method: string;
  path: string;
  /** The signed-in user; leave out when signed out. */
  user?: object;
}

/** One route of a router file. */
export class Route {
  constructor(
    readonly method: string,
    readonly path: string,
    /** The handler as written in the file: `Users.me`. */
    readonly handler: string,
    /** The access rules of the groups around the route, outermost first, as written. */
    readonly allow: string[],
    /** Every name those rules read. */
    readonly reads: string[],
    /** The keys that lead to the route's group in the file. */
    readonly groups: string[],
    /** The key of the route in its group, and for a `resources` line the action it stands for. */
    readonly key: string,
    readonly action?: string,
  ) {}

  /** The path parameters of a request path, or undefined when the path is not this route's. */
  params(path: string): Record<string, string> | undefined {
    const wanted = this.path.split('/');
    const given = path.split('/');
    if (wanted.length !== given.length) return undefined;
    const params: Record<string, string> = {};
    for (const [index, part] of wanted.entries()) {
      if (part.startsWith(':')) params[part.slice(1)] = given[index]!;
      else if (part !== given[index]) return undefined;
    }
    return params;
  }
}

/** A request and the route it belongs to. */
export class Match {
  constructor(
    readonly route: Route,
    readonly params: Record<string, string>,
    private readonly group: Record<string, unknown>,
  ) {}

  /** Calls the handler the router file imported for this route. */
  handle(): unknown {
    const entry = this.group[this.route.key] as Record<string, unknown>;
    const controller = (typeof entry === 'function' ? entry : entry.to) as Record<string, unknown>;
    const handler = this.route.action ? controller[this.route.action] : entry;
    return (handler as () => unknown)();
  }
}

type Group = Record<string, unknown>;

/** Turns a router file into a flat list of routes, each with its method, path, handler and access rules. */
export class RouterParser extends Parser<Route[]> {
  /** The routes `resources /things/:thing` stands for: the action, its method, and whether it is about one thing. */
  private static readonly resources: [string, string, boolean][] = [
    ['index', 'GET', false],
    ['create', 'POST', false],
    ['show', 'GET', true],
    ['update', 'PATCH', true],
    ['destroy', 'DELETE', true],
  ];
  private static readonly settings = ['allow', 'limit'];

  private readonly documents = new Map<string, Promise<Document>>();

  protected markers(): Record<string, Marker> {
    return {};
  }

  async parse(file: string): Promise<Route[]> {
    const router = await this.document(file);
    return this.routes(router.data.routes, '', [], []);
  }

  /** The route a request belongs to, with its path parameters. */
  async match(file: string, request: Request): Promise<Match | undefined> {
    const found = await this.find(file, request);
    if (!found) return undefined;
    const resolved = await this.resolve(file, request, found.params);
    return new Match(found.route, found.params, this.groups(resolved.routes, found.route).at(-1)!);
  }

  /** True when every `allow!` around the request's route is true for this request. */
  async allowed(file: string, request: Request): Promise<boolean> {
    const found = await this.find(file, request);
    if (!found) return false;
    const resolved = await this.resolve(file, request, found.params);
    return this.groups(resolved.routes, found.route).every((group) => group.allow === undefined || group.allow === true);
  }

  private document(file: string): Promise<Document> {
    if (!this.documents.has(file)) this.documents.set(file, this.load(file));
    return this.documents.get(file)!;
  }

  private async find(file: string, request: Request): Promise<{ route: Route; params: Record<string, string> } | undefined> {
    for (const route of await this.parse(file)) {
      const params = route.method === request.method ? route.params(request.path) : undefined;
      if (params) return { route, params };
    }
    return undefined;
  }

  /** The file computed for one request: a path parameter `:project` is the variable `vars.project`. */
  private async resolve(file: string, request: Request, params: Record<string, string>): Promise<{ routes: Group }> {
    return (await this.document(file)).resolve({ vars: { ...params, method: request.method, user: request.user } });
  }

  /** The groups around a route, outermost first, in data or in a result. */
  private groups(routes: Group, route: Route): Group[] {
    const groups = [routes];
    for (const key of route.groups) groups.push(groups.at(-1)![key] as Group);
    return groups;
  }

  private routes(group: Group, prefix: string, rules: Formula[], keys: string[]): Route[] {
    const own = group.allow instanceof Formula ? [...rules, group.allow] : rules;
    const allow = own.map((rule) => rule.source);
    const reads = [...new Set(own.flatMap((rule) => rule.reads))];
    const routes: Route[] = [];
    for (const [key, value] of Object.entries(group)) {
      if (RouterParser.settings.includes(key)) continue;
      if (key.startsWith('/')) {
        routes.push(...this.routes(value as Group, prefix + key, own, [...keys, key]));
        continue;
      }
      const space = key.indexOf(' ');
      const word = key.slice(0, space);
      const path = this.join(prefix, key.slice(space + 1));
      if (word !== 'resources') {
        routes.push(new Route(word, path, (value as Formula).source, allow, reads, keys, key));
        continue;
      }
      const controller = value instanceof Formula ? value : ((value as Group).to as Formula);
      const only = value instanceof Formula ? undefined : ((value as Group).only as string[] | undefined);
      const collection = path.slice(0, path.lastIndexOf('/'));
      for (const [action, method, one] of RouterParser.resources) {
        if (only && !only.includes(action)) continue;
        routes.push(new Route(method, one ? path : collection, `${controller.source}.${action}`, allow, reads, keys, key, action));
      }
    }
    return routes;
  }

  private join(prefix: string, path: string): string {
    return path === '/' ? prefix : prefix + path;
  }
}
