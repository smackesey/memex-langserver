import fs from 'fs';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import * as LSP from 'vscode-languageserver';
import Annotater from './annotater';
import CodeLensAnnotater from './codeLensAnnotater';
import Completer from './completer';
import DefinitionResolver from './definitionResolver';
import config from './config';
import DB from './db';
import Fixer from './fixer';
import Logger from './logger';
import Store from './store';
import TaskManager from './taskManager';
import { TreeSitterTextDocument } from './textDocument';
import {
  FURI,
  ReferenceType,
  Task,
  TaskOperation,
} from './types';
import {
  AuditRequest,
  AuditResponse,
  FileTreeRequest,
  FileTreeResponse,
  GetImageReferencesRequest,
  GetImageReferencesResponse,
  GetReferencesRequest,
  GetReferencesResponse,
  OutlineRequest,
  OutlineResponse,
  ParseRequest,
  ParseResponse,
} from './types/customServices';
import Document, { DocumentRef, DocumentState } from './types/document';
import { Reference } from './types/queryWrappers';
import Workspace, { WorkspaceRef } from './types/workspace';
import {
  adjustSymbolNewName,
  assertDefined,
  getSymbol,
  groupBy,
  rangeIntersection,
  resolveDocumentWorkspace,
  resolveWorkspaceDocuments,
  safeCollectionGet,
  safeGet,
  serializeWikiUri,
  tsNodeToLspRange,
  uriToPath,
} from './util';

const log = new Logger('server');

type ErrorCode = 'bad-uri';

export default class Server {

  public db: DB;
  public store: Store;
  private annotater: Annotater;
  private completer: Completer;
  private connection: LSP.Connection;
  private definitionResolver: DefinitionResolver;
  private taskManager: TaskManager;
  private codeLensAnnotater: CodeLensAnnotater;
  private fixer: Fixer;
  private debouncers: Map<FURI, Subject<undefined>>;
  public capabilities: LSP.ServerCapabilities;

  public static capabilities: LSP.ServerCapabilities = {
    codeActionProvider: true,
    codeLensProvider: {
      resolveProvider: false,
    },
    completionProvider: {
      triggerCharacters: ['`', ':', '/'],
      resolveProvider: true,
    },
    definitionProvider: true,
    hoverProvider: true,
    renameProvider: {
      prepareProvider: true,
    },
    referencesProvider: true,
    textDocumentSync: LSP.TextDocumentSyncKind.Incremental,
  }

  constructor(
    connection: LSP.Connection,
    params: LSP.InitializeParams,
  ) {
    this.connection = connection;
    this.capabilities = this.getCapabilities(params);
    this.store = new Store(this);
    this.db = new DB(this);
    this.annotater = new Annotater(this);
    this.completer = new Completer(this);
    this.fixer = new Fixer(this);
    this.definitionResolver = new DefinitionResolver(this);
    this.codeLensAnnotater = new CodeLensAnnotater(this);
    this.taskManager = new TaskManager(this);
    this.debouncers = new Map<FURI, Subject<undefined>>();
    this.setupHandlers();
  }

  private setupHandlers() {
    this.connection.onCodeAction(this.onCodeAction.bind(this));
    this.connection.onCodeLens(this.onCodeLens.bind(this));
    this.connection.onCompletion(this.onCompletion.bind(this));
    this.connection.onDefinition(this.onDefinition.bind(this));
    this.connection.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this));
    this.connection.onDidOpenTextDocument(this.onDidOpenTextDocument.bind(this));
    this.connection.onDidCloseTextDocument(this.onDidCloseTextDocument.bind(this));
    this.connection.onDidChangeTextDocument(this.onDidChangeTextDocument.bind(this));
    this.connection.onExecuteCommand(this.onExecuteCommand.bind(this));
    this.connection.onHover(this.onHover.bind(this));
    this.connection.onPrepareRename(this.onPrepareRename.bind(this));
    this.connection.onRenameRequest(this.onRename.bind(this));
    this.connection.onReferences(this.onReferences.bind(this));

    this.connection.onExit(() => {
      process.exit(0);
    });
    this.connection.onRequest(this.onCustomRequest.bind(this));
    this.connection.onNotification(this.onCustomNotification.bind(this));
  }

  private getCapabilities(_params: LSP.InitializeParams) {
    return Server.capabilities;
  }

  public publishDiagnostics(uri: FURI, diagnostics: LSP.Diagnostic[]): void {
    this.connection.sendDiagnostics({ uri, diagnostics });
  }

  // **************************************************************************
  // ****** HANDLERS **********************************************************

  private onCodeLens({ textDocument }: LSP.CodeLensParams): LSP.CodeLens[] {
    log.info('Got request codeLens');
    const doc = safeCollectionGet(this.store.documents, 'uri', textDocument.uri);
    return this.codeLensAnnotater.run(doc);
  }

  private onDidOpenTextDocument({ textDocument }: LSP.DidOpenTextDocumentParams) {
    const { uri } = textDocument;
    log.info(`Got notification didOpenTextDocument: ${serializeWikiUri(uri)}`);
    const wsUri = resolveDocumentWorkspace(uri);
    if (this.store.workspaces.by('uri', wsUri) === undefined) {
      this.addWorkspace(wsUri);
    }
    const doc = safeCollectionGet(this.store.documents, 'uri', uri);
    doc.state = DocumentState.editing;
    this.store.documents.update(doc);
    this.analyzeDocument(uri, false);
  }

  private onDidChangeTextDocument({ textDocument, contentChanges }: LSP.DidChangeTextDocumentParams) {
    const { uri, version } = textDocument;
    log.info(`Got notification didChangeTextDocument: ${serializeWikiUri(uri)}`);
    if (version === null || version === undefined) {
      throw new Error(`Received document change event for ${uri} \
        without valid version identifier`);
    }
    const doc = safeCollectionGet(this.store.documents, 'uri', uri);
    doc.update(version, contentChanges);
    this.store.documents.update(doc);
    doc.workspace.clearCache();
    this.analyzeDocument(uri);
  }

  private onDidCloseTextDocument({ textDocument }: LSP.DidCloseTextDocumentParams) {
    const { uri } = textDocument;
    log.info(`Got notification didCloseTextDocument: ${serializeWikiUri(uri)}`);
    const doc = safeCollectionGet(this.store.documents, 'uri', uri);
    if (doc.workspace.type === 'single-file') {
      this.dropWorkspace(uri);
    } else {
      const noRemainingDocsOpen = doc.workspace.documents.every(idoc => (
        idoc.uri === uri || doc.state === DocumentState.indexing
      ));
      if (noRemainingDocsOpen) {
        this.dropWorkspace(doc.workspace);
      } else {
        doc.state = DocumentState.indexing;
        this.store.documents.update(doc);
      }
    }
  }

  private onDidChangeWorkspaceFolders(params: LSP.DidChangeWorkspaceFoldersParams) {
    log.info('Got notification didChangeWorkspaceFolders:');
    log.info(`  added: ${params.event.added}`);
    log.info(`  removed: ${params.event.removed}`);
    params.event.added.forEach(({ uri }) => {
      this.addWorkspace(uri);
    });
    params.event.removed.forEach(({ uri }) => {
      this.dropWorkspace(uri);
    });
  }

  private onDidChangeConfiguration({ settings }: LSP.DidChangeConfigurationParams) {
    const conf: any = settings.memexwiki;
    config.load(conf);
  }

  private onCompletion(params: LSP.TextDocumentPositionParams): LSP.CompletionItem[] {
    log.info('Got request completion:');
    const { textDocument: { uri }, position } = params;
    const doc = this.store.documents.by('uri', uri);
    assertDefined<Document>(doc, () => this.error('bad-uri', { uri }));
    return this.completer.complete(doc, position);
  }

  private async onCodeAction(params: LSP.CodeActionParams): Promise<LSP.CodeAction[]> {
    log.info('Got request codeAction:');
    const { textDocument: { uri }, range, context: { diagnostics } } = params;
    const doc = safeCollectionGet(this.store.documents, 'uri', uri);
    const diags = (diagnostics.length > 0) ?
      diagnostics :
      await (this.getDiagnostics(doc).then(idiags => (
        idiags.filter(x => rangeIntersection(x.range, range) !== null)
      )));
    const fixes = await Promise.all(diags.map(x => this.fixer.getFix(doc, x)));
    return fixes.filter((x): x is LSP.CodeAction => x !== undefined);
  }

  private onDefinition(params: LSP.DefinitionParams): LSP.DefinitionLink[] | null {
    log.info('Got request definition:');
    const { textDocument: { uri }, position } = params;
    const doc = safeCollectionGet(this.store.documents, 'uri', uri);
    log.info('uri is ' + uri);
    return this.definitionResolver.resolve(doc, position);
  }

  private onExecuteCommand(params: LSP.ExecuteCommandParams): void {
    const { command } = params;
    if (command === 'reparse') {
      const [uri] = params.arguments as [string];
      const doc = safeCollectionGet(this.store.documents, 'uri', uri);
      doc.reparse();
      this.analyzeDocument(doc, false);
    } else {
      throw new Error(`Unrecognized command \`${command}\`.`);
    }
  }

  private onHover(params: LSP.TextDocumentPositionParams): LSP.Hover | null {
    const { textDocument: { uri }, position } = params;
    const doc = this.store.documents.by('uri', uri);
    assertDefined<Document>(doc, () => this.error('bad-uri', { uri }));
    return this.annotater.annotate(doc, position);
  }

  private onRename(
    params: LSP.RenameParams,
  ): LSP.WorkspaceEdit | null {
    log.info('Got request rename');
    const { textDocument: { uri }, position, newName } = params;
    const doc = safeCollectionGet(this.store.documents, 'uri', uri);
    const sym = getSymbol(doc, position);
    if (sym === undefined) {
      return null;
    } else {
      log.info(`Rename symbol ${sym.node.text}`);
      const allTargets = doc.workspace.getAllSymbolInstances(sym);
      log.info(`Rename symbol: ${allTargets.length} instances`);
      const changes: LSP.TextDocumentEdit[] = [];
      const targetsByUri = groupBy(allTargets, x => x.documentUri);
      for (const [iuri, targets] of targetsByUri.entries()) {
        const idoc = safeCollectionGet(this.store.documents, 'uri', iuri);
        if (idoc.state === DocumentState.editing) {
          changes.push({
            textDocument: {
              uri: iuri,
              version: idoc.version,
            },
            edits: targets.map(x => ({
              range: tsNodeToLspRange(x.node),
              newText: adjustSymbolNewName(x, newName),
            })),
          });
        } else if (idoc.state === DocumentState.indexing) {
          const contentChanges = targets.map((x): LSP.TextDocumentContentChangeEvent => ({
            range: tsNodeToLspRange(x.node),
            text: adjustSymbolNewName(x, newName),
          }));
          idoc.update(idoc.version + 1, contentChanges);
          idoc.saveToDisk();
        }
      }
      return { documentChanges: changes };
    }
  }

  private onPrepareRename(
    params: LSP.PrepareRenameParams,
  ): { range: LSP.Range, placeholder: string } | null {
    const { textDocument: { uri }, position } = params;
    log.info('Received PrepareRename!');
    const doc = safeCollectionGet(this.store.documents, 'uri', uri);
    const sym = getSymbol(doc, position);
    if (sym === undefined) {
      return null;
    } else {
      log.info('Node text: ' + sym.node.text);
      return {
        range: tsNodeToLspRange(sym.node),
        placeholder: sym.node.text,
      };
    }
  }

  private onReferences(params: LSP.ReferenceParams): LSP.Location[] | null {
    const { textDocument: { uri }, position } = params;
    const doc = safeCollectionGet(this.store.documents, 'uri', uri);
    // const citekey = getTextContext(doc, position, 'symbol');
    const sym = getSymbol(doc, position);
    if (sym === undefined) {
      return null;
    } else {
      log.info(`finding references for ${sym.node.text}`);
      const instances = doc.workspace.getAllSymbolInstances(sym);
      return instances.map(x => ({
        uri: x.documentUri,
        range: tsNodeToLspRange(x.node),
      }));
    }
  }

  // **************************************************************************
  // ****** CUSTOM NOTIFICATIONS **********************************************

  private onCustomNotification(method: string, params: any) {
    log.info(`Got notification ${method}`);
    switch (method) {
      case 'workspace/didChangeWorkspaceFolders':
        this.onDidChangeWorkspaceFolders(params); break;
      case 'workspace/ping':
        log.info('ping!'); break;
      case 'custom/applyWorkspaceEdit':
        this.onApplyWorkspaceEdit(params); break;
      default:
        if (/^custom/.test(method)) {
          throw new Error(`Unrecognized notification method ${method}.`);
        }
    }
  }

  private onApplyWorkspaceEdit(params: LSP.WorkspaceEdit) {
    const { documentChanges } = params;
    if (documentChanges === undefined) this.workspaceEditError();
    documentChanges.forEach(change => {
      const ichange = change as LSP.CreateFile | LSP.RenameFile | LSP.DeleteFile;
      if (ichange.kind === 'create') {
        this.createFile(ichange);
      } else if (ichange.kind === 'rename') {
        this.renameFile(ichange);
      } else if (ichange.kind === 'delete') {
        this.deleteFile(ichange);
      } else {
        this.workspaceEditError();
      }
    });
  }

  private createFile(_params: LSP.CreateFile) {
    // this.on
  }

  private deleteFile({ uri }: LSP.DeleteFile) {
    this.dropDocument(uri);
  }

  private renameFile(params: LSP.RenameFile) {
    const { oldUri, newUri } = params;
    const doc = safeCollectionGet(this.store.documents, 'uri', oldUri);
    const newWsUri = resolveDocumentWorkspace(newUri);

    // no change in the workspace
    if (doc.workspace?.uri === newWsUri) {
      doc.uri = newUri;
      this.store.documents.update(doc);

    // change in the workspace
    } else {
      const { text } = doc;
      // treat it like opening a new file
      this.dropDocument(doc);
      this.onDidOpenTextDocument({
        textDocument: {
          uri: newUri,
          text,
          languageId: 'memexwiki',
          version: 1,
        },
      });
    }
  }

  private workspaceEditError(): never {
    throw new Error('Illegal workspace edit.');
  }

  // private assertFileResourceChange(
  //   change: unknown,
  // ): asserts change is LSP.CreateFile | LSP.RenameFile | LSP.DeleteFile {
  //   if (!(typeof change === 'object' && 'kind' in change)) {
  //     throw new Error('Not a File Resource operation.');
  //   }
  // }

  // ************************************************************************
  // ****** CUSTOM REQUESTS *************************************************

  private async onCustomRequest(method: string, params: any) {
    log.info(`Got request ${method}`);
    log.info(JSON.stringify(params));
    switch (method) {
      case 'custom/audit':
        return this.audit(params as AuditRequest);
      case 'custom/getImageReferences':
        return this.getImageReferences(params as GetImageReferencesRequest);
      case 'custom/getReferences':
        return this.getReferences(params as GetReferencesRequest);
      case 'custom/fileTree':
        return this.getFileTree(params as FileTreeRequest);
      case 'custom/outline':
        return this.getOutline(params as OutlineRequest);
      case 'custom/parseTextDocument':
        return this.parseTextDocument(params as ParseRequest);
      default:
        throw new Error(`Unrecognized request method ${method}.`);
    }
  }

  private async audit(params: AuditRequest): Promise<AuditResponse> {
    const { uri } = params;
    const wsUri = resolveDocumentWorkspace(uri);
    if (this.store.workspaces.by('uri', wsUri) === undefined) {
      this.addWorkspace(wsUri);
    }
    const doc = safeCollectionGet(this.store.documents, 'uri', uri);
    return this.taskManager.submitTask(doc.auditTask).then(() => {
      assertDefined(doc.diagnostics);
      return { diagnostics: doc.diagnostics };
    });
  }

  private getFileTree(params: FileTreeRequest): FileTreeResponse {
    const { uri, type } = params;
    const wsUri = resolveDocumentWorkspace(uri);
    if (this.store.workspaces.by('uri', wsUri) === undefined) {
      this.addWorkspace(wsUri);
    }
    if (type === 'workspace') {
      const ws = safeCollectionGet(this.store.workspaces, 'uri', wsUri);
      return { root: ws.index.fileTree };
    } else if (type === 'document') {
      const doc = safeCollectionGet(this.store.documents, 'uri', uri);
      return { root: doc.fileTree };
    } else {
      throw new Error(`Type "${type}" is not a valid outline type.`);
    }
  }

  private getImageReferences(params: GetImageReferencesRequest): GetImageReferencesResponse {
    const { uri } = params;
    if (this.store.workspaces.by('uri', uri) === undefined) {
      this.addWorkspace(uri);
    }
    const ws = safeCollectionGet(this.store.workspaces, 'uri', uri);
    const allImageReferences = ws.getAllImageReferences().map(x => ({
      path: x.root,
    }));
    return { imageReferences: allImageReferences };
  }

  private getReferences(params: GetReferencesRequest): GetReferencesResponse {
    const { uri, scope } = params;
    const wsUri = resolveDocumentWorkspace(uri);
    if (this.store.workspaces.by('uri', wsUri) === undefined) {
      this.addWorkspace(wsUri);
    }
    if (scope === 'workspace') {
      const ws = safeCollectionGet(this.store.workspaces, 'uri', wsUri);
      const allReferences = [...ws.referencesByKey.values()].map(this.convertReference);
      return { references: allReferences };
    } else if (scope === 'document') {
      const doc = safeCollectionGet(this.store.documents, 'uri', uri);
      const references = doc.referenceListings.map(this.convertReference);
      return { references };
    } else {
      throw new Error(`"${scope}" is not a valid reference scope.`);
    }
  }

  private convertReference({ key, type }: Reference): { key: string, type: ReferenceType } {
    return { key, type };
  }

  private parseTextDocument(params: ParseRequest): ParseResponse {
    const { path } = params;
    const content = fs.readFileSync(path, { encoding: 'utf8' });
    const document = TreeSitterTextDocument.create(
      params.path, 'memexwiki', 1, content);
    const parseTree = document.tree.rootNode.toString();
    return { tree: parseTree };
  }

  private getOutline(params: OutlineRequest): OutlineResponse {
    const { uri, scope } = params;
    const wsUri = resolveDocumentWorkspace(uri);
    if (this.store.workspaces.by('uri', wsUri) === undefined) {
      this.addWorkspace(wsUri);
    }
    if (scope === 'workspace') {
      const ws = safeCollectionGet(this.store.workspaces, 'uri', wsUri);
      return { root: ws.sectionTree };
    } else if (scope === 'document') {
      const doc = safeCollectionGet(this.store.documents, 'uri', uri);
      return { root: doc.sectionTree };
    } else {
      throw new Error(`"${scope}" is not a valid outline scope.`);
    }
  }

  // **************************************************************************
  // ****** UTILITIES *********************************************************

  public addWorkspace(uri: FURI): void {
    const workspace = new Workspace(this.store, { uri });
    this.store.workspaces.insert(workspace);
    const docPaths = workspace.type === 'single-file' ?
      [uri] :
      resolveWorkspaceDocuments(uri);
    const docs = docPaths.map(furi => {
      const text = fs.readFileSync(uriToPath(furi), { encoding: 'utf8' });
      const state = uri === furi ? DocumentState.editing : DocumentState.indexing;
      const doc = new Document(this.store, {
        uri: furi,
        text,
        state,
        workspaceId: workspace.id,
      });
      this.store.documents.insert(doc);
      return doc;
    });
    docs.forEach(doc => {
      const task = new Task(this.store, {
        operation: TaskOperation.audit,
        documentId: doc.id,
        dependencyIds: [],
      });
      this.store.tasks.insert(task);
      return task;
    });
  }

  public dropDocument(docRef: DocumentRef) {
    const doc = this.normalizeDocument(docRef);
    doc.tasks.forEach(task => {
      const { job } = task;
      if (job !== undefined) {
        this.taskManager.cancelJob(job.id);
        this.store.jobs.remove(job);
      }
      this.store.tasks.remove(task);
    });
    this.store.documents.remove(doc);
  }

  public dropWorkspace(wsRef: WorkspaceRef): void {
    const workspace = this.normalizeWorkspace(wsRef);
    workspace.documents.forEach(doc => {
      this.dropDocument(doc);
    });
    this.store.workspaces.remove(workspace);
  }

  public analyzeDocument(docRef: DocumentRef, debounce: boolean = true) {
    const doc = this.normalizeDocument(docRef);
    if (debounce) this.getDebouncer(doc.uri).next(undefined);
    else {
      this.getDiagnostics(doc).then(diagnostics => {
        this.connection.sendDiagnostics({
          uri: doc.uri,
          diagnostics,
        });
      });
    }
  }

  private async getDiagnostics(doc: Document): Promise<LSP.Diagnostic[]> {
    return this.taskManager.submitTask(doc.auditTask).then(() => {
      assertDefined(doc.diagnostics);
      return doc.diagnostics;
    });
  }

  private getDebouncer(uri: FURI): Subject<undefined> {
    if (this.debouncers.has(uri)) {
      return safeGet(this.debouncers, uri);
    } else {
      const subject = new Subject<undefined>();
      subject.pipe(
        debounceTime(500),
      ).subscribe(() => {
        this.analyzeDocument(uri, false);
      });
      this.debouncers.set(uri, subject);
      return subject;
    }
  }

  // ===== NORMALIZERS ========================================================

  private normalizeDocument(docRef: DocumentRef) {
    let doc: Document | undefined;
    if (typeof docRef === 'string') {
      doc = safeCollectionGet(this.store.documents, 'uri', docRef);
    } else if (typeof docRef === 'number') {
      doc = safeCollectionGet(this.store.documents, 'id', docRef);
    } else {
      doc = docRef;
    }
    return doc;
  }

  private normalizeWorkspace(wsRef: WorkspaceRef) {
    let ws: Workspace | undefined;
    if (typeof wsRef === 'string') {
      ws = safeCollectionGet(this.store.workspaces, 'uri', wsRef);
    } else if (typeof wsRef === 'number') {
      ws = safeCollectionGet(this.store.workspaces, 'id', wsRef);
    } else {
      ws = wsRef;
    }
    return ws;
  }

  // ===== ERROR ==============================================================

  private error(code: ErrorCode, params: any): never {
    let msg;
    switch (code) {
      case 'bad-uri':
        msg = `No resource exists at ${params.uri}`;
        break;
      default:
        msg = `Error: ${code}`;
    }
    throw new Error(msg);
  }

}
