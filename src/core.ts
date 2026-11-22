// The library without Node: nothing here reads a disk or imports `node:`. It runs in a browser or a Worker.
export { Document, type Marker, Marked, type ResolveOptions, TestResult } from './document.js';
export { Expression, Formula, Text } from './expression.js';
export { HostFunction } from './functions.js';
export { type FileText, Files, MemoryFiles } from './files.js';
export { Problem, ResolveFailed, ScriptedYamlError, type Severity, ValidationFailed } from './problem.js';
export { type FileOptions, ScriptedYaml, type ScriptedYamlOptions } from './scripted-yaml.js';
export { Variable } from './variables.js';
