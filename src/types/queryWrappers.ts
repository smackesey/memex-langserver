import { SyntaxNode } from 'tree-sitter';
import { FURI, ReferenceType } from '../types';
import { getCapture } from '../util';
import { QueryMatch } from './tree-sitter';

// ########################
// ##### WRAPPER METAPROGRAMMING
// ########################

type QuerySchema = { [field: string]: boolean };

type RequiredKeys<S> = {
  [K in keyof S]: S[K] extends true ? K : never;
}[keyof S]

// ----- MATCH WRAPPER

type QueryMatchWrapper<S, T> = (
  { match: QueryMatch } &
  Partial<Record<keyof S, T>> &
  Record<RequiredKeys<S>, T>
);

type Wrapper<S> = (
  QueryMatchWrapper<S, string> &
  { uri: FURI, nodes: QueryMatchWrapper<S, SyntaxNode> }
);

type WrapperConstructor<S> = {
  new (uri: FURI, obj: QueryMatch): Wrapper<S>
};

function makeWrapperClass<S extends QuerySchema>(
  schema: S,
): WrapperConstructor<S> {

  const NodeKlass = makeNodeWrapperClass<S>(schema);

  const klass = class {
    uri: FURI;
    match: QueryMatch;
    nodes: QueryMatchWrapper<S, SyntaxNode>;
    constructor(uri: FURI, match: QueryMatch) {
      this.uri = uri;
      this.match = match;
      this.nodes = new NodeKlass(match);
    }
  };

  // NOTE: alternative shorter form, but doesn't get the `get` signature right
  for (const k of Object.keys(schema)) {
    Object.defineProperty(klass.prototype, k, {
      get() {
        return getCapture(this.match, k, !schema[k])?.text;
      },
    });
  }
  return klass as WrapperConstructor<S>;
}

// ----- MATCH NODE WRAPPER

type NodeWrapperConstructor<S> = {
  new (obj: QueryMatch): QueryMatchWrapper<S, SyntaxNode>,
};

function makeNodeWrapperClass<S extends QuerySchema>(
  schema: S,
): NodeWrapperConstructor<S> {

  const klass = class {
    match: QueryMatch
    constructor(match: QueryMatch) {
      this.match = match;
    }
  };

  for (const k of Object.keys(schema)) {
    Object.defineProperty(klass.prototype, k, {
      get() {
        return getCapture(this.match, k, !schema[k]);
      },
    });
  }

  return klass as unknown as NodeWrapperConstructor<S>;
}

// type QuerySpec<S extends QuerySchema> = {
//   query: string,
//   schema: S,
//   klass: QueryMatchWrapper<S>,
// };
//
// const QUERY_SPEC_TABLE: { [name: string]: QuerySpec } = {};
//   klass: T extends QueryMatchWrapper<T>,
// };

// ===== DIRECTIVE ============================================================

const directiveSchema = {
  root: true,
  options: false,
  arguments: true,
  type: true,
};

export class Directive extends makeWrapperClass(directiveSchema) { }

// ===== ERROR ================================================================

const syntaxErrorSchema = {
  root: true,
};

export class SyntaxError extends makeWrapperClass(syntaxErrorSchema) { }

// ===== IMAGE CAROUSEL ======================================================

const imageCarouselSchema = {
  root: true,
} as const;

export class ImageCarousel extends makeWrapperClass(imageCarouselSchema) { }

// ===== INCLUDE ==============================================================

const includeSchema = {
  root: true,
  key: true,
} as const;

export class Include extends makeWrapperClass(includeSchema) {}

// ===== IMAGE REFERENCE ======================================================

const imageReferenceSchema = {
  root: true,
} as const;

export class ImageReference extends makeWrapperClass(imageReferenceSchema) { }

// ===== REFERENCE ============================================================

const referenceSchema = {
  root: true,
  citekey: false,
  key: true,
  header: true,
  displayName: false,
  annotation: false,
} as const;

export class Reference extends makeWrapperClass(referenceSchema) {
  get type(): ReferenceType {
    if (this.key.includes(' ')) return 'unknown';
    if (this.key.slice(0, 5) === 'mail:') return 'mail';
    else if (this.key.slice(0, 1) === '/') return 'media';
    else if (/^https?:\/\//.test(this.key)) return 'web';
    else if (/^[^. ]+\.[^. ]+\.[a-z]{8}/.test(this.key)) return 'record';
    else return 'unknown';
  }
}

// ===== REFERENCE BLOCKS =====================================================

const referenceBlockSchema = {
  root: true,
  title: true,
} as const;

export class ReferenceBlock extends makeWrapperClass(referenceBlockSchema) {}

// ===== REFERENCE CITATION ===================================================

const referenceCitationSchema = {
  root: true,
  citekey: true,
} as const;

export class ReferenceCitation extends makeWrapperClass(referenceCitationSchema) {}

// ===== SECTION ==============================================================

const sectionSchema = {
  root: true,
  citekey: false,
  header: true,
  title: true,
} as const;

export class Section extends makeWrapperClass(sectionSchema) {}

// ===== SECTION CITATION =====================================================

const sectionCitationSchema = {
  root: true,
  citekey: true,
} as const;

export class SectionCitation extends makeWrapperClass(sectionCitationSchema) {}

// ===== SECTION INCLUDE BLOCK ================================================

const sectionIncludeBlockSchema = {
  root: true,
} as const;

export class SectionIncludeBlock extends makeWrapperClass(sectionIncludeBlockSchema) {}

// ===== SECTION INCLUDE ======================================================

const sectionIncludeSchema = {
  root: true,
  key: true,
} as const;

export class SectionInclude extends makeWrapperClass(sectionIncludeSchema) {}
