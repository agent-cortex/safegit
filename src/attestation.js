import { getAddress, recoverTypedDataAddress } from 'viem';

export async function verifyApprovalSignature({ payload, signer, signature }) {
  try {
    const claimed = getAddress(signer);
    const recovered = getAddress(await recoverTypedDataAddress({
      domain: payload.domain,
      types: payload.types,
      primaryType: payload.primaryType,
      message: payload.message,
      signature
    }));
    if (recovered.toLowerCase() !== claimed.toLowerCase()) {
      return { valid: false, recovered, reason: `Recovered signer ${recovered} does not match claimed signer ${claimed}` };
    }
    return { valid: true, recovered };
  } catch (error) {
    return { valid: false, recovered: null, reason: error.message || String(error) };
  }
}

export async function verifyApprovalThreshold({ payload, signatures, threshold }) {
  const validBySigner = new Map();
  const invalid = [];

  for (const item of signatures || []) {
    const result = await verifyApprovalSignature({ payload, signer: item.signer, signature: item.signature });
    if (result.valid) {
      validBySigner.set(result.recovered.toLowerCase(), { signer: result.recovered, signature: item.signature });
    } else {
      invalid.push({ signer: item.signer, reason: result.reason });
    }
  }

  const validSigners = Array.from(validBySigner.values()).map((item) => item.signer);
  return {
    approved: validSigners.length >= Number(threshold),
    validSigners,
    invalid
  };
}
