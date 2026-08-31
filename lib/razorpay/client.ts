import Razorpay from "razorpay";

/**
 * Razorpay client construction and configuration checks.
 *
 * Test-mode keys only, from the environment. Nothing in this repo ever holds a
 * live key, and nothing hardcodes any key.
 */

export function isRazorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID?.trim() &&
      process.env.RAZORPAY_KEY_SECRET?.trim(),
  );
}

export function isTestModeKey(keyId: string): boolean {
  return keyId.startsWith("rzp_test_");
}

export type OrderCreateParams = {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
};

export type CreatedOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
};

/**
 * The narrow slice of the SDK this project uses, so the order logic can be
 * tested without a network or a key.
 */
export type RazorpayOrdersApi = {
  create: (params: OrderCreateParams) => Promise<CreatedOrder>;
};

export function createRazorpayOrdersApi(options?: {
  keyId?: string;
  keySecret?: string;
}): RazorpayOrdersApi {
  const key_id = options?.keyId ?? process.env.RAZORPAY_KEY_ID;
  const key_secret = options?.keySecret ?? process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new Error(
      "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set to create orders.",
    );
  }

  if (!isTestModeKey(key_id)) {
    // Bouncer is a demo. A live key here would move real money on an ALLOW.
    throw new Error(
      `Refusing to use a non-test Razorpay key (${key_id.slice(0, 8)}…). Only rzp_test_ keys are permitted.`,
    );
  }

  const client = new Razorpay({ key_id, key_secret });

  return {
    create: async (params) => {
      const order = await client.orders.create({
        amount: params.amount,
        currency: params.currency,
        receipt: params.receipt,
        notes: params.notes,
      });

      return {
        id: String(order.id),
        amount: Number(order.amount),
        currency: String(order.currency),
        receipt: order.receipt ? String(order.receipt) : null,
        status: String(order.status),
      };
    },
  };
}
