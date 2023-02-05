import fg from 'fast-glob';
import path from 'path';
import { SyntaxNode } from 'tree-sitter';
import Logger from './logger';
import { SectionTreeNode } from './types';
import Document from './types/document';
import { makeQuery } from './types/tree-sitter';
import Workspace from './types/workspace';
import {
  assertDefined,
  firstChildByType,
  getCapture,
  uriToPath,
  serializeWikiUri,
} from './util';

const log = new Logger('section-tree-builder');

function childrenByType(node: SyntaxNode, targetType: string): SyntaxNode[] {
  return node.namedChildren.filter(({ type }) => type === targetType);
}

export default class SectionTreeBuilder {

  private document: Document;
  private includeChildDocuments: boolean;

  constructor(document: Document, includeChildDocuments: boolean) {
    this.document = document;
    this.includeChildDocuments = includeChildDocuments;
  }

  get workspace(): Workspace {
    return this.document.workspace;
  }

  run(): SectionTreeNode {
    return this.processDocument(this.document, [1]);
  }

  processDocument(doc: Document, numPath: number[]): SectionTreeNode {
    log.info(`Processing document ${serializeWikiUri(doc.uri)}, ${numPath}`);
    const topSection = doc.tree.rootNode.firstChild;
    assertDefined(topSection);
    return this.processSection(topSection, doc, numPath);
  }

  processSection(node: SyntaxNode, doc: Document, numPath: number[]): SectionTreeNode {
    const level = parseInt(node.type.substr(-1), 10);
    const headerType = `header_${level}`;
    const header = firstChildByType(node, headerType, false);
    const citekey = firstChildByType(node, 'citekey', true)?.text;
    const title = firstChildByType(header, 'header_title', false)!.text;
    assertDefined(title);
    const children: SectionTreeNode[] = [];

    // handle listing group
    if (this.includeChildDocuments) {
      children.push(...this.processIncludes(node, doc, numPath));
    }

    // subsections
    const subSectionTypes = [...Array(5 - level).keys()]
      .map(i => `section_${i + level + 1}`);
    subSectionTypes.forEach(t => {
      childrenByType(node, t).forEach(child => {
        const index = children.length + 1;
        // log.info(`${i} ${children.length} ${index}`);
        children.push(this.processSection(child, doc, [...numPath, index]));
      });
    });

    const line = node.startPosition.row;
    const number = numPath.join('.');

    return { number, title, citekey, uri: doc.uri, line, children };

  }

  processIncludes(node: SyntaxNode, doc: Document, numPath: number[]): SectionTreeNode[] {
    const query = makeQuery(`
        (include
          (include_key) @key)
      `);
    const relPaths = query.matches(node).map(x => (
      getCapture(x, 'key', false).text
    ));
    const result: SectionTreeNode[] = [];
    relPaths.forEach(p => {
      const wsRelPath = path.join(doc.relativeDirname, `${p}.rst`);
      const paths = (/\*/.test(wsRelPath)) ?
        fg.sync([wsRelPath], { cwd: uriToPath(this.workspace.uri) }) :
        [wsRelPath];
      paths.map(ip => this.workspace.getDocument(ip))
        .filter((d): d is Document => d !== undefined)
        .forEach(d => {
          result.push(this.processDocument(d, [...numPath, result.length + 1]));
        });
    });
    return result;
  }

}
