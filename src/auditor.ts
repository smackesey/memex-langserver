import fs from 'fs';
import path from 'path';
import { SyntaxNode } from 'tree-sitter';
import * as LSP from 'vscode-languageserver';
import Logger from './logger';
import Server from './server';
import {
  DiagnosticCode,
  PropertyCacher,
} from './types';
import Document from './types/document';
import { makeQuery, Query, QueryMatch } from './types/tree-sitter';
import Workspace from './types/workspace';
import {
  assertDefined,
  DEFINED_DIRECTIVES,
  getCapture,
  groupBy,
  serializeWikiUri,
  tsNodeToLspRange,
  uriToPath,
} from './util';

const { Error, Warning } = LSP.DiagnosticSeverity;

const log = new Logger('auditor');

export default class Auditor {

  private server: Server;

  constructor(server: Server) {
    this.server = server;
  }

  public async analyze(doc: Document): Promise<LSP.Diagnostic[]> {
    log.log(`Analyzing ${doc.uri}`);
    const diagnostics = await new DocumentAuditor(this.server, doc).run();
    log.log(`Computed ${diagnostics.length} diagnostics for ${doc.uri}`);
    return diagnostics;
  }

}

function logger(...codes: DiagnosticCode[]): MethodDecorator {
  return (_target: any, _name: string | symbol, descriptor: PropertyDescriptor) => {
    const func = descriptor.value;
    assertDefined(func);
    descriptor.value = async function logCount(this: DocumentAuditor, ...args: any[]): Promise<LSP.Diagnostic[]> {
      const diags: LSP.Diagnostic[] = await func.apply(this, args);
      codes.forEach(code => {
        const count = diags.filter(d => d.code === code).length;
        log.log(`Found ${count} ${code} instances for ` +
          serializeWikiUri(this.document.uri));
      });
      return diags;
    };
    return descriptor;
  };
}

class DocumentAuditor implements PropertyCacher {

  private server: Server;
  public document: Document;
  public cache: Map<(symbol | string), any>;

  get store() { return this.server.store; }
  get db() { return this.server.db; }

  constructor(
    server: Server,
    document: Document,
  ) {
    this.server = server;
    this.document = document;
    this.cache = new Map<(symbol | string), any>();
  }

  get workspace(): Workspace {
    return this.document.workspace;
  }

  clearCache() {
    this.cache.clear();
  }

  // **************************************************************************
  // ****** MAIN **************************************************************

  // NOTE: We use await here because we are waiting for the async logger
  // decorator, which TS does not understand.

  public async run(): Promise<LSP.Diagnostic[]> {
    const diagnostics: LSP.Diagnostic[] = [];
    try {
      diagnostics.push(...await this.getSyntaxErrors());
      diagnostics.push(...await this.getMissingReferenceCitations());
      diagnostics.push(...await this.getMissingSectionCitations());
      diagnostics.push(...await this.getBrokenReferenceCitations());
      diagnostics.push(...await this.getBrokenImageReferences());
      diagnostics.push(...await this.getBrokenSectionCitations());
      diagnostics.push(...await this.getBrokenIncludes());
      diagnostics.push(...await this.getBrokenOrStaleReferenceKeys());
      diagnostics.push(...await this.getUndefinedDirectives());
    } catch (err) {
      log.info(`Caught error: ${err}`);
    }
    log.info(`${diagnostics.length} diags`);
    return diagnostics;
  }

  // ===== SYNTAX ERRORS ======================================================

  @logger('syntax-error')
  private getSyntaxErrors() {
    const query = makeQuery(`
      (ERROR) @root
    `);
    const matches = this.execQuery(query).map(m => getCapture(m, 'root', false));
    const matchesByPosition = groupBy(matches, m => `${m.startIndex},${m.endIndex}`);
    const uniquePositions = [...matchesByPosition.values()].map(x => x[0]);
    return uniquePositions.map((m): LSP.Diagnostic => (
      this.makeDiagnostic(
        m, Error, 'syntax-error', 'Syntax error.',
      )
    ));
  }

  // ===== MISSING REFERENCE CITATIONS ========================================

  @logger('missing-reference-citation')
  private getMissingReferenceCitations(): LSP.Diagnostic[] {
    return this.document.referenceCitations
      .filter(x => x.citekey === '?')
      .map(c => (
        this.makeDiagnostic(c.nodes.root, Warning, 'missing-reference-citation',
          'Missing reference citation.')
      ));
  }

  // ===== MISSING SECTION CITATIONS ==========================================

  @logger('missing-section-citation')
  private getMissingSectionCitations(): LSP.Diagnostic[] {
    return this.document.sectionCitations
      .filter(x => x.citekey === '?')
      .map(c => (
        this.makeDiagnostic(c.nodes.root, Warning, 'missing-section-citation',
          'Missing section citation.')
      ));
  }

  // ===== BROKEN REFERENCE CITATIONS =========================================

  @logger('broken-reference-citation')
  private getBrokenReferenceCitations(): LSP.Diagnostic[] {
    const listings = this.workspace.referencesByCitekey;
    return this.document.referenceCitations
      .filter(({ citekey }) => !(citekey === '?' || listings.has(citekey)))
      .map(x => this.makeDiagnostic(
        x.nodes.root, Error, 'broken-reference-citation',
        `Citekey ${x.citekey} does not match any reference.`,
      ));
  }

  // ===== BROKEN IMAGE REFERENCES ==============================================

  @logger('broken-image-reference')
  private getBrokenImageReferences(): LSP.Diagnostic[] {
    const validPaths = this.document.workspace.mediaFiles.map(x => x.relativePath);
    return this.document.imageReferences
      .filter(({ root }) => !validPaths.includes(root))
      .map(x => this.makeDiagnostic(
        x.nodes.root, Error, 'broken-image-reference',
        `Image path ${x.root} does not match any file.`,
      ));
  }

  // ===== BROKEN SECTION CITATIONS ===========================================

  @logger('broken-section-citation')
  private getBrokenSectionCitations(): LSP.Diagnostic[] {
    const listings = this.workspace.sectionsByCitekey;
    const broken = this.document.sectionCitations
      .filter(({ citekey }) => !(citekey === '?' || listings.has(citekey)));
    log.log(`found ${broken.length} broken section citations for ${this.document.uri}`);
    return broken.map(x => this.makeDiagnostic(
      x.nodes.root, Error, 'broken-section-citation',
      `Citekey ${x.citekey} does not match any section.`,
    ));
  }

  // ===== BROKEN INCLUDES ======================================================

  @logger('broken-include')
  private getBrokenIncludes(): LSP.Diagnostic[] {
    const dpath = uriToPath(this.document.uri);
    const dirname = path.dirname(dpath);
    const basename = path.basename(dpath);
    const basePath = basename === 'index.rst' ?
      dirname : path.join(dirname, basename.replace(/\.rst$/, ''));
    const diags: LSP.Diagnostic[] = [];
    log.info(`Found ${this.document.includes.length} includes.`);
    this.document.includes.forEach(({ key, nodes }) => {
      if (!key.includes('*')) {  // skip globs
        log.info(key);
        const targetPath = path.join(basePath, `${key}.rst`);
        if (!fs.existsSync(targetPath)) {
          diags.push(this.makeDiagnostic(
            nodes.root, Error, 'broken-include',
            `Broken reference to nonexistent file ${targetPath}.`,
          ));
        }
      }
    });
    return diags;
  }

  // ===== BROKEN REFERENCE KEYS ==============================================

  @logger('broken-reference-key', 'stale-reference-key')
  private async getBrokenOrStaleReferenceKeys(): Promise<LSP.Diagnostic[]> {
    const diags = await Promise.all(
      this.document.referenceListings.map(async ({
        key, type, nodes,
      }): Promise<LSP.Diagnostic | null> => {
        if (type === 'unknown') {
          return this.makeDiagnostic(
            nodes.key, Error, 'broken-reference-key',
            `Invalid key \`${key}\`.`,
          );
        } else if (type === 'media') {
          log.info(`key: ${key}`);
          const relativePath = key.substr(1);
          const validPaths = this.document.workspace.mediaFiles.map(x => x.relativePath);

          if (!validPaths.includes(relativePath)) {
            return this.makeDiagnostic(
              nodes.key, Error, 'broken-reference-key',
              `Key \`${key}\` does not point to an existing media file.`,
            );
          }
        } else if (type === 'record') {
          const id = key.split('.')[2];
          const realKey = await this.db.getKey(id);
          if (realKey === undefined) {
            return this.makeDiagnostic(
              nodes.key, Error, 'broken-reference-key',
              `Key \`${key}\` does not point to any existing record with id ${id}.`,
            );
          } else if (key !== realKey) {
            return this.makeDiagnostic(
              nodes.key, Warning, 'stale-reference-key',
              `Key \`${key}\` is stale.`,
            );
          }
        }
        return null;
      }));
    return diags.filter((x): x is LSP.Diagnostic => x !== null);
  }

  // ===== UNDEFINED DIRECTIVES =================================================

  @logger('undefined-directive')
  private getUndefinedDirectives(): LSP.Diagnostic[] {
    const query = makeQuery(`
      (directive
        (directive_type) @type) @root
    `);
    const diags: LSP.Diagnostic[] = [];
    this.execQuery(query).forEach(x => {
      const type = getCapture(x, 'type', false).text.slice(0, -2);
      if (!DEFINED_DIRECTIVES.includes(type)) {
        log.log(`type is ${type}`);
        diags.push(this.makeDiagnostic(
          getCapture(x, 'root', false), Error,
          'undefined-directive', `Undefined directive \`${type}::\``,
        ));
      }
    });
    return diags;
  }

  // **************************************************************************
  // ****** UTILITIES *********************************************************

  private makeDiagnostic(
    node: SyntaxNode,
    severity: LSP.DiagnosticSeverity,
    code: DiagnosticCode,
    message: string,
  ): LSP.Diagnostic {
    return {
      severity,
      message,
      code,
      range: tsNodeToLspRange(node),
      source: 'memexwiki',
    };
  }

  private execQuery(query: Query): QueryMatch[] {
    return query.matches(this.document.tree.rootNode);
  }

}
