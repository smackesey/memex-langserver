import * as LSP from 'vscode-languageserver';
import { SyntaxNode } from 'tree-sitter';
import Store from './store';
import {
  staticImplements,
} from './util';
import Document from './types/document';

export type Citation = {
  node: SyntaxNode,
  citekey: string,
  type: 'reference' | 'section',
}

export interface PropertyCacher {
  cache: Map<(string | symbol), any>,
  clearCache(): void,
}

export interface SectionTreeNode {
  number: string,
  title: string,
  uri: FURI,
  line: number,
  citekey?: string,
  children: SectionTreeNode[],
}

export interface FileTreeNode {
  filename: string,
  children: FileTreeNode[],
}

export interface Citeable {
  citekey: string | undefined
}

export type DiagnosticCode = (
  'broken-image-reference' |
  'syntax-error' |
  'missing-section-citation' |
  'missing-reference-citation' |
  'broken-reference-citation' |
  'broken-section-citation' |
  'broken-include' |
  'broken-reference-key' |
  'stale-reference-key' |
  'undefined-directive'
);

export type FURI = string;

export type QueryScope = 'document' | 'workspace';

// export type TextSymbolType = 'media-file-path' | 'section-citekey' | 'reference-citekey';
export type TextSymbolType = string;  // TODO need to return to above

export type TextSymbol = {
  documentUri: FURI,
  node: SyntaxNode,
  type: TextSymbolType,
};

export type TextContext = {
  precedingLine: string | null,
  lineLeft: string,
  lineRight: string,
  wordLeft: string,
  word: string,
  wordRight: string,
  wordRange: LSP.Range,
};

export type ReferenceType = 'mail' | 'media' | 'record' | 'web' | 'unknown';

export type CitationNodes = {
  root: SyntaxNode,
};

// ########################
// ##### CONFIG
// ########################

export type Config = {
  enable: boolean,
  logMode: LogMode,
  projectRootPatterns: string[],
  redisURL: string | undefined,
};

export type LogMode = 'console' | { path: string };

// ########################
// ##### MODELS
// ########################

export interface IdCounter {
  idCounter: number,
}

export abstract class Model {

  protected store: Store;
  public id: number;

  constructor(store: Store) {
    this.store = store;
    const klass = this.constructor as unknown as IdCounter;
    klass.idCounter += 1;
    this.id = klass.idCounter;
  }

}

// ****************************************************************************
// ****** JOB *****************************************************************

@staticImplements<IdCounter>()
export class Job extends Model {

  static idCounter = 0;

  public taskId: number;
  public promise: Promise<void>;
  public fulfill: Function;
  public reject: Function;

  constructor(store: Store, input: JobInput) {
    super(store);
    this.taskId = input.taskId;
    let f;
    let r;
    this.promise = new Promise<void>((fulfill, reject) => {
      f = fulfill;
      r = reject;
    });
    this.fulfill = f as unknown as Function;
    this.reject = r as unknown as Function;
  }

  // We assume referential integrity here.
  get task() {
    return this.store.tasks.by('id', this.taskId) as Task;
  }

}

type JobInput = {
  taskId: number,
};

// ****************************************************************************
// ****** TASK ****************************************************************

@staticImplements<IdCounter>()
export class Task extends Model {

  static idCounter = 0;

  public operation: TaskOperation;
  public documentId: number | undefined;
  public workspaceId: number | undefined;
  public dependencyIds: number[];
  public lastCompleted: number | undefined;

  constructor(store: Store, input: TaskInput) {
    super(store);
    this.operation = input.operation;
    this.documentId = input.documentId;
    this.workspaceId = input.workspaceId;
    this.dependencyIds = input.dependencyIds || [];
  }

  get type(): TaskType { return this.documentId ? 'document' : 'workspace'; }
  get document() { return this.store.documents.by('id', this.documentId) as Document; }
  get job() { return this.store.jobs.by('taskId', this.id); }
  get dependencies() {
    return this.store.tasks.find({ id: { $in: this.dependencyIds } });
  }

}

export type TaskType = 'document' | 'workspace';

export type TaskInput = {
  operation: TaskOperation,
  documentId?: number,
  workspaceId?: number,
  dependencyIds?: number[],
};

export enum TaskOperation {
  audit = 'audit',
  extract = 'extract',
  index = 'index',
}
