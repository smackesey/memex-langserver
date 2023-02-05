import * as LSP from 'vscode-languageserver';

import Document from './types/document';
import Logger from './logger';
import Server from './server';
import {
  assertDefined,
  tsEndpointsToLspRange,
} from './util';

const log = new Logger('codeLensAnnotater');

export default class CodeLensAnnotater {

  private server: Server;

  constructor(server: Server) {
    this.server = server;
  }

  run(doc: Document): LSP.CodeLens[] {
    return [
      ...this.getReferenceLenses(doc),
      ...this.getSectionLenses(doc),
    ];
  }

  getSectionLenses(doc: Document): LSP.CodeLens[] {
    const lenses = doc.sections.map((x): LSP.CodeLens | undefined => {
      if (x.citekey === undefined) return undefined;
      const refs = doc.workspace.getAllSectionCitations(x.citekey);
      assertDefined(x.nodes.citekey);
      const { startPosition, endPosition } = x.nodes.citekey;
      return {
        range: tsEndpointsToLspRange(startPosition, endPosition),
        data: `${refs.length} citations`,
        command: {
          title: `${refs.length} citations`,
          command: 'getCitations',
        },
      };
    });
    const result = lenses.filter((x): x is LSP.CodeLens => x !== undefined);
    log.log(`Found ${result.length} section lenses.`);
    return result;
  }

  getReferenceLenses(doc: Document): LSP.CodeLens[] {
    const lenses = doc.referenceListings.map((x): LSP.CodeLens | undefined => {
      if (x.citekey === undefined) return undefined;
      const refs = doc.workspace.getAllReferenceCitations(x.citekey);
      assertDefined(x.nodes.citekey);
      const { startPosition, endPosition } = x.nodes.citekey;
      return {
        range: tsEndpointsToLspRange(startPosition, endPosition),
        data: `${refs.length} citations`,
        command: {
          title: `${refs.length} citations`,
          command: 'getCitations',
        },
      };
    });
    const result = lenses.filter((x): x is LSP.CodeLens => x !== undefined);
    log.log(`Found ${result.length} reference lenses.`);
    return result;
  }

}
