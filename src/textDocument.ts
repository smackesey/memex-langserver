import Memexwiki from 'tree-sitter-memexwiki';
import {
  DocumentUri,
  Position,
  TextDocument,
  TextDocumentContentChangeEvent,
  Range,
} from 'vscode-languageserver-textdocument';

import Parser, { Tree } from 'tree-sitter';

type ParserTable = {
  [ languageId: string ]: Parser,
};

let parserTable: ParserTable;

function resolveParser(languageId: string): Parser {
  // return parserTable[languageId];
  const parser = new Parser();
  parser.setLanguage(Memexwiki);
  return parser;
}

export interface TreeSitterTextDocument extends TextDocument {
  tree: Tree,
}

class FullTextDocument implements TreeSitterTextDocument {

  private _uri: DocumentUri;
  private _languageId: string;
  private _version: number;
  private _content: string;
  private _parser: Parser;
  private _tree: Tree;
  private _lineOffsets: number[] | undefined;

  public constructor(uri: DocumentUri, languageId: string, version: number, content: string) {
    this._uri = uri;
    this._languageId = languageId;
    this._version = version;
    this._content = content;
    this._parser = resolveParser(languageId);
    this._lineOffsets = undefined;
    this._tree = this._parser.parse(content);
  }

  public get uri(): string {
    return this._uri;
  }

  public get languageId(): string {
    return this._languageId;
  }

  public get version(): number {
    return this._version;
  }

  public get tree(): Tree {
    return this._tree;
  }

  public reparse() {
    // fs.writeFileSync('/Users/smackesey/stm/tmp/testparse', this._content);
    // log.info(this._content);
    // log.info(this._tree.rootNode.toString());
    // log.info(`content changed? ${origContent !== this._content}`);
    const tree = this._parser.parse(this._content);
    // log.info(tree.rootNode.toString());
    this._tree = tree;
  }

  public getText(range?: Range): string {
    if (range) {
      const start = this.offsetAt(range.start);
      const end = this.offsetAt(range.end);
      return this._content.substring(start, end);
    }
    return this._content;
  }

  public update(changes: TextDocumentContentChangeEvent[], version: number): void {
    changes.forEach(change => {
      if (isIncremental(change)) {
        // makes sure start is before end
        const range = getWellformedRange(change.range);

        // update content
        const startOffset = this.offsetAt(range.start);
        const endOffset = this.offsetAt(range.end);
        this._content = this._content.substring(0, startOffset) + change.text + this._content.substring(endOffset, this._content.length);

        // update the offsets
        const startLine = Math.max(range.start.line, 0);
        const endLine = Math.max(range.end.line, 0);
        let lineOffsets = this._lineOffsets!;
        const addedLineOffsets = computeLineOffsets(change.text, false, startOffset);
        if (endLine - startLine === addedLineOffsets.length) {
          for (let i = 0, len = addedLineOffsets.length; i < len; i++) {
            lineOffsets[i + startLine + 1] = addedLineOffsets[i];
          }
        } else if (addedLineOffsets.length < 10000) {
          lineOffsets.splice(startLine + 1, endLine - startLine, ...addedLineOffsets);
        } else { // avoid too many arguments for splice
          lineOffsets = lineOffsets.slice(0, startLine + 1).concat(addedLineOffsets, lineOffsets.slice(endLine + 1));
          this._lineOffsets = lineOffsets;
        }
        const diff = change.text.length - (endOffset - startOffset);
        if (diff !== 0) {
          for (let i = startLine + 1 + addedLineOffsets.length, len = lineOffsets.length; i < len; i++) {
            lineOffsets[i] += diff;
          }
        }

        // update tree
        const newEndOffset = startOffset + change.text.length;
        const newEndPosition = this.positionAt(newEndOffset);
        this._tree.edit({
          startIndex: startOffset,
          oldEndIndex: endOffset,
          newEndIndex: newEndOffset,
          startPosition: { row: range.start.line, column: range.start.character },
          oldEndPosition: { row: range.end.line, column: range.end.character },
          newEndPosition: { row: newEndPosition.line, column: newEndPosition.character },
        });

      } else if (isFull(change)) {
        this._content = change.text;
        this._lineOffsets = undefined;
      } else {
        throw new Error('Unknown change event received');
      }
    });
    this._tree = this._parser.parse(this._content, this._tree);
    this._version = version;
  }

  private getLineOffsets(): number[] {
    if (this._lineOffsets === undefined) {
      this._lineOffsets = computeLineOffsets(this._content, true);
    }
    return this._lineOffsets;
  }

  public positionAt(offset: number): Position {
    const ioffset = Math.max(Math.min(offset, this._content.length), 0);
    const lineOffsets = this.getLineOffsets();
    let low = 0;
    let high = lineOffsets.length;

    if (high === 0) {
      return { line: 0, character: ioffset };
    }
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (lineOffsets[mid] > ioffset) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    // low is the least x for which the line offset is larger than the current offset
    // or array.length if no line offset is larger than the current offset
    const line = low - 1;
    return { line, character: ioffset - lineOffsets[line] };
  }

  public offsetAt(position: Position) {
    const lineOffsets = this.getLineOffsets();
    if (position.line >= lineOffsets.length) {
      return this._content.length;
    } else if (position.line < 0) {
      return 0;
    }
    const lineOffset = lineOffsets[position.line];
    const nextLineOffset = (position.line + 1 < lineOffsets.length) ? lineOffsets[position.line + 1] : this._content.length;
    return Math.max(Math.min(lineOffset + position.character, nextLineOffset), lineOffset);
  }

  public get lineCount() {
    return this.getLineOffsets().length;
  }

}

const enum CharCode {
  /**
   * The `\n` character.
   */
  LineFeed = 10,
  /**
   * The `\r` character.
   */
  CarriageReturn = 13,
}

function computeLineOffsets(text: string, isAtLineStart: boolean, textOffset = 0): number[] {
  const result: number[] = isAtLineStart ? [textOffset] : [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === CharCode.CarriageReturn || ch === CharCode.LineFeed) {
      if (ch === CharCode.CarriageReturn && i + 1 < text.length && text.charCodeAt(i + 1) === CharCode.LineFeed) {
        i += 1;
      }
      result.push(textOffset + i + 1);
    }
  }
  return result;
}

function getTreesitterEndpoints(range: Range) {
  return [
    { row: range.start.line, column: range.start.character },
    { row: range.end.line, column: range.end.character },
  ];
}

function getWellformedRange(range: Range): Range {
  const { start, end } = range;
  if (start.line > end.line || (start.line === end.line && start.character > end.character)) {
    return { start: end, end: start };
  }
  return range;
}

function isIncremental(event: TextDocumentContentChangeEvent): event is { range: Range; rangeLength?: number; text: string; } {
  const candidate: { range: Range; rangeLength?: number; text: string; } = event as any;
  return candidate !== undefined && candidate !== null &&
    typeof candidate.text === 'string' && candidate.range !== undefined &&
    (candidate.rangeLength === undefined || typeof candidate.rangeLength === 'number');
}

function isFull(event: TextDocumentContentChangeEvent): event is { text: string; } {
  const candidate: { range?: Range; rangeLength?: number; text: string; } = event as any;
  return candidate !== undefined && candidate !== null &&
    typeof candidate.text === 'string' && candidate.range === undefined && candidate.rangeLength === undefined;
}

// ****************************************************************************
// ****** NAMESPACE ***********************************************************

export namespace TreeSitterTextDocument {

  export function configure(table: ParserTable) {
    parserTable = table;
  }

  /**
   * Creates a new text document.
   *
   * @param uri The document's uri.
   * @param languageId  The document's language Id.
   * @param version The document's initial version number.
   * @param content The document's content.
   */
  export function create(
    uri: DocumentUri, languageId: string,
    version: number, content: string,
  ): TreeSitterTextDocument {
    return new FullTextDocument(uri, languageId, version, content);
  }

  /**
   * Updates a TextDocument by modifying its content.
   *
   * @param document the document to update. Only documents created by TextDocument.create are valid inputs.
   * @param changes the changes to apply to the document.
   * @returns The updated TextDocument. Note: That's the same document instance passed in as first parameter.
   *
   */
  export function update(
    document: TextDocument,
    changes: TextDocumentContentChangeEvent[],
    version: number,
  ): TreeSitterTextDocument {
    if (document instanceof FullTextDocument) {
      document.update(changes, version);
      return document;
    } else {
      throw new Error('TextDocument.update: document must be created by TextDocument.create');
    }
  }

  /**
   * Fully reparses a TextDocument. This is useful if an incremental parse has
   * screwed things up. Happens due to bugs.
   *
   * @param document the document to update. Only documents created by TextDocument.create are valid inputs.
   * @returns The updated TextDocument. Note: That's the same document instance passed in as first parameter.
   *
   */
  export function reparse(
    document: TextDocument,
  ): TreeSitterTextDocument {
    if (document instanceof FullTextDocument) {
      document.reparse();
      return document;
    } else {
      throw new Error('TextDocument.update: document must be created by TextDocument.create');
    }
  }

}
