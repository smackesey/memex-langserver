import * as LSP from 'vscode-languageserver';
import Server from './server';
import Document from './types/document';
import { assertDefined } from './util';

export default class Fixer {

  private server: Server;

  constructor(server: Server) {
    this.server = server;
  }

  get db() { return this.server.db; }

  async getFix(doc: Document, diag: LSP.Diagnostic): Promise<LSP.CodeAction | undefined> {
    if (diag.code === 'stale-reference-key') {
      const staleKey = doc.textSlice(diag.range);
      const id = staleKey.split('.')[2];
      const realKey = await this.db.getKey(id);
      assertDefined(realKey);
      return {
        title: 'update reference key',
        kind: 'quickfix',
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          documentChanges: [
            {
              textDocument: { uri: doc.uri, version: doc.version },
              edits: [
                { range: diag.range, newText: realKey },
              ],
            },
          ],
        },
      };
    } else {
      return undefined;
    }
  }

}
