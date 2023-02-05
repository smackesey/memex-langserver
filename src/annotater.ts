import * as LSP from 'vscode-languageserver';
import { TextContext } from './types';
import Document from './types/document';

import Logger from './logger';
import Server from './server';
import { formatReferenceText, getTextContext } from './util';

const log = new Logger('annotater');

export default class Annotater {

  private server: Server;

  constructor(server: Server) {
    this.server = server;
  }

  public annotate(doc: Document, position: LSP.Position): LSP.Hover | null {
    log.info(`initiating hover for ${doc.uri}`);
    const wordContext = getTextContext(doc, position, 'whitespace');

    if (wordContext === undefined) return null;
    return this.tryCitation(doc, position, wordContext) ||
      null;
  }

  private tryCitation(doc: Document, position: LSP.Position, wordContext: TextContext): LSP.Hover | null {
    const m = wordContext.word.match(/^:cite:`([^`]+)`/);
    if (m === null) return null;
    const [, citekey] = m;
    const table = doc.workspace.referencesByCitekey;
    const ref = table.get(citekey);
    if (ref === undefined) {
      return null;
    } else {
      const { line, character } = position;
      const startChar = character - wordContext.wordLeft.length;
      return {
        contents: formatReferenceText(ref),
        range: {
          start: { line, character: startChar + 7 },
          end: { line, character: startChar + 7 + citekey.length },
        },
      };
    }
  }

}
