import { Platform } from 'react-native';
import Purchases, { CustomerInfo, PurchasesError, PURCHASES_ERROR_CODE } from 'react-native-purchases';

const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
// Must exactly match the Entitlement identifier in the RevenueCat dashboard (Entitlements tab) —
// this project's was created as "KatKut AI Pro", not the lowercase "pro" the plan doc suggested.
const PRO_ENTITLEMENT_ID = 'KatKut AI Pro';

let configured = false;

/**
 * Configures the RevenueCat SDK. iOS only — Android/Web stay on the existing Stripe web2app flow
 * (HARD RULE 5 exempts iOS because Apple guideline 3.1.1 forbids steering to external payment).
 * No-ops if the API key isn't set yet, so the rest of the app never has to guard against an
 * unconfigured SDK itself — see doc/KatKut_5_RevenueCat_IAP_Plan.md Phase C6 for where the key
 * comes from.
 */
export function initPurchases(): void {
  if (Platform.OS !== 'ios' || configured || !REVENUECAT_IOS_KEY) return;
  Purchases.configure({ apiKey: REVENUECAT_IOS_KEY });
  configured = true;
}

/**
 * Ties the RevenueCat user to the signed-in Supabase user id. Required before any purchase — the
 * revenuecat-webhook maps `app_user_id` straight to `profiles.id`, so a purchase made under an
 * anonymous RevenueCat id would have nowhere to write.
 */
export async function loginPurchases(supabaseUserId: string): Promise<void> {
  if (!configured) return;
  await Purchases.logIn(supabaseUserId);
}

export async function logoutPurchases(): Promise<void> {
  if (!configured) return;
  await Purchases.logOut();
}

function isProEntitled(customerInfo: CustomerInfo): boolean {
  return customerInfo.entitlements.active[PRO_ENTITLEMENT_ID] !== undefined;
}

/**
 * Local RevenueCat entitlement check, used by entitlement.ts to bridge the gap right after a
 * purchase — the revenuecat-webhook that writes `profiles.is_pro` can lag a few seconds, and
 * without this a user could pay and still see the watermark on their next export.
 */
export async function getLocalProEntitlement(): Promise<boolean> {
  if (!configured) return false;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return isProEntitled(customerInfo);
  } catch {
    return false;
  }
}

/** Presents the native purchase sheet for the default offering's first package. */
export async function purchasePro(): Promise<boolean> {
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.availablePackages[0];
  if (!pkg) throw new Error('Pro subscription is not available right now.');
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return isProEntitled(customerInfo);
}

/** True if `e` is the user dismissing the purchase sheet — not a real error, same treatment as
 * ERR_REQUEST_CANCELED for Apple sign-in in auth.ts. */
export function isPurchaseCancelled(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as PurchasesError).code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
  );
}

/** Apple requires a working Restore Purchases entry point — a missing one is a common rejection. */
export async function restorePurchases(): Promise<boolean> {
  const customerInfo = await Purchases.restorePurchases();
  return isProEntitled(customerInfo);
}
