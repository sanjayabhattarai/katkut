import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Sparkles, LogOut, ChevronRight } from 'lucide-react-native';
import PressableScale from './components/PressableScale';
import { colors, radius, space, type } from './theme';
import { getCurrentUser, signOut, AuthUser } from '../services';

export interface SettingsScreenProps {
  onBack: () => void;
  /** open the dedicated Google sign-in / Get Pro screen */
  onGetPro: () => void;
}

export default function SettingsScreen({ onBack, onGetPro }: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  // Re-checks every time this screen mounts — including when returning from LoginScreen after
  // a successful sign-in, since App.tsx unmounts/remounts screens rather than keeping them alive.
  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .finally(() => setCheckingSession(false));
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      setUser(null);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PressableScale hitSlop={12} onPress={onBack} style={styles.backButton}>
          <ChevronLeft size={22} color={colors.text.primary} strokeWidth={2} />
        </PressableScale>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        {checkingSession ? (
          <ActivityIndicator size="small" color={colors.text.muted} />
        ) : user ? (
          <View style={styles.card}>
            {user.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.proIcon}>
                <Sparkles size={22} color={colors.ai.default} strokeWidth={2} />
              </View>
            )}
            <Text style={styles.cardTitle}>{user.name ?? "You're all set"}</Text>
            <Text style={styles.cardSubtitle}>
              Pro is launching in our next version — for now, enjoy full free access. We'd love your
              feedback!
            </Text>
            {user.email && <Text style={styles.accountEmail}>{user.email}</Text>}
            <PressableScale style={styles.signOutButton} onPress={handleSignOut} disabled={signingOut}>
              {signingOut ? (
                <ActivityIndicator size="small" color={colors.text.muted} />
              ) : (
                <>
                  <LogOut size={16} color={colors.text.muted} strokeWidth={2} />
                  <Text style={styles.signOutText}>Sign out</Text>
                </>
              )}
            </PressableScale>
          </View>
        ) : (
          <PressableScale style={styles.card} onPress={onGetPro}>
            <View style={styles.proRow}>
              <View style={styles.proIcon}>
                <Sparkles size={22} color={colors.ai.default} strokeWidth={2} />
              </View>
              <View style={styles.proRowText}>
                <Text style={styles.cardTitle}>Get Pro — free during beta</Text>
                <Text style={styles.cardSubtitleLeft}>Sign in with Google to unlock it</Text>
              </View>
              <ChevronRight size={20} color={colors.text.muted} strokeWidth={2} />
            </View>
          </PressableScale>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.bg.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...type.heading,
    color: colors.text.primary,
  },
  headerSpacer: {
    width: 40,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  card: {
    width: '100%',
    backgroundColor: colors.bg.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  proRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  proRowText: {
    flex: 1,
  },
  proIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.ai.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    marginBottom: space.sm,
    borderWidth: 2,
    borderColor: colors.ai.default,
  },
  cardTitle: {
    ...type.heading,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: 4,
  },
  cardSubtitle: {
    ...type.bodySm,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: space.md,
  },
  cardSubtitleLeft: {
    ...type.bodySm,
    color: colors.text.secondary,
  },
  accountEmail: {
    ...type.bodySm,
    color: colors.text.muted,
    marginBottom: space.md,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  signOutText: {
    ...type.bodySm,
    color: colors.text.muted,
  },
});
