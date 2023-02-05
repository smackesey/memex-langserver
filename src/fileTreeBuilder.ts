import path from 'path';

import fg from 'fast-glob';

import Logger from './logger';
import Store from './store';
import { FileTreeNode } from './types';
import Document from './types/document';
import Workspace from './types/workspace';
import { pathToUri, safeCollectionGet, uriToPath } from './util';

const log = new Logger('include-tree-builder');

export default class FileTreeBuilder {

  private store: Store;
  private document: Document;

  constructor(document: Document, store: Store) {
    this.store = store;
    this.document = document;
  }

  get workspace(): Workspace {
    return this.document.workspace;
  }

  run(): FileTreeNode {
    return this.processDocument(this.document);
  }

  processDocument(doc: Document): FileTreeNode {
    const filepath = uriToPath(doc.uri);
    const basename = path.basename(filepath);
    const dirname = path.dirname(filepath);
    const childRoot = basename === 'index.rst' ?
      dirname : path.join(dirname, basename.replace(/\.rst$/, ''));
    return {
      filename: basename,
      children: doc.includes.flatMap(x => {
        if (x.key.includes('*')) {
          const matches = fg.sync(`${x}.rst`, { cwd: childRoot });
          return matches.map(m => this.processChild(childRoot, m));
        } else {
          return this.processChild(childRoot, `${x}.rst`);
        }
      }),
    };
  }

  processChild(root: string, filename: string): FileTreeNode {
    const curi = pathToUri(path.join(root, filename));
    const cdoc = safeCollectionGet(this.store.documents, 'uri', curi);
    return this.processDocument(cdoc);
  }

}
