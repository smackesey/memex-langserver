import * as LSP from 'vscode-languageserver/node';
import MemexWiki from 'tree-sitter-memexwiki';
import Parser from 'tree-sitter';
import { TreeSitterTextDocument } from './textDocument';

import config from './config';
import Logger from './logger';
import Server from './server';

export default function listen() {
  const connection = LSP.createConnection();

  // configure parser / TreeSitterTextDocument
  const parser = new Parser();
  parser.setLanguage(MemexWiki);
  TreeSitterTextDocument.configure({ memexwiki: parser });

  // ----- INITIALIZE

  let log: Logger;

  connection.onInitialize(
    (params: LSP.InitializeParams) => {
      config.load(params.initializationOptions ?? {});

      // configure logger
      Logger.setup(connection, config.logMode);
      log = new Logger('main');
      log.info('Starting server.');

      const server = new Server(connection, params);
      return {
        capabilities: server.capabilities,
      };
    },
  );

  process.on('exit', code => {
    connection.console.error(
      `About to exit with code ${code}\n`,
    );
  });

  connection.listen();
}

if (require.main === module) {
  listen();
}
