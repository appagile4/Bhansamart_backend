/**
 * Payment provider layer for storage recharges.
 *
 * Today there is no payment gateway, so the MOCK provider just records what the vendor submitted
 * (e.g. a bank/eSewa transfer reference) and leaves the recharge PENDING for a super admin to verify.
 * Later: add a real provider (eSewa, Khalti, …) with the same interface and set PAYMENT_PROVIDER in .env.
 * A real provider would return status "PAID" (after its webhook/verify call), and the controller can then
 * apply the recharge automatically instead of waiting for admin approval.
 */

const mockProvider = {
  name: "mock",
  requiresAdminApproval: true,
  /**
   * @param {{ amount: number, currency: string, reference?: string }} input
   * @returns {Promise<{ provider: string, status: "PENDING" | "PAID", reference: string }>}
   */
  async initiate({ reference }) {
    return {
      provider: "mock",
      status: "PENDING",
      reference: (reference || "").trim() || `MOCK-${Date.now()}`,
    };
  },
};

// Future: const esewaProvider = { name: "esewa", requiresAdminApproval: false, async initiate() {…}, async verify() {…} };

const PROVIDERS = { mock: mockProvider };

export const getPaymentProvider = () => PROVIDERS[process.env.PAYMENT_PROVIDER || "mock"] || mockProvider;
