export const payments = {
  async request(options) {
    const sdk = await import('./payment-sdk.bundle.js');
    return sdk.requestPayment(options);
  },
};
