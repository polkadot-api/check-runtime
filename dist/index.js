'use strict';

var polkadotApi = require('polkadot-api');
var substrateBindings = require('@polkadot-api/substrate-bindings');
var merkleizeMetadata = require('@polkadot-api/merkleize-metadata');
var utils = require('polkadot-api/utils');
var rxjs = require('rxjs');
var hdkd = require('@polkadot-labs/hdkd');
var hdkdHelpers = require('@polkadot-labs/hdkd-helpers');
var signer = require('polkadot-api/signer');
var jsonRpcProviderProxy = require('@polkadot-api/json-rpc-provider-proxy');

const EXTENSION_ID = "CheckMetadataHash";
const withMetadataHash = (signer, info, customMetadata) => {
  return {
    ...signer,
    signTx: async (callData, extensions, metadata, ...rest) => {
      const merkleizer = merkleizeMetadata.merkleizeMetadata(customMetadata ?? metadata, info);
      return signer.signTx(
        callData,
        {
          ...extensions,
          [EXTENSION_ID]: {
            identifier: EXTENSION_ID,
            value: Uint8Array.from([1]),
            additionalSigned: utils.mergeUint8([
              Uint8Array.from([1]),
              merkleizer.digest()
            ])
          }
        },
        metadata,
        ...rest
      );
    }
  };
};

const entropy = hdkdHelpers.mnemonicToEntropy(hdkdHelpers.DEV_PHRASE);
const derive = hdkd.sr25519CreateDerive(hdkdHelpers.entropyToMiniSecret(entropy));
const keyPair = derive("//Alice");
const address = polkadotApi.AccountId().dec(keyPair.publicKey);
const alice = {
  ...signer.getPolkadotSigner(keyPair.publicKey, "Sr25519", keyPair.sign),
  address
};

if (typeof process === "object" && "env" in process)
  process.env.LOG_LEVEL = "fatal";
let nActiveClients = 0;
const getChopsticksProvider = (endpoint, {
  wasm,
  block
} = {}) => jsonRpcProviderProxy.getSyncProvider(async () => {
  const { ChopsticksProvider, setup, destroyWorker } = await import('@acala-network/chopsticks-core');
  const chain = await setup({ endpoint, block, runtimeLogLevel: 0 });
  if (wasm) chain.head.setWasm(wasm);
  await chain.api.isReady;
  const innerProvider = new ChopsticksProvider(chain);
  await innerProvider.isReady;
  return (onMessage) => {
    nActiveClients++;
    const subscriptions = /* @__PURE__ */ new Set();
    return {
      send: async (message) => {
        const parsed = JSON.parse(message);
        if (parsed.method === "chainHead_v1_follow") {
          const subscription = await innerProvider.subscribe(
            "chainHead_v1_followEvent",
            parsed.method,
            parsed.params,
            (err, result) => {
              if (err) {
                console.error(err);
              } else
                onMessage(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    method: "chainHead_v1_followEvent",
                    params: {
                      subscription,
                      result
                    }
                  })
                );
            }
          );
          subscriptions.add(subscription);
          onMessage(
            JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: subscription
            })
          );
        } else if (parsed.method === "chainHead_v1_unfollow") {
          const id = parsed.params[0];
          if (subscriptions.has(id)) {
            subscriptions.delete(id);
            await innerProvider.unsubscribe(
              "chainHead_v1_followEvent",
              "chainHead_v1_unfollow",
              id
            );
          }
        } else {
          onMessage(
            JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: await innerProvider.send(parsed.method, parsed.params)
            })
          );
        }
      },
      disconnect: () => {
        nActiveClients--;
        const subscriptionsCopy = [...subscriptions];
        subscriptions.clear();
        Promise.all(
          [...subscriptionsCopy].map(
            (id) => innerProvider.unsubscribe(
              "chainHead_v1_followEvent",
              "chainHead_v1_follow",
              id
            )
          )
        ).catch(utils.noop).then(() => chain.close().then(() => innerProvider.disconnect())).then(() => !nActiveClients ? destroyWorker() : null).catch(utils.noop);
      }
    };
  };
});
const [encAccount] = substrateBindings.Struct({
  nonce: substrateBindings.u32,
  consumers: substrateBindings.u32,
  providers: substrateBindings.u32,
  sufficients: substrateBindings.u32,
  data: substrateBindings.Struct({
    free: substrateBindings.u128,
    reserved: substrateBindings.u128,
    frozen: substrateBindings.u128,
    flags: substrateBindings.u128
  })
});
const getChopsticksClient = async (uri, options = {}) => {
  const client = polkadotApi.createClient(getChopsticksProvider(uri, options));
  const api = client.getUnsafeApi();
  const [aliceStorageKey, ed] = await Promise.all([
    api.query.System.Account.getKey(alice.address),
    api.constants.Balances.ExistentialDeposit()
  ]);
  await client._request("dev_setStorage", [
    [
      [
        aliceStorageKey,
        utils.toHex(
          encAccount({
            nonce: 1,
            consumers: 1,
            providers: 1,
            sufficients: 0,
            data: {
              free: ed * 1000n,
              reserved: 0n,
              frozen: 0n,
              flags: 170141183460469231731687303715884105728n
            }
          })
        )
      ]
    ]
  ]);
  await client._request("dev_newBlock", []);
  return {
    ...client,
    api
  };
};

const Problem = {
  ANCIENT_METADATA: "ANCIENT_METADATA",
  MISSING_MODERN_METADATA: "MISSING_MODERN_METADATA",
  MISSING_RUNTIME_APIS: "MISSING_RUNTIME_APIS",
  DEV_APIS_PRESENT: "DEV_APIS_PRESENT",
  MISSING_CHECK_METADATA_HASH_EXTENSION: "MISSING_CHECK_METADATA_HASH_EXTENSION",
  DIFFERENT_METADATA_HASHES: "DIFFERENT_METADATA_HASHES",
  WRONG_OR_MISSING_METADATA_HASH: "WRONG_OR_MISSING_METADATA_HASH"
};

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
    metadata = substrateBindings.unifyMetadata(substrateBindings.decAnyMetadata(metadataRaw));
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
    const getDiggest = (input) => utils.toHex(merkleizeMetadata.merkleizeMetadata(input, merkelizerProps).digest());
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
      await rxjs.lastValueFrom(
        client.api.tx.System.remark({
          remark: polkadotApi.Binary.fromText("PAPI Rocks!")
        }).signSubmitAndWatch(
          withMetadataHash(alice, merkelizerProps, metadataRaw)
        ).pipe(rxjs.takeWhile((e) => e.type !== "broadcasted"))
      );
    } catch {
      problems.push(Problem.WRONG_OR_MISSING_METADATA_HASH);
    }
    return problems;
  } finally {
    client.destroy();
  }
};

exports.getProblems = getProblems;
//# sourceMappingURL=index.js.map
