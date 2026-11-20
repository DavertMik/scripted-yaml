/** The controllers the router fixture imports. Each action is its own static field: FEEL does not see inherited ones. */
export class Health {
  static show = () => 'ok';
}

export class Sessions {
  static create = () => 'signed in';
}

export class Users {
  static me = () => 'me';
}

export class Projects {
  static index = () => 'projects';
  static create = () => 'project created';
  static show = () => 'project';
  static destroy = () => 'project deleted';
}

export class Runs {
  static index = () => 'runs';
  static show = () => 'run';
  static create = () => 'run created';
  static update = () => 'run updated';
  static destroy = () => 'run deleted';
  static rerun = () => 'run again';
}
