// Mock otplib for testing
module.exports = {
  authenticator: {
    check: (token, secret) => {
      // Simplified mock: just accept any token in tests
      return token && token.length === 6;
    },
    generateSecret: () => 'JBSWY3DPEBLW64TMMQ======',
    keyuri: (accountName, issuer, secret) => `otpauth://totp/${accountName}?secret=${secret}`,
  },
};
