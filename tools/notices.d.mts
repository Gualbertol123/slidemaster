/* types for tools/notices.mjs (imported by app/tests/notices.test.ts) */
export declare const NOTICES_FILE: string, PAGE_FILE: string, APACHE: string;
export declare function isLicence(file: string): boolean;
export declare function bundled(root?: string): Promise<{
  packages: Map<string, { dir: string; version: string; licence: string; url: string; where: string[] }>;
  wasmDirs: Set<string>;
  wasmWhere: Map<string, string[]>;
}>;
export declare function notices(root?: string): Promise<string>;
export declare function pageModule(text: string): string;
