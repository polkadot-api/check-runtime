import { HexString } from 'polkadot-api';

declare const Problem: {
    readonly ANCIENT_METADATA: "ANCIENT_METADATA";
    readonly MISSING_MODERN_METADATA: "MISSING_MODERN_METADATA";
    readonly MISSING_RUNTIME_APIS: "MISSING_RUNTIME_APIS";
    readonly DEV_APIS_PRESENT: "DEV_APIS_PRESENT";
    readonly MISSING_CHECK_METADATA_HASH_EXTENSION: "MISSING_CHECK_METADATA_HASH_EXTENSION";
    readonly DIFFERENT_METADATA_HASHES: "DIFFERENT_METADATA_HASHES";
    readonly WRONG_OR_MISSING_METADATA_HASH: "WRONG_OR_MISSING_METADATA_HASH";
};
type Problem = (typeof Problem)[keyof typeof Problem];

declare const getProblems: (uri: string, options?: Partial<{
    wasm: HexString;
    block: HexString | number;
    token: Partial<{
        symbol: string;
        decimals: number;
    }>;
}>) => Promise<Array<Problem>>;

export { getProblems };
