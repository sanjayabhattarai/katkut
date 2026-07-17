import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Alert, Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { Directory, Paths } from 'expo-file-system';
import * as AppleAuthentication from 'expo-apple-authentication';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  ExternalLink,
  FileText,
  Info,
  LogOut,
  Mail,
  Shield,
  Trash2,
  User,
  UserX,
} from 'lucide-react-native';
import PressableScale from './components/PressableScale';
import { colors, radius, space, type } from './theme';
import {
  deleteAccount,
  getCurrentUser,
  getEntitlement,
  signInWithApple,
  signInWithGoogle,
  signOut,
  AuthUser,
} from '../services';

const MARKETING_SITE_URL = 'https://katkut.app';
const MARKETING_UPGRADE_URL = `${MARKETING_SITE_URL}/upgrade`;
const CONTACT_EMAIL = 'khelset.com@gmail.com';
// Stripe's hosted Customer Portal — lets a Pro member view/cancel their own subscription.
// Stripe handles identity verification (emailed one-time link) itself; we never touch billing
// state directly. This is the TEST MODE portal link (Stripe Dashboard > Test mode > Settings >
// Billing > Customer portal) — swap for the live-mode link before production release.
const STRIPE_CUSTOMER_PORTAL_URL = 'https://billing.stripe.com/p/login/test_7sY28qh13bk88MJctt5sA00';

// Same brand gradient (sampled from the actual app icon) used for the "premium" accent across
// Export/Options/Result/Processing — colors.ai.default is a softer stand-in, not the real logo color.
const BRAND_GRADIENT = ['#9B51E0', '#00C6FF'] as const;
const BRAND_PURPLE = BRAND_GRADIENT[0];

const appVersion = Constants.expoConfig?.version ?? '';
const buildNumber =
  Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode : Constants.expoConfig?.ios?.buildNumber;
const VERSION_LABEL = buildNumber ? `v${appVersion} (Build ${buildNumber})` : `v${appVersion}`;

/** Official Google "G" mark */
function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.617z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
      <Path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" />
      <Path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.581C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </Svg>
  );
}

interface RowItemProps {
  icon: ReactNode;
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  loading?: boolean;
  isLast?: boolean;
}

/** One row in the modular list section — icon-in-box, label, trailing value/chevron/spinner. */
function RowItem({ icon, label, value, onPress, destructive, loading, isLast }: RowItemProps) {
  const inner = (
    <View style={[styles.rowItem, !isLast && styles.rowItemDivider]}>
      <View style={[styles.rowIconWrap, destructive && styles.rowIconWrapDestructive]}>{icon}</View>
      <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}>{label}</Text>
      {loading ? (
        <ActivityIndicator size="small" color={colors.text.muted} />
      ) : value ? (
        <Text style={styles.rowValue}>{value}</Text>
      ) : onPress ? (
        <ChevronRight size={16} color={colors.text.muted} strokeWidth={2} />
      ) : null}
    </View>
  );
  if (!onPress) return inner;
  return (
    <PressableScale onPress={onPress} disabled={loading}>
      {inner}
    </PressableScale>
  );
}

export interface SettingsScreenProps {
  onBack: () => void;
}

export default function SettingsScreen({ onBack }: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Re-checks every time this screen mounts, since App.tsx unmounts/remounts screens rather than
  // keeping them alive.
  useEffect(() => {
    Promise.all([getCurrentUser(), getEntitlement()])
      .then(([u, entitlement]) => {
        setUser(u);
        setIsPro(entitlement.isPro);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  // Checkout/portal links open in the device's actual default browser (Linking.openURL, not
  // WebBrowser.openBrowserAsync's in-app browser tab) — see App Review compliance note on
  // handleUpgrade below. That means the app backgrounds instead of returning a promise we can
  // await-then-recheck, so entitlement is re-checked whenever the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        Promise.all([getCurrentUser(), getEntitlement()]).then(([u, entitlement]) => {
          setUser(u);
          setIsPro(entitlement.isPro);
        });
      }
    });
    return () => sub.remove();
  }, []);

  async function handleSignIn() {
    setSigningIn(true);
    try {
      await signInWithGoogle();
      const [u, entitlement] = await Promise.all([getCurrentUser(), getEntitlement()]);
      setUser(u);
      setIsPro(entitlement.isPro);
    } catch (e) {
      Alert.alert('Sign-in failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSigningIn(false);
    }
  }

  // Apple guideline 4.8 — iOS only (Android has no equivalent requirement and the native module
  // isn't available there). Silently returns without an alert if the user just dismisses the
  // Apple sheet (see signInWithApple's ERR_REQUEST_CANCELED handling).
  async function handleSignInWithApple() {
    setSigningIn(true);
    try {
      await signInWithApple();
      const [u, entitlement] = await Promise.all([getCurrentUser(), getEntitlement()]);
      setUser(u);
      setIsPro(entitlement.isPro);
    } catch (e) {
      Alert.alert('Sign-in failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSigningIn(false);
    }
  }

  // Opens the public marketing site — no uid needed since there's no account yet. Deliberately
  // doesn't mention Pro/pricing in-app (App Store/Play Store review flags native "subscribe here"
  // CTAs with pricing for external web purchases — HARD RULE 5).
  async function handleWebAccount() {
    await Linking.openURL(MARKETING_SITE_URL);
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      setUser(null);
      setIsPro(false);
    } finally {
      setSigningOut(false);
    }
  }

  // Two-step confirmation (irreversible — matches how most apps gate account deletion). The
  // actual deletion happens server-side in marketing/api/delete-account.js, which verifies the
  // caller's own access token rather than trusting a client-supplied id.
  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      isPro
        ? 'This permanently deletes your account and cancels your Pro subscription. This cannot be undone.'
        : 'This permanently deletes your account and all associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Are you absolutely sure?', 'Your account cannot be recovered once deleted.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  setDeletingAccount(true);
                  try {
                    await deleteAccount();
                    setUser(null);
                    setIsPro(false);
                  } catch (e) {
                    Alert.alert('Delete failed', e instanceof Error ? e.message : String(e));
                  } finally {
                    setDeletingAccount(false);
                  }
                },
              },
            ]);
          },
        },
      ]
    );
  }

  // App Review compliance: this must open the device's actual default browser (fully backgrounds
  // the app), not expo-web-browser's openBrowserAsync — that always renders an in-app browser tab
  // (SFSafariViewController / Custom Tabs), which is the opposite of what "external purchase"
  // review guidelines require. Linking.openURL is the one that truly leaves the app.
  async function handleUpgrade() {
    if (!user) return;
    setOpeningCheckout(true);
    try {
      await Linking.openURL(`${MARKETING_UPGRADE_URL}?uid=${encodeURIComponent(user.id)}`);
    } finally {
      setOpeningCheckout(false);
    }
  }

  async function handleManageSubscription() {
    setOpeningPortal(true);
    try {
      await Linking.openURL(STRIPE_CUSTOMER_PORTAL_URL);
    } finally {
      setOpeningPortal(false);
    }
  }

  // Removes everything under the OS cache directory — proxies, rendered photo clips, and
  // in-progress export temp files (all write to Paths.cache — see proxies.ts/photoClips.ts/
  // exportReel.ts). Saved drafts/projects live under Paths.document ('katkut-projects/'), a
  // separate root, so this can never touch them.
  function handleClearCache() {
    Alert.alert(
      'Clear Cache',
      'This removes temporary preview and export files. Your saved projects and drafts are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            setClearingCache(true);
            let removedCount = 0;
            let failedCount = 0;
            let freedBytes = 0;
            try {
              const cacheDir = new Directory(Paths.cache);
              if (cacheDir.exists) {
                for (const entry of cacheDir.list()) {
                  try {
                    freedBytes += entry.size ?? 0;
                    entry.delete();
                    removedCount++;
                  } catch {
                    // best-effort — e.g. a file mid-write from an in-progress export; skip it
                    // rather than aborting the whole clear
                    failedCount++;
                  }
                }
              }
            } finally {
              setClearingCache(false);
            }

            // Concrete before/after proof it actually did something — a silent success here was
            // indistinguishable from a silent failure, which is exactly what made this hard to
            // trust from the UI alone.
            if (removedCount === 0 && failedCount === 0) {
              Alert.alert('Cache Cleared', 'There was nothing to clear — cache was already empty.');
            } else {
              const mb = freedBytes / (1024 * 1024);
              const sizeLabel = mb >= 0.1 ? ` (${mb.toFixed(1)} MB)` : '';
              const failedLabel = failedCount > 0 ? ` ${failedCount} item(s) could not be removed.` : '';
              Alert.alert('Cache Cleared', `Removed ${removedCount} file(s)${sizeLabel}.${failedLabel}`);
            }
          },
        },
      ]
    );
  }

  const aboutRows: RowItemProps[] = [
    {
      icon: <Shield size={16} color={colors.text.secondary} strokeWidth={2} />,
      label: 'Privacy Policy',
      onPress: () => Linking.openURL(`${MARKETING_SITE_URL}/privacy-policy`),
    },
    {
      icon: <FileText size={16} color={colors.text.secondary} strokeWidth={2} />,
      label: 'Terms of Service',
      onPress: () => Linking.openURL(`${MARKETING_SITE_URL}/terms`),
    },
    {
      icon: <Mail size={16} color={colors.text.secondary} strokeWidth={2} />,
      label: 'Contact Us',
      onPress: () => Linking.openURL(`mailto:${CONTACT_EMAIL}`),
    },
    {
      icon: <Info size={16} color={colors.text.secondary} strokeWidth={2} />,
      label: 'App Version',
      value: VERSION_LABEL,
    },
    {
      icon: <Trash2 size={16} color={colors.text.secondary} strokeWidth={2} />,
      label: 'Clear Cache',
      onPress: handleClearCache,
      loading: clearingCache,
    },
    ...(user
      ? [
          {
            icon: <LogOut size={16} color={colors.error} strokeWidth={2} />,
            label: 'Sign Out',
            onPress: handleSignOut,
            destructive: true,
            loading: signingOut,
          },
          {
            icon: <UserX size={16} color={colors.error} strokeWidth={2} />,
            label: 'Delete Account',
            onPress: handleDeleteAccount,
            destructive: true,
            loading: deletingAccount,
          },
        ]
      : []),
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Ambient top glow — same brand gradient used across the redesigned screens */}
      <LinearGradient
        colors={['rgba(155,81,224,0.14)', 'rgba(0,198,255,0.02)']}
        style={styles.backgroundGlow}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <View style={styles.header}>
        <PressableScale hitSlop={12} onPress={onBack} style={styles.backButton}>
          <ChevronLeft size={22} color={colors.text.primary} strokeWidth={2} />
        </PressableScale>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      {checkingSession ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.ai.default} />
        </View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {user ? (
            <View style={[styles.profileCard, isPro && styles.profileCardPro]}>
              <View style={styles.profileRow}>
                {user.avatarUrl ? (
                  <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <User size={24} color={colors.text.primary} strokeWidth={1.5} />
                  </View>
                )}
                <View style={styles.profileInfo}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {user.name ?? 'Creator'}
                  </Text>
                  {user.email && (
                    <View style={styles.emailRow}>
                      <Mail size={12} color={colors.text.muted} />
                      <Text style={styles.emailText} numberOfLines={1}>
                        {user.email}
                      </Text>
                    </View>
                  )}
                </View>
                {isPro && (
                  <View style={styles.proBadge}>
                    <Crown size={12} color="#FFFFFF" />
                    <Text style={styles.proBadgeText}>PRO</Text>
                  </View>
                )}
              </View>

              {isPro ? (
                <PressableScale style={styles.manageButton} onPress={handleManageSubscription} disabled={openingPortal}>
                  <LinearGradient
                    colors={BRAND_GRADIENT}
                    style={StyleSheet.absoluteFill}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  />
                  {openingPortal ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.manageButtonText}>Manage or Cancel Subscription</Text>
                  )}
                </PressableScale>
              ) : (
                <PressableScale style={styles.upgradeButtonShadow} onPress={handleUpgrade} disabled={openingCheckout}>
                  <View style={styles.upgradeButton}>
                    <LinearGradient
                      colors={BRAND_GRADIENT}
                      style={StyleSheet.absoluteFill}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    />
                    {openingCheckout ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.upgradeButtonText}>View Premium Options on Web</Text>
                    )}
                  </View>
                </PressableScale>
              )}
            </View>
          ) : (
            <View style={styles.authCard}>
              <View style={styles.logoContainer}>
                <Image source={require('../assets/katkutai_icon.png')} style={styles.logo} resizeMode="contain" />
              </View>
              <Text style={styles.getProTitle}>Unlock Pro</Text>
              <Text style={styles.getProSubtitle}>Sign in and upgrade to remove the watermark and use the app without ads.</Text>

              <PressableScale
                style={[styles.googleButton, signingIn && styles.googleButtonDisabled]}
                onPress={handleSignIn}
                disabled={signingIn}
              >
                {signingIn ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <View style={styles.googleButtonInner}>
                    <GoogleMark size={20} />
                    <Text style={styles.googleButtonText}>Continue with Google</Text>
                  </View>
                )}
              </PressableScale>

              {Platform.OS === 'ios' && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={radius.md}
                  style={styles.appleButton}
                  onPress={handleSignInWithApple}
                />
              )}

              <PressableScale style={styles.webAccountLink} onPress={handleWebAccount}>
                <Text style={styles.webAccountLinkText}>Go to Web Account</Text>
                <ExternalLink size={13} color={colors.text.muted} strokeWidth={2} />
              </PressableScale>
            </View>
          )}

          <Text style={styles.sectionLabel}>About</Text>
          <View style={styles.rowSection}>
            {aboutRows.map((row, i) => (
              <RowItem key={row.label} {...row} isLast={i === aboutRows.length - 1} />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  backgroundGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  headerTitle: {
    ...type.heading,
    color: colors.text.primary,
  },
  headerSpacer: {
    width: 44,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  body: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
  },

  /* Profile card (signed in — free or Pro) */
  profileCard: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    marginBottom: space.lg,
  },
  profileCardPro: {
    backgroundColor: colors.bg.elevated,
    // Tinted brand-purple border (BRAND_PURPLE at ~30% alpha) to make the Pro state read as
    // distinct/premium — no existing border token covers a colored tint, only neutral white.
    borderColor: 'rgba(155,81,224,0.3)',
    shadowColor: BRAND_PURPLE,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.md,
  },
  profileInfo: {
    flex: 1,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: BRAND_PURPLE,
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.bg.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: BRAND_PURPLE,
  },
  userName: {
    ...type.heading,
    color: colors.text.primary,
    marginBottom: 2,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  emailText: {
    ...type.bodySm,
    color: colors.text.muted,
    flexShrink: 1,
  },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BRAND_PURPLE,
    borderRadius: radius.full,
    paddingVertical: 4,
    paddingHorizontal: space.sm,
    gap: 4,
  },
  proBadgeText: {
    ...type.caption,
    color: '#FFFFFF',
  },
  manageButton: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: space.md,
    overflow: 'hidden',
  },
  manageButtonText: {
    ...type.button,
    color: '#FFFFFF',
  },
  // Shadow needs overflow:visible, but the gradient fill needs overflow:hidden to clip to the
  // rounded corners — split across two layers so both work (elevation alone can't fake this on Android).
  upgradeButtonShadow: {
    width: '100%',
    borderRadius: radius.md,
    shadowColor: BRAND_PURPLE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  upgradeButton: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: space.md,
    overflow: 'hidden',
  },
  upgradeButtonText: {
    ...type.button,
    color: '#FFFFFF',
  },

  /* Not signed in — auth card */
  authCard: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.subtle,
    marginBottom: space.lg,
  },
  logoContainer: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  logo: {
    width: 40,
    height: 40,
  },
  getProTitle: {
    ...type.heading,
    color: colors.text.primary,
    marginBottom: 4,
    textAlign: 'center',
  },
  getProSubtitle: {
    ...type.bodySm,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: space.lg,
  },
  googleButton: {
    width: '100%',
    paddingVertical: space.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  googleButtonDisabled: {
    opacity: 0.7,
  },
  googleButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  googleButtonText: {
    ...type.button,
    color: '#FFFFFF',
  },
  appleButton: {
    width: '100%',
    height: 44,
    marginBottom: space.xs,
  },
  webAccountLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: space.sm,
  },
  webAccountLinkText: {
    ...type.bodySm,
    color: colors.text.muted,
    fontWeight: '600',
  },

  /* Modular row-item list section */
  sectionLabel: {
    ...type.caption,
    color: colors.text.muted,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  rowSection: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    overflow: 'hidden',
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  rowItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  rowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconWrapDestructive: {
    backgroundColor: 'rgba(226,75,74,0.12)',
  },
  rowLabel: {
    ...type.body,
    color: colors.text.primary,
    flex: 1,
  },
  rowLabelDestructive: {
    color: colors.error,
  },
  rowValue: {
    ...type.bodySm,
    color: colors.text.muted,
  },
});
