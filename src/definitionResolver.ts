import * as LSP from 'vscode-languageserver';
import Logger from './logger';
import { getTextContext, insideNodeOfType, safeCollectionGet, tsNodeToLspRange } from './util';
import Document from './types/document';
import Server from './server';

const log = new Logger('definition-resolver');

export default class DefinitionResolver {

  private server: Server;

  constructor(server: Server) {
    this.server = server;
  }

  get store() { return this.server.store; }

  // TODO: we use 'force' mode here because we don't want our getTextContext
  // call to return undefined. This needs to be refactored. I think I had it
  // return undefined if there was whitespace to teh left as a way to defend
  // against excessive completion calls, bc I was assuming completion was
  // called on each character. But in fact the client takes care of managing
  // when to send completion requests, so this is redundant, and sometimes I
  // want to get candidates (with an explicit completion request) with
  // leading whitespace.
  resolve(doc: Document, position: LSP.Position): LSP.DefinitionLink[] | null {
    log.info(`initiating definition resolution for ${doc.uri}`);

    const textContext = getTextContext(doc, position, 'symbol');
    if (textContext === undefined) return null;
    const { lineLeft, word, wordRange } = textContext;
    if (/^\s*(include):: /.test(lineLeft)) {
      return this.resolveDocumentDefinition(doc, word, wordRange);
    } else if (insideNodeOfType(doc, position, 'cite')) {
      log.info('resolving citkeey');
      return this.resolveCitekeyDefinition(doc, word, wordRange);
    } else {
      return null;
    }
  }

  // **************************************************************************
  // ****** RESOLVERS *********************************************************

  private resolveDocumentDefinition(doc: Document, name: string, originSelectionRange: LSP.Range): LSP.DefinitionLink[] | null {
    const allWsFiles = doc.workspace.documents.map(x => (
      doc.workspace.docUriToRelativePath(x.uri)
    ));
    let match: string | undefined;
    if (doc.basename === 'index.rst') {
      match = allWsFiles.find(x => x === `${name}.rst`);
    } else {
      const containerDir = doc.relativePath.replace(/\.rst/, '');
      match = allWsFiles.find(x => x === `${containerDir}/${name}.rst`);
    }
    if (match === undefined) return null;
    else {
      const matchUri = doc.workspace.relativePathToDocUri(match);
      const targetDoc = safeCollectionGet(this.store.documents, 'uri', matchUri);
      return [{
        originSelectionRange,
        targetUri: matchUri,
        targetRange: tsNodeToLspRange(targetDoc.rootSection.nodes.header),
        targetSelectionRange: tsNodeToLspRange(targetDoc.rootSection.nodes.title),
      }];
    }
  }

  private resolveCitekeyDefinition(doc: Document, citekey: string, originSelectionRange: LSP.Range): LSP.DefinitionLink[] | null {
    const refs = doc.workspace.getAllReferenceListings(citekey, 'citekey');
    log.info(`found ${refs.length} listings for ${citekey}`);
    if (refs.length > 0) {
      return refs.map(x => ({
        originSelectionRange,
        targetUri: x.uri,
        targetRange: tsNodeToLspRange(x.nodes.root),
        targetSelectionRange: tsNodeToLspRange(x.nodes.citekey || x.nodes.root),
      }));
    } else {
      return null;
    }
  }

}
