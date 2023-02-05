import * as LSP from 'vscode-languageserver';
import { FURI, QueryScope, ReferenceType, SectionTreeNode, FileTreeNode } from '../types';

// ****************************************************************************
// ****** AUDIT ***************************************************************

export interface AuditRequest {
  uri: string,
}

export interface AuditResponse {
  diagnostics: LSP.Diagnostic[],
}

// ****************************************************************************
// ****** FILE TREE ***********************************************************

export interface FileTreeRequest {
  uri: FURI,
  type: QueryScope,
}

export interface FileTreeResponse {
  root: FileTreeNode,
}

// ****************************************************************************
// ****** GET IMAGE REFERENCES ************************************************

export interface GetImageReferencesRequest {
  uri: string,
}

export interface GetImageReferencesResponse {
  imageReferences: ({ path: string })[]
}

// ****************************************************************************
// ****** GET REFERENCES ******************************************************

export interface GetReferencesRequest {
  uri: string,
  scope: QueryScope,
}

export interface GetReferencesResponse {
  references: ({ key: string, type: ReferenceType})[],
}

// ****************************************************************************
// ****** PARSE ***************************************************************

export interface ParseRequest {
  path: string
}

export interface ParseResponse {
  tree: string,
}

// ****************************************************************************
// ****** OUTLINE *************************************************************

export interface OutlineRequest {
  uri: FURI,
  scope: QueryScope,
}

export interface OutlineResponse {
  root: SectionTreeNode,
}
