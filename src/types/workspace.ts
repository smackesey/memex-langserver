import fg from 'fast-glob';
import path from 'path';
import SectionTreeBuilder from '../sectionTreeBuilder';

import Logger from '../logger';
import Store from '../store';
import { FURI, IdCounter, Model, PropertyCacher, SectionTreeNode, TextSymbol } from '../types';
import {
  assertDefined,
  classifyMediaFile,
  ensureLeadingSlash,
  memoize,
  removeLeadingSlash,
  safeGet,
  staticImplements,
  TimeCachedValue,
  uriToPath,
} from '../util';
import Document from './document';
import { QueryMatch } from './tree-sitter';
import * as QW from './queryWrappers';

const log = new Logger('workspace');

// ****************************************************************************
// ****** TYPES ***************************************************************

export type MediaType = (
  'document' |
  'image' |
  'unknown' |
  'video'
);

export type MediaFile = {
  relativePath: string,
  absolutePath: string,
  type: MediaType,
};

export type WorkspaceType = 'single-file' | 'multi-file';

export type WorkspaceInput = {
  uri: FURI,
};

export type WorkspaceRef = string | number | Workspace;

type QueryMatchTable = Map<string, QueryMatch>;

@staticImplements<IdCounter>()
export default class Workspace extends Model implements PropertyCacher {

  static idCounter = 0;

  public uri: FURI;
  public cache: Map<(string | symbol), any>;
  public mediaFilesCache: TimeCachedValue<MediaFile[]>;

  constructor(store: Store, input: WorkspaceInput) {
    super(store);
    this.uri = input.uri;
    this.cache = new Map<(string | symbol), any>();
    this.mediaFilesCache = new TimeCachedValue<MediaFile[]>(
      10000, this.scanMediaFiles.bind(this),
    );
  }

  clearCache() {
    this.cache.clear();
  }

  // ===== ASSOCIATIONS =======================================================

  get documents(): Document[] {
    return this.store.documents.find({ workspaceId: this.id });
  }

  get index(): Document {
    const index = this.getDocument('index.rst');
    assertDefined(index);
    return index;
  }

  getDocument(relativePath: string): Document | undefined {
    const uri = `${this.uri}/${relativePath}`;
    return this.store.documents.by('uri', uri);
  }

  // ===== COMPUTED PROPERTIES ================================================

  get type(): WorkspaceType {
    return /\.rst$/.test(this.uri) ? 'single-file' : 'multi-file';
  }

  get mediaFiles(): MediaFile[] {
    return this.mediaFilesCache.value;
  }

  // ----- CACHED

  @memoize<Workspace>()
  get referencesByKey(): Map<string, QW.Reference> {
    const table = new Map<string, QW.Reference>();
    this.documents.forEach(doc => {
      doc.referenceListings.forEach(ref => {
        table.set(ref.key, ref);
      });
    });
    return table;
  }

  @memoize<Workspace>()
  get referencesByCitekey(): Map<string, QW.Reference> {
    const table = new Map<string, QW.Reference>();
    this.documents.forEach(doc => {
      doc.referenceListings.forEach(ref => {
        if (ref.citekey) table.set(ref.citekey, ref);
      });
    });
    return table;
  }

  @memoize<Workspace>()
  get sectionsByCitekey(): Map<string, QW.Section> {
    const table = new Map<string, QW.Section>();
    this.documents.forEach(doc => {
      doc.sections.forEach(sec => {
        if (sec.citekey) table.set(sec.citekey, sec);
      });
    });
    return table;
  }

  @memoize<Workspace>()
  get sectionTree(): SectionTreeNode {
    return new SectionTreeBuilder(this.index, true).run();
  }

  // ===== OTHER ==============================================================

  getAllImageReferences(): QW.ImageReference[] {
    return this.documents.flatMap(doc => (
      doc.imageReferences
    ));
  }

  getAllSymbolInstances(sym: TextSymbol): TextSymbol[] {
    if (sym.type === 'media-file-path') {
      const symSlash = ensureLeadingSlash(sym.node.text);
      const listings = this.getAllReferenceListings(symSlash, 'key');
      const keyInstances = listings.map(({ uri, nodes: { key } }) => (
        { documentUri: uri, node: key, type: 'media-file-path' }
      ));
      const symNoSlash = removeLeadingSlash(sym.node.text);
      const imageRefInstances = this.getAllImageReferences()
        .filter(({ root }) => root === symNoSlash)
        .map(({ uri, nodes: { root } }) => (
          { documentUri: uri, node: root, type: 'media-file-path' }
        ));
      return [...keyInstances, ...imageRefInstances];
    } if (sym.type === 'reference-citekey') {
      const citations = this.getAllReferenceCitations(sym.node.text);
      const listings = this.getAllReferenceListings(sym.node.text, 'citekey');
      return [...citations, ...listings].map(({ uri, nodes: { citekey } }) => {
        assertDefined(citekey);
        return { documentUri: uri, node: citekey, type: 'reference-citekey' };
      });
    } else if (sym.type === 'section-citekey') {
      const citations = this.getAllSectionCitations(sym.node.text);
      const listings = this.sectionsByCitekey.has(sym.node.text) ?
        [safeGet(this.sectionsByCitekey, sym.node.text)] : [];
      return [...citations, ...listings].map(({ uri, nodes: { citekey } }) => {
        assertDefined(citekey);
        return { documentUri: uri, node: citekey, type: 'section-citekey' };
      });
    } else {
      throw new Error('bad symbol type');
    }
  }

  getAllReferenceCitations(citekey: string): QW.ReferenceCitation[] {
    return this.documents.flatMap(doc => (
      doc.referenceCitations.filter(x => (
        x.citekey === citekey
      ))
    ));
  }

  getAllReferenceListings(value: string, field: ('citekey' | 'key')): QW.Reference[] {
    return this.documents.flatMap(doc => (
      doc.referenceListings.filter(x => {
        if (field === 'citekey') {
          return x.citekey === value;
        } else if (field === 'key') {
          return x.key === value;
        } else {
          return false;
        }
      })
    ));
  }

  getAllSectionCitations(citekey: string): QW.ReferenceCitation[] {
    return this.documents.flatMap(doc => (
      doc.sectionCitations.filter(x => (
        x.citekey === citekey
      ))
    ));
  }

  docUriToRelativePath(uri: FURI): string {
    if (this.uri !== uri.substr(0, this.uri.length)) {
      throw new Error('URI is not contained in workspace');
    } else {
      return uri.substr(this.uri.length + 1);
    }
  }

  relativePathToDocUri(relPath: string): string {
    return `${this.uri}/${relPath}`;
  }

  scanMediaFiles(): MediaFile[] {
    const basePath = path.join(uriToPath(this.uri), 'media');
    const dirs = fg.sync(['**/.media-unit'], { cwd: basePath })
      .map(d => path.dirname(d) + '/');
    const files = fg.sync(['**/*'], { cwd: basePath, onlyFiles: true })
      .filter(x => (!dirs.some(d => x.startsWith(d))));
    const allItems = [...dirs, ...files];
    return allItems.map(p => ({
      relativePath: p,
      absolutePath: path.join(basePath, p),
      type: classifyMediaFile(p),
    }));
  }

}
