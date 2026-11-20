/**
 * The controllers `router.yml` imports. A route names an action (`Users.me`) or a whole
 * controller (`resources /tests/:test!: Tests`).
 *
 * Each action is written on its own class: FEEL reads `Users.me` as a field of `Users`,
 * and it does not see a field a class inherits. Actions are synchronous: a formula cannot wait.
 */
export type Request = { params: Record<string, string> };

export class Health {
  static show = (_request: Request) => 'Health.show';
}

export class Sessions {
  static create = (_request: Request) => 'Sessions.create';
  static destroy = (_request: Request) => 'Sessions.destroy';
}

export class Webhooks {
  static github = (_request: Request) => 'Webhooks.github';
}

export class Users {
  static me = (_request: Request) => 'Users.me';
}

export class Tokens {
  static index = (_request: Request) => 'Tokens.index';
  static create = (_request: Request) => 'Tokens.create';
  static destroy = (_request: Request) => 'Tokens.destroy';
}

export class Projects {
  static index = (_request: Request) => 'Projects.index';
  static create = (_request: Request) => 'Projects.create';
  static show = (_request: Request) => 'Projects.show';
  static update = (_request: Request) => 'Projects.update';
}

export class Tests {
  static index = (_request: Request) => 'Tests.index';
  static show = (_request: Request) => 'Tests.show';
  static create = (_request: Request) => 'Tests.create';
  static update = (_request: Request) => 'Tests.update';
  static destroy = (_request: Request) => 'Tests.destroy';
}

export class Runs {
  static index = (_request: Request) => 'Runs.index';
  static show = (_request: Request) => 'Runs.show';
  static create = (_request: Request) => 'Runs.create';
  static rerun = (_request: Request) => 'Runs.rerun';
  static report = (_request: Request) => 'Runs.report';
}

class Members {
  static index = (_request: Request) => 'Admin.Members.index';
  static show = (_request: Request) => 'Admin.Members.show';
  static create = (_request: Request) => 'Admin.Members.create';
  static update = (_request: Request) => 'Admin.Members.update';
  static destroy = (_request: Request) => 'Admin.Members.destroy';
}

class Stats {
  static show = (_request: Request) => 'Admin.Stats.show';
}

class AdminProjects {
  static destroy = (_request: Request) => 'Admin.Projects.destroy';
}

export class Admin {
  static readonly Members = Members;
  static readonly Stats = Stats;
  static readonly Projects = AdminProjects;
}
