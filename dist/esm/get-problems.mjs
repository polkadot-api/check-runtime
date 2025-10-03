import { Binary } from 'polkadot-api';
import { unifyMetadata, decAnyMetadata } from '@polkadot-api/substrate-bindings';
import { merkleizeMetadata } from '@polkadot-api/merkleize-metadata';
import { toHex } from 'polkadot-api/utils';
import { lastValueFrom, takeWhile } from 'rxjs';
import { withMetadataHash } from './with-metadata-hash.mjs';
import { alice } from './alice.mjs';
import { getChopsticksClient } from './chopsticks.mjs';
import { Problem } from './problems.mjs';

const DEV_APIS = ["TryRuntime", "Benchmark"];
const getProblems = async (uri, options = {}) => {
  let client = void 0;
  let metadata;
  let metadataRaw;
  try {
    client = await getChopsticksClient(uri, options);
    metadataRaw = await client.getMetadata(
      (await client.getFinalizedBlock()).hash
    );
    metadata = unifyMetadata(decAnyMetadata(metadataRaw));
  } catch {
    try {
      client?.destroy();
    } catch {
    }
    return [Problem.ANCIENT_METADATA];
  }
  try {
    if (metadata.version < 15) return [Problem.MISSING_MODERN_METADATA];
    const problems = [];
    if (!metadata.apis.length) problems.push(Problem.MISSING_RUNTIME_APIS);
    else if (metadata.apis.some((x) => DEV_APIS.includes(x.name) && x.methods.length))
      problems.push(Problem.DEV_APIS_PRESENT);
    let { symbol, decimals } = options.token ?? {};
    if (!symbol || decimals === void 0) {
      const {
        properties: { tokenSymbol, tokenDecimals }
      } = await client.getChainSpecData();
      symbol || (symbol = tokenSymbol);
      decimals = decimals === void 0 ? tokenDecimals : decimals;
    }
    const merkelizerProps = {
      decimals,
      tokenSymbol: symbol
    };
    const getDiggest = (input) => toHex(merkleizeMetadata(input, merkelizerProps).digest());
    if (metadata.version === 16) {
      const rawMetadata15 = (await client.api.apis.Metadata.metadata_at_version(
        15
      )).asBytes();
      const diggest15 = getDiggest(rawMetadata15);
      const diggest16 = getDiggest(metadataRaw);
      if (diggest15 !== diggest16) {
        problems.push(Problem.DIFFERENT_METADATA_HASHES);
        metadataRaw = rawMetadata15;
      }
    }
    if (!metadata.extrinsic.signedExtensions.some(
      (s) => s.identifier === "CheckMetadataHash"
    )) {
      problems.push(Problem.MISSING_CHECK_METADATA_HASH_EXTENSION);
    }
    try {
      await lastValueFrom(
        client.api.tx.System.remark({
          remark: Binary.fromText("PAPI Rocks!")
        }).signSubmitAndWatch(
          withMetadataHash(alice, merkelizerProps, metadataRaw)
        ).pipe(takeWhile((e) => e.type !== "broadcasted"))
      );
    } catch {
      problems.push(Problem.WRONG_OR_MISSING_METADATA_HASH);
    }
    return problems;
  } finally {
    client.destroy();
  }
};

export { getProblems };
//# sourceMappingURL=get-problems.mjs.map
