export interface ProductBuildIdentity {
  schema: 1;
  version: string;
  mode: 'production' | 'development';
  sourceSha256: string;
  sourceFiles: number;
  sourceTimestamp: string | null;
  timestampSource: string;
  scope: string;
}
declare const __LUMINA_BUILD__: ProductBuildIdentity;

/** Embedded at build time; missing tooling is explicit rather than guessed. */
export function productBuildIdentity(): ProductBuildIdentity | null {
  return typeof __LUMINA_BUILD__ === 'undefined' ? null : { ...__LUMINA_BUILD__ };
}
