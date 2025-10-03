import { merkleizeMetadata } from '@polkadot-api/merkleize-metadata';
import { mergeUint8 } from 'polkadot-api/utils';

const EXTENSION_ID = "CheckMetadataHash";
const withMetadataHash = (signer, info, customMetadata) => {
  return {
    ...signer,
    signTx: async (callData, extensions, metadata, ...rest) => {
      const merkleizer = merkleizeMetadata(customMetadata ?? metadata, info);
      return signer.signTx(
        callData,
        {
          ...extensions,
          [EXTENSION_ID]: {
            identifier: EXTENSION_ID,
            value: Uint8Array.from([1]),
            additionalSigned: mergeUint8([
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

export { withMetadataHash };
//# sourceMappingURL=with-metadata-hash.mjs.map
