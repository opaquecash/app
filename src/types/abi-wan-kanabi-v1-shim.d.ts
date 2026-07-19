/**
 * Type shim for `abi-wan-kanabi-v1`.
 *
 * get-starknet v3 bundles a legacy `starknet` whose `.d.ts` imports `abi-wan-kanabi-v1`, a
 * package that ships raw `.ts` with no `types` field. Under `verbatimModuleSyntax` + `noUnused*`,
 * tsc type-checks that raw source (skipLibCheck only skips `.d.ts`) and errors out. A tsconfig
 * `paths` redirect points the import here instead; `skipLibCheck` then covers the bundled
 * starknet `.d.ts` that consumes these types. Vite has no tsconfig-paths plugin, so runtime
 * still resolves the real package — this affects type-checking only, and our code never touches
 * these types (the Starknet wallet is used through our own narrow interface).
 */

export type Abi = readonly unknown[];
export type TypedContract<T = unknown> = unknown;
export type TypedContractV2<T = unknown> = unknown;
export type ContractFunctions<T = unknown> = unknown;
export type ExtractAbiFunction<T = unknown, N = unknown> = unknown;
export type ExtractAbiFunctionNames<T = unknown> = string;
export type FunctionArgs<T = unknown, N = unknown> = unknown;
export type FunctionRet<T = unknown, N = unknown> = unknown;

declare const _default: unknown;
export default _default;
