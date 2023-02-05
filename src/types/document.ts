import fs from 'fs';
import path from 'path';
import * as LSP from 'vscode-languageserver';
import { Point } from 'tree-sitter';

import { makeQuery, Query } from './tree-sitter';
import Logger from '../logger';
import Store from '../store';
import { TreeSitterTextDocument } from '../textDocument';
import {
  FURI,
  IdCounter,
  Model,
  PropertyCacher,
  Task,
  TaskOperation,
} from '../types';
import {
  memoize,
  safeCollectionGet,
  serializeWikiUri,
  staticImplements,
  tsPointToLspPosition,
  uriToPath,
} from '../util';
import Workspace from './workspace';
import * as QW from './queryWrappers';
import FileTreeBuilder from '../fileTreeBuilder';
import SectionTreeBuilder from '../sectionTreeBuilder';

const log = new Logger('document');

// ****************************************************************************
// ****** TYPES ***************************************************************

export type DocumentRef = Document | FURI | number;

type QueryName = (
  'directives' |
  'imageCarousels' |
  'imageReferences' |
  'includes' |
  'referenceBlocks' |
  'referenceCitations' |
  'referenceListings' |
  'section1s' |
  'section2s' |
  'section3s' |
  'section4s' |
  'section5s' |
  'sectionCitations'
);

export enum DocumentState {
  editing,
  indexing,
}

export type DocumentInput = {
  uri: FURI,
  text: string,
  workspaceId: number,
  state: DocumentState,
  diagnostics?: LSP.Diagnostic[] | undefined,
}

// ****************************************************************************
// ****** UTILS ***************************************************************

function sectionQuery(n: number): Query {
  return makeQuery(`
    (section_${n}
      (header_${n}
        (citekey)? @citekey
        (header_title) @title) @header) @root
  `);
}

// ****************************************************************************
// ****** MAIN ****************************************************************

@staticImplements<IdCounter>()
export default class Document extends Model implements PropertyCacher {

  static idCounter = 0;
  static queries: { [key in QueryName]: Query } = {
    directives: makeQuery(`
      (directive
        (directive_type) @type
        (directive_arguments) @arguments
        (directive_options) @options
        (directive_content)) @root
    `),
    imageCarousels: makeQuery(`
      (image_carousel) @root
    `),
    imageReferences: makeQuery(`
      (image_path) @root
    `),
    includes: makeQuery(`
      (include
        (include_key) @key) @root
    `),
    referenceBlocks: makeQuery(`
      (references
        (references_title) @title) @root
    `),
    referenceCitations: makeQuery(`
      (cite
        ((citekey) ("," (citekey))*) @citekey) @root
    `),
    referenceListings: makeQuery(`
      (reference
        (reference_header
          (citekey)? @citekey
          (display_name_declaration
            body: (display_name) @displayName)?
          (reference_key) @key) @header
        (annotation)? @annotation) @root
    `),
    section1s: sectionQuery(1),
    section2s: sectionQuery(2),
    section3s: sectionQuery(3),
    section4s: sectionQuery(4),
    section5s: sectionQuery(5),
    sectionCitations: makeQuery(`
      (sec
        ((citekey) ("," (citekey))*) @citekey) @root
    `),
  }

  private tsDoc: TreeSitterTextDocument;
  public uri: FURI;
  public workspaceId: number;
  public state: DocumentState;
  public diagnostics: LSP.Diagnostic[] | undefined;
  public cache: Map<(string | symbol), any[]>;

  constructor(store: Store, input: DocumentInput) {
    super(store);
    this.uri = input.uri;
    this.workspaceId = input.workspaceId;
    this.tsDoc = TreeSitterTextDocument.create(
      input.uri, 'memexwiki', 0, input.text);
    this.state = input.state;
    this.diagnostics = input.diagnostics;
    this.cache = new Map<(string | symbol), any[]>();
  }

  public clearCache() {
    this.cache.clear();
  }

  public reparse() {
    TreeSitterTextDocument.reparse(this.tsDoc);
  }

  public update(version: number, changes: LSP.TextDocumentContentChangeEvent[]) {
    TreeSitterTextDocument.update(this.tsDoc, changes, version);
    this.clearCache();
  }

  public indexAt(pos: LSP.Position | Point): number {
    if ('row' in pos) {
      return this.tsDoc.offsetAt(tsPointToLspPosition(pos));
    } else {
      return this.tsDoc.offsetAt(pos);
    }
  }

  public toString() {
    return serializeWikiUri(this.uri);
  }

  public saveToDisk() {
    fs.writeFile(uriToPath(this.uri), this.text, () => {});
  }

  // ===== COMPUTED PROPERTIES ================================================

  public textSlice(range: LSP.Range) {
    return this.tsDoc.getText(range);
  }

  get dirname(): string {
    return path.dirname(uriToPath(this.uri));
  }

  get relativeDirname(): string {
    const dir = path.dirname(this.relativePath);
    return dir === '.' ? '' : dir;
  }

  get text() { return this.tsDoc.getText(); }

  get tree() { return this.tsDoc.tree; }

  get version() { return this.tsDoc.version; }

  get fileTree() { return new FileTreeBuilder(this, this.store).run(); }

  get sectionTree() { return new SectionTreeBuilder(this, false).run(); }

  get basename() {
    return path.basename(this.relativePath);
  }

  get relativePath() {
    return this.workspace.docUriToRelativePath(this.uri);
  }

  // ===== ASSOCIATIONS =======================================================

  get tasks(): Task[] {
    return this.store.tasks.find({ documentId: this.id });
  }

  get auditTask() {
    return this.store.tasks.findOne({
      documentId: this.id, operation: TaskOperation.audit,
    }) as Task;
  }

  get workspace(): Workspace {
    return safeCollectionGet(this.store.workspaces, 'id', this.workspaceId);
  }

  // ===== QUERY FIELDS =========================================================

  @memoize<Document>()
  get directives(): QW.Directive[] {
    return Document.queries.directives.matches(this.tree.rootNode).map(x => (
      new QW.Directive(this.uri, x)
    ));
  }

  @memoize<Document>()
  get imageCarousels(): QW.ImageReference[] {
    return Document.queries.imageCarousels.matches(this.tree.rootNode).map(x => (
      new QW.ImageCarousel(this.uri, x)
    ));
  }

  @memoize<Document>()
  get imageReferences(): QW.ImageReference[] {
    return Document.queries.imageReferences.matches(this.tree.rootNode).map(x => (
      new QW.ImageReference(this.uri, x)
    ));
  //   const figures = this.directives.filter(x => x.type === 'figure');
  //   const imageCarousels = this.directives.filter(x => x.type === 'image-carousel');
  }

  @memoize<Document>()
  get referenceBlocks(): QW.ReferenceBlock[] {
    return Document.queries.referenceBlocks.matches(this.tree.rootNode).map(x => (
      new QW.ReferenceBlock(this.uri, x)
    ));
  }

  @memoize<Document>()
  get referenceCitations(): QW.ReferenceCitation[] {
    return Document.queries.referenceCitations.matches(this.tree.rootNode).map(x => (
      new QW.ReferenceCitation(this.uri, x)
    ));
  }

  @memoize<Document>()
  get referenceListings(): QW.Reference[] {
    return Document.queries.referenceListings.matches(this.tree.rootNode).map(x => (
      new QW.Reference(this.uri, x)
    ));
  }

  @memoize<Document>()
  get rootSection(): QW.Section {
    const section = Document.queries.section1s.matches(this.tree.rootNode)[0];
    return new QW.Section(this.uri, section);
  }

  @memoize<Document>()
  get sectionCitations(): QW.SectionCitation[] {
    return Document.queries.sectionCitations.matches(this.tree.rootNode).map(x => (
      new QW.SectionCitation(this.uri, x)
    ));
  }

  @memoize<Document>()
  get sections(): QW.Section[] {
    return [
      ...Document.queries.section1s.matches(this.tree.rootNode),
      ...Document.queries.section2s.matches(this.tree.rootNode),
      ...Document.queries.section3s.matches(this.tree.rootNode),
      ...Document.queries.section4s.matches(this.tree.rootNode),
      ...Document.queries.section5s.matches(this.tree.rootNode),
    ].map(x => new QW.Section(this.uri, x));
  }

  @memoize<Document>()
  get includes(): QW.Include[] {
    return Document.queries.includes.matches(this.tree.rootNode).map(x => (
      new QW.Include(this.uri, x)
    ));
  }

}
