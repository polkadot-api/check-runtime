import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import { mnemonicToEntropy, DEV_PHRASE, entropyToMiniSecret } from '@polkadot-labs/hdkd-helpers';
import { AccountId } from 'polkadot-api';
import { getPolkadotSigner } from 'polkadot-api/signer';

const entropy = mnemonicToEntropy(DEV_PHRASE);
const derive = sr25519CreateDerive(entropyToMiniSecret(entropy));
const keyPair = derive("//Alice");
const address = AccountId().dec(keyPair.publicKey);
const alice = {
  ...getPolkadotSigner(keyPair.publicKey, "Sr25519", keyPair.sign),
  address
};

export { alice };
//# sourceMappingURL=alice.mjs.map
