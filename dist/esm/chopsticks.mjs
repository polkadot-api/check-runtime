import { createClient } from 'polkadot-api';
import { alice } from './alice.mjs';
import { toHex, noop } from 'polkadot-api/utils';
import { getSyncProvider } from '@polkadot-api/json-rpc-provider-proxy';
import { Struct, u32, u128 } from '@polkadot-api/substrate-bindings';

if (typeof process === "object" && "env" in process)
  process.env.LOG_LEVEL = "fatal";
let nActiveClients = 0;
const getChopsticksProvider = (endpoint, {
  wasm,
  block
} = {}) => getSyncProvider(async () => {
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
        ).catch(noop).then(() => chain.close().then(() => innerProvider.disconnect())).then(() => !nActiveClients ? destroyWorker() : null).catch(noop);
      }
    };
  };
});
const [encAccount] = Struct({
  nonce: u32,
  consumers: u32,
  providers: u32,
  sufficients: u32,
  data: Struct({
    free: u128,
    reserved: u128,
    frozen: u128,
    flags: u128
  })
});
const getChopsticksClient = async (uri, options = {}) => {
  const client = createClient(getChopsticksProvider(uri, options));
  const api = client.getUnsafeApi();
  const [aliceStorageKey, ed] = await Promise.all([
    api.query.System.Account.getKey(alice.address),
    api.constants.Balances.ExistentialDeposit()
  ]);
  await client._request("dev_setStorage", [
    [
      [
        aliceStorageKey,
        toHex(
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

export { getChopsticksClient };
//# sourceMappingURL=chopsticks.mjs.map
