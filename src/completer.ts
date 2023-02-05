import path from 'path';
import * as LSP from 'vscode-languageserver';
import Logger from './logger';
import { getTextContext, insideNodeOfType, uriToPath } from './util';
import Document from './types/document';
import Server from './server';
import { MediaType } from './types/workspace';

const log = new Logger('completer');

const DIRECTIVES = [
  'note',
  'references',
  'flag',
  'sections',
  'tasks',
];

const ROLES = [
  'cite',
  'link',
  'math',
  'sec',
];

export default class Completer {

  private server: Server;

  constructor(server: Server) {
    this.server = server;
  }

  // TODO: we use 'force' mode here because we don't want our getTextContext
  // call to return undefined. This needs to be refactored. I think I had it
  // return undefined if there was whitespace to teh left as a way to defend
  // against excessive completion calls, bc I was assuming completion was
  // called on each character. But in fact the client takes care of managing
  // when to send completion requests, so this is redundant, and sometimes I
  // want to get candidates (with an explicit completion request) with
  // leading whitespace.
  complete(doc: Document, position: LSP.Position): LSP.CompletionItem[] {
    log.info(`initiating completion for ${doc.uri}`);
    const textContext = getTextContext(doc, position, 'force');
    if (textContext === undefined) return [];
    const { lineLeft, wordLeft, precedingLine } = textContext;
    log.info(`completion word: ${wordLeft}`);
    if (wordLeft === ':') {
      return this.getRoleCompletions();
    } else if (/^:cite:`/.test(wordLeft)) {
      const commaIndex = wordLeft.lastIndexOf(',');
      if (commaIndex === -1) {
        return this.getCiteCompletions(doc, wordLeft.substr(7));
      } else {
        const exclude = wordLeft.slice(7, commaIndex).split(',');
        return this.getCiteCompletions(doc, wordLeft.substr(commaIndex + 1), exclude);
      }
    } else if (/^:sec:`/.test(wordLeft)) {
      return this.getSecCompletions(doc, wordLeft.substr(6));
    } else if (insideNodeOfType(doc, position, 'image_carousel')) {
      return [...this.getImageCompletions(doc), ...this.getVideoCompletions(doc)];
    } else if (/^\s*(image|figure):: /.test(lineLeft)) {
      return this.getImageCompletions(doc);
    } else if (/^\s*(include):: /.test(lineLeft)) {
      return this.getIncludeCompletions(doc, wordLeft);
    } else if (/^\s*(video):: /.test(lineLeft)) {
      return this.getVideoCompletions(doc);
    } else if (/^\s{2,}/.test(lineLeft)) {
      if (wordLeft.substr(0, 1) === '/') {
        return this.getMediaCompletions(doc, 'any');
      } else {
        return [];
      }
    } else if (/^\s*/.test(lineLeft.substr(0, lineLeft.length - wordLeft.length)) &&
      (precedingLine === null || /^\s*$/.test(precedingLine))) {
      return this.getDirectiveCompletions(doc, wordLeft);
    } else {
      return [];
    }
  }

  // **************************************************************************
  // ****** CANDIDATE GENERATORS **********************************************

  private getCiteCompletions(doc: Document, head: string, exclude: String[] = []): LSP.CompletionItem[] {
    const headPat = new RegExp(`^${head}`);
    const cands = [...doc.workspace.referencesByCitekey.keys()].filter(ck => (
      headPat.test(ck) && !exclude.includes(ck)
    ));
    return cands.map(ck => ({
      label: ck,
      kind: LSP.CompletionItemKind.Reference,
    }));
  }

  private getDirectiveCompletions(_doc: Document, head: string): LSP.CompletionItem[] {
    const headPat = new RegExp(`^${head}`);
    const matches = head === '' ? DIRECTIVES : DIRECTIVES.filter(d => headPat.test(d));
    return matches.map(dir => ({
      label: dir,
      kind: LSP.CompletionItemKind.Function,
      insertTextFormat: LSP.InsertTextFormat.Snippet,
      insertText: `${dir}::`,
    }));
  }

  private getRoleCompletions(): LSP.CompletionItem[] {
    return ROLES.map(role => ({
      label: `:${role}:`,
      kind: LSP.CompletionItemKind.Function,
      insertTextFormat: LSP.InsertTextFormat.Snippet,
      insertText: `${role}:\`$1\`$0`,
    }));
  }

  private getSecCompletions(doc: Document, head: string): LSP.CompletionItem[] {
    const headPat = new RegExp(`^${head}`);
    const cands = [...doc.workspace.referencesByCitekey.keys()].filter(ck => (
      headPat.test(ck)
    ));
    return cands.map(ck => ({
      label: ck,
      kind: LSP.CompletionItemKind.Reference,
    }));
  }

  private getIncludeCompletions(doc: Document, head: string): LSP.CompletionItem[] {
    const headPat = new RegExp(`^${head}`);
    const allOtherFiles = doc.workspace.documents.map(x => (
      doc.workspace.docUriToRelativePath(x.uri)
    ));
    const docPath = uriToPath(doc.uri);
    const existing = doc.includes.map(x => x.key);
    const cands = allOtherFiles.map(x => {
      if (path.basename(docPath) === 'index.rst') {
        if (!x.includes('/') && x !== 'index.rst') {
          return x.replace(/\.rst$/, '');
        }
        return undefined;
      } else {
        const match = docPath.replace(/\.rst$/, '');
        if (x.slice(match.length) === match) {
          return x.split('/').slice(-2).join('/').replace(/\.rst$/, '');
        }
        return undefined;
      }
    }).filter((x): x is string => !!x)
      .filter(x => !existing.includes(x) && headPat.test(x));
    return cands.map(p => ({
      label: p,
      kind: LSP.CompletionItemKind.File,
    }));
  }

  private getImageCompletions(doc: Document): LSP.CompletionItem[] {
    log.info('getting image completions');
    return this.getMediaCompletions(doc, 'image');
  }

  private getVideoCompletions(doc: Document): LSP.CompletionItem[] {
    log.info('getting image completions');
    return this.getMediaCompletions(doc, 'video');
  }

  private getMediaCompletions(doc: Document, type: MediaType | 'any') {
    const cands = doc.workspace.mediaFiles.filter(x => type === 'any' || x.type === type);
    return cands.map(({ relativePath }) => ({
      // label: `/${relativePath}`,
      label: `${relativePath}`,
      kind: LSP.CompletionItemKind.File,
    }));
  }

}
