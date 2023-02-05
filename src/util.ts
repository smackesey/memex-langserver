import dedent from 'dedent';
import fg from 'fast-glob';
import fs from 'fs';
import * as LSP from 'vscode-languageserver';
import path from 'path';
import { Point, Range as TsRange, SyntaxNode } from 'tree-sitter';
import { Range } from 'vscode-languageserver';

import config from './config';
import Logger from './logger';
import {
  FURI,
  PropertyCacher,
  TextContext,
  TextSymbol,
  TextSymbolType,
} from './types';
import Document from './types/document';
import * as QW from './types/queryWrappers';
import { MediaType } from './types/workspace';
import { QueryMatch } from './types/tree-sitter';

const log = new Logger('util');

export const DEFINED_DIRECTIVES = [
  'code',
  'figure',
  'flag',
  'image-carousel',
  'math',
  'note',
  'references',
  'sections',
  'table',
  'tasks',
  'video',
];

// ****************************************************************************
// ****** CONVERSIONS *********************************************************

// ----- LSP POSITION TO TS POINT

export function lspPositionToTsPoint(position: LSP.Position): Point {
  return { row: position.line, column: position.character };
}

// ----- PATH TO URI

export function pathToUri(filePath: string): FURI {
  return `file://${filePath}`;
}

// ----- TS POINT COMPARE

// -1 if p1 < p2; 0 if equal; 1 if p1 greater
export function tsPointCompare(p1: Point, p2: Point) {
  if (p1.row < p2.row) {
    return -1;
  } else if (p1.row === p2.row) {
    if (p1.column < p2.column) return -1;
    else if (p1.column === p2.column) return 0;
    else return 1;
  } else {
    return 1;
  }
}

// ----- TS NODE TO LSP RANGE

export function tsNodeToLspRange(node: SyntaxNode) {
  return tsEndpointsToLspRange(node.startPosition, node.endPosition);
}

// ----- TS POINT TO LSP POSITION

export function tsPointToLspPosition(point: Point) {
  return {
    line: point.row,
    character: point.column,
  };
}

// ----- TS ENDPOINTS TO LSP RANGE

export function tsEndpointsToLspRange(start: Point, end: Point) {
  return Range.create(
    tsPointToLspPosition(start),
    tsPointToLspPosition(end),
  );
}

// ----- TS RANGE TO LSP RANGE

export function tsRangeToLspRange(range: TsRange) {
  return tsEndpointsToLspRange(range.startPosition, range.endPosition);
}

// ----- URI TO PATH

export function uriToPath(uri: FURI): string {
  return uri.slice(7);
}

// ****************************************************************************
// ****** FILESYSTEM **********************************************************

// ----- RESOLVE DOCUMENT WORKSPACE

export function resolveDocumentWorkspace(uri: FURI): FURI {
  let ipath = uriToPath(uri);  // remove file://
  while (ipath != null && ipath !== '/') {
    // eslint-disable-next-line no-loop-func
    const hasMarker = config.projectRootPatterns.some(x =>
      fs.existsSync(path.join(ipath, x)));
    if (hasMarker) return pathToUri(ipath);
    ipath = path.dirname(ipath);
  }
  return uri;
}

// ----- RESOLVE WORKSPACE DOCUMENTS

export function resolveWorkspaceDocuments(uri: FURI): FURI[] {
  const basePath = uriToPath(uri);
  const relPaths = fg.sync(['**/*.rst'], { cwd: basePath });
  return relPaths
    .filter(x => !/^(scratch\/|scratch.rst)/.test(x))
    .map(x => pathToUri(`${basePath}/${x}`));
}

// ****************************************************************************
// ****** GENERAL *************************************************************

// ----- ASSERT DEFINED

export function assertDefined<T>(x: T | undefined | null, cb?: () => never): asserts x is T {
  if (x === undefined || x === null) {
    if (cb) cb();
    else throw new Error('Illegal undefined value!');
  }
}

// ----- GROUP BY

export function groupBy<T, U>(
  ary: Array<T>,
  mapFunc: (x: T) => U,
): Map<U, T[]> {
  const result = new Map<U, T[]>();
  ary.forEach(elem => {
    const key = mapFunc(elem);
    if (result.has(key)) (result.get(key) ?? []).push(elem);
    else result.set(key, [elem]);
  });
  return result;
}

// ----- KEY BY

export function keyBy<T>(ary: T[], key: string): Map<string, T> {
  const result = new Map();
  ary.forEach((x: any) => {
    const val = x[key];
    if (val !== undefined) {
      result.set(val, x);
    }
  });
  return result;
}

// ----- SAFE GET

export function safeGet<T, U>(map: Map<T, U>, key: T): U {
  const val = map.get(key);
  if (val === undefined) throw new Error('key error');
  return val;
}

// ----- STATIC IMPLEMENTS

export function staticImplements<T>() {
  return <U extends T>(constructor: U) => (constructor);
}

// ****************************************************************************
// ****** LOKI ****************************************************************

// ----- SAFE COLLECTION GET

export function safeCollectionGet<T extends object>(collection: Collection<T>, field: keyof T, value: any): T {
  const record = collection.by(field, value);
  assertDefined<T>(record);
  return record;
}

// ****************************************************************************
// ****** MISC ****************************************************************

// ----- CACHED VALUE

export class TimeCachedValue<T> {

  private storedValue?: T;
  public timeLastComputed?: number;
  public lifespan: number;
  public computeFunction: () => T;

  constructor(lifespan: number, computeFunction: () => T) {
    this.lifespan = lifespan;
    this.computeFunction = computeFunction;
  }

  get value(): T {
    if (this.isStale()) {
      this.storedValue = this.computeFunction();
      this.timeLastComputed = Date.now();
    }
    assertDefined(this.storedValue);
    return this.storedValue;
  }

  isStale(): boolean {
    if (this.timeLastComputed === undefined) return true;
    else return (Date.now() - this.timeLastComputed) > this.lifespan;
  }

}

// ----- CLASSIFY MEDIA FILE

const EXT_TO_MEDIA_TYPE: { [ext: string]: MediaType } = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  mp4: 'video',
  avi: 'video',
  webm: 'video',
  gif: 'image',
  pdf: 'document',
};

export function classifyMediaFile(relPath: string): MediaType {
  return EXT_TO_MEDIA_TYPE[path.extname(relPath).substr(1)] ?? 'unknown';
}

// ----- EQUAL POSITIONS

export function equalPositions(node1: SyntaxNode, node2: SyntaxNode): boolean {
  return node1.startIndex === node2.startIndex && node1.endIndex === node2.endIndex;
}

// ----- FORMAT REFERENCE TEXT

export function formatReferenceText(ref: QW.Reference): string {
  const { header, annotation } = ref;
  if (annotation) {
    return dedent`
      ${header}
      ${annotation}
    `;
  } else {
    return header;
  }
}

// ----- GET CAPTURE

export function getCapture<B extends boolean>(
  match: QueryMatch, key: string, allowUndefined: B,
): B extends true ? (SyntaxNode | undefined) : SyntaxNode {
  const m = match.captures.find((x: any) => x.name === key);
  if (m === undefined && !allowUndefined) {
    throw new Error(`Required capture ${key} missing.`);
  } else {
    return m?.node as any;
  }
}

// ----- MEMOIZE

export function memoize<T extends PropertyCacher>(): MethodDecorator {
  return (_target: any, name: string | symbol, descriptor: PropertyDescriptor) => {
    if ('get' in descriptor) {
      const func = descriptor.get;
      assertDefined<Function>(func);
      descriptor.get = memoizer<T>(name, func);
    }
    return descriptor;
  };
}

function memoizer<T extends PropertyCacher>(name: string | symbol, func: Function) {
  // eslint-disable-next-line func-names
  return function (this: T, ...args: any[]): any {
    if (!this.cache.has(name)) {
      this.cache.set(name, func.apply(this, args));
    }
    return this.cache.get(name);
  };
}

// ----- RANGE INTERSECTION

export function rangeIntersection(
  range1: LSP.Range,
  range2: LSP.Range,
): LSP.Range | null {

  // find start
  let start: LSP.Position;
  const [r1, r2] = [range1, range2].sort((a, b) => a.start.line - b.start.line);
  if (r1.end.line < r2.start.line) {
    return null;
  } else if (r1.end.line === r2.start.line && r1.end.character < r2.start.character) {
    return null;
  } else {
    start = r2.start;
  }

  // find end
  let end: LSP.Position;
  if (r1.end.line < r2.end.line) {
    end = r1.end;
  } else if (r1.end.line === r2.end.line && r1.end.character < r2.end.character) {
    end = r1.end;
  } else {
    end = r2.end;
  }

  return { start, end };
}

// ****************************************************************************
// ****** TEXT DOCUMENTS ******************************************************

// ----- GET TEXT CONTEXT

const wordCharPattern = /\S/;
const leftWordPattern = /^.*?(\S+)$/;
const rightWordPattern = /^\S+/;
const symbolCharPattern = /[\w-]/;
const leftSymbolPattern = /^.*?([\w-]+)$/;
const rightSymbolPattern = /^[\w-]+/;

export function firstChildByType<B extends boolean>(
  node: SyntaxNode,
  targetType: string,
  allowUndefined: B,
): B extends true ? (SyntaxNode | undefined) : SyntaxNode {
  const child = node.namedChildren.find(({ type }) => type === targetType);
  if (child === undefined && !allowUndefined) {
    throw new Error(`Required child ${targetType} is missing.`);
  } else {
    return child as any;
  }
}

export function getTextContext(
  doc: Document,
  position: LSP.Position,
  mode: 'whitespace' | 'symbol' | 'force',
): TextContext | undefined {

  const character = doc.textSlice(
    Range.create(
      LSP.Position.create(position.line, position.character - 1),
      LSP.Position.create(position.line, position.character),
    ),
  );

  // whitespace
  if ((mode === 'whitespace' && !wordCharPattern.test(character)) ||
     (mode === 'symbol' && !symbolCharPattern.test(character))) {
    return undefined;
  }

  const precedingLine = position.line === 0 ?
    null :
    doc.textSlice(Range.create(
      LSP.Position.create(position.line - 1, 0),
      LSP.Position.create(position.line, 0),
    ));

  const currentLine = doc.textSlice(
    Range.create(
      LSP.Position.create(position.line, 0),
      LSP.Position.create(position.line + 1, 0),
    ),
  );

  const lineLeft = currentLine.slice(0, position.character);
  const lineRight = currentLine.slice(position.character);
  let mLeft: RegExpMatchArray | null;
  let mRight: RegExpMatchArray | null;
  if (mode === 'whitespace' || mode === 'force') {
    mLeft = lineLeft.match(leftWordPattern);
    mRight = lineRight.match(rightWordPattern);
  } else if (mode === 'symbol') {
    mLeft = lineLeft.match(leftSymbolPattern);
    mRight = lineRight.match(rightSymbolPattern);
  } else throw new Error('Invalid mode');

  const wordLeft = mLeft?.[1] || '';
  const wordRight = mRight?.[0] || '';
  const word = wordLeft + wordRight;
  return {
    precedingLine,
    lineLeft,
    lineRight,
    word,
    wordLeft,
    wordRight,
    wordRange: {
      start: { line: position.line, character: position.character - wordLeft.length },
      end: { line: position.line, character: position.character + wordRight.length },
    },
  };
}

// ----- GET SYMBOL

export function getSymbol(
  doc: Document,
  position: LSP.Position,
): TextSymbol | undefined {
  const point = lspPositionToTsPoint(position);
  const index = doc.indexAt(point);
  const partialSym = getSymbolRec(doc.tree.rootNode, index);
  if (partialSym === undefined) return undefined;
  else return { documentUri: doc.uri, ...partialSym };
}

// NOTE: `context` is set during descent to disambiguate the same node
// found deeper down
function getSymbolRec(
  node: SyntaxNode,
  index: number,
  context?: 'reference' | 'section',
): Omit<TextSymbol, 'documentUri'> | undefined {
  log.info(node.type);
  // citekey
  if (node.type === 'citekey') {
    assertDefined(context);
    if (context === 'reference') {
      return { node, type: 'reference-citekey' };
    } else if (context === 'section') {
      return { node, type: 'section-citekey' };
    } else {
      return undefined;
    }

  // image reference
  } else if (node.type === 'image_path') {
    return { node, type: 'media-file-path' };

  // media reference
  } else if (node.type === 'reference_key' && node.text[0] === '/') {
    return { node, type: 'media-file-path' };

  // non-media reference
  } else {
    const child = node.firstChildForIndex(index);
    if (child === node || child === null) return undefined;
    // if (node.type === 'reference_header' || node.type === 'cite') {
    if (node.type === 'reference_header') {
      return getSymbolRec(child, index, 'reference');
    } if (node.type === 'cite') {
      return getSymbolRec(child, index, 'reference');
    } else if (/^header_\d$/.test(node.type) || node.type === 'sec') {
      return getSymbolRec(child, index, 'section');
    } else {
      return getSymbolRec(child, index);
    }
  }
}

// ----- INSIDE NODE OF TYPE
// Return a boolean indicating whether the supplied position is inside a node
// of the supplied type.

export function insideNodeOfType(doc: Document, position: LSP.Position, type: string): boolean {
  const point = lspPositionToTsPoint(position);
  const index = doc.indexAt(point);
  return insideNodeOfTypeRec(doc.tree.rootNode, index, type);
}

function insideNodeOfTypeRec(node: SyntaxNode, index: number, type: string): boolean {
  if (node.type === type) {
    return true;
  } else {
    const child = node.firstChildForIndex(index);
    if (child === node || child === null) return false;
    else return insideNodeOfTypeRec(child, index, type);
  }
}

// ----- ADJUST SYMBOL NEW NAME

export function adjustSymbolNewName(target: TextSymbol, newName: string): string {
  if (target.type === 'media-file-path') {
    if (target.node.text[0] === '/') return ensureLeadingSlash(newName);
    else if (target.node.text[0] !== '/') return removeLeadingSlash(newName);
    else return newName;
  } else {
    return newName;
  }
}

export function ensureLeadingSlash(x: string): string {
  return x[0] === '/' ? x : '/' + x;
}

export function removeLeadingSlash(x: string): string {
  return x[0] === '/' ? x.substr(1) : x;
}

// ****************************************************************************
// ****** SERIALIZATIONS ******************************************************

// ----- SERIALIZE LSP POSITION

export function serializeLspPosition({ line, character }: LSP.Position) {
  return `(${line},${character})`;
}

// ----- SERIALIZE LSP RANGE

export function serializeLspRange({ start, end }: LSP.Range) {
  return `(${serializeLspPosition(start)}) <=> (${serializeLspPosition(end)}`;
}

// ----- SERIALIZE PARSE TREE

export function serializeParseTree(doc: Document): string {
  return doc.tree.rootNode.toString();
}

// ----- SERIALIZE WIKI URI

const HEAD = 'file:///Users/smackesey/stm/wiki/';

export function serializeWikiUri(uri: FURI) {
  return uri.substr(HEAD.length);
}
