import TS, { SyntaxNode, Point } from 'tree-sitter';
import MemexWiki from 'tree-sitter-memexwiki';

export declare class Query {
  matches(node: SyntaxNode, startPosition?: Point, endPosition?: Point): Array<QueryMatch>;
  captures(node: SyntaxNode): Array<QueryCapture>;
}

export interface QueryMatch {
  pattern: number,
  captures: QueryCapture[],
}

export interface QueryCapture {
  name: string,
  node: SyntaxNode,
  setProperties?: { [name: string]: any },
  assertedProperties?: { [name: string]: any },
  refutedProperties?: { [name: string]: any },
}

const ATS = TS as any;

export function makeQuery(queryStr: string): Query {
  return new ATS.Query(MemexWiki, queryStr) as Query;
}
