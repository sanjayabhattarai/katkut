import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  Image,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { X, CheckCircle2, Check, Square, CheckSquare } from 'lucide-react-native';
import PressableScale from './components/PressableScale';
import Button from './components/Button';
import { colors, radius, space, type } from './theme';
import { signInWithGoogle } from '../services';

export interface LoginScreenProps {
  onDone: () => void;
  onSkip: () => void;
}

const FEATURES = [
  'No watermark on your exports',
  'No length or export caps',
];

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

export default function LoginScreen({ onDone, onSkip }: LoginScreenProps) {
  const insets = useSafeAreaInsets();
  const [signingIn, setSigningIn] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earlyAccess, setEarlyAccess] = useState(false);

  async function handleSignIn() {
    setError(null);
    setSigningIn(true);
    try {
      await signInWithGoogle();
      setSucceeded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Close button */}
      <PressableScale
        hitSlop={12}
        onPress={onSkip}
        style={[styles.closeButton, { top: insets.top + space.sm }]}
      >
        <X size={20} color="#FFFFFF" strokeWidth={2} />
      </PressableScale>

      <View style={styles.content}>
        {succeeded ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.centerBlock}>
            <View style={styles.successIcon}>
              <Check size={32} color="#FFFFFF" strokeWidth={3} />
            </View>
            <Text style={styles.title}>You're all set!</Text>
            <Text style={styles.subtitle}>
              Pro features unlocked. Enjoy unlimited exports and premium tools.
            </Text>
            <Button label="Continue" onPress={onDone} style={styles.doneButton} />
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.duration(400)} style={styles.centerBlock}>
            {/* App logo */}
            <Image
              source={require('../assets/katkutai_icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />

            <Text style={styles.title}>Unlock Pro</Text>
            <Text style={styles.subtitle}>
              Sign in with Google to enable professional exports – free during beta.
            </Text>

            {/* Feature list */}
            <View style={styles.features}>
              {FEATURES.map((f) => (
                <View key={f} style={styles.featureRow}>
                  <CheckCircle2 size={20} color="#34C759" strokeWidth={2} />
                  <Text style={styles.featureText}>{f}</Text>
                </View>
              ))}
            </View>

            {/* Early access checkbox */}
            <Pressable
              style={styles.earlyAccessRow}
              onPress={() => setEarlyAccess(!earlyAccess)}
            >
              {earlyAccess ? (
                <CheckSquare size={22} color="#007AFF" strokeWidth={2} />
              ) : (
                <Square size={22} color="#8E8E93" strokeWidth={2} />
              )}
              <Text style={styles.earlyAccessText}>
                Get early access to new features
              </Text>
            </Pressable>

            {/* Google Sign‑In Button – fits content exactly */}
            <PressableScale
              style={[styles.googleButton, signingIn && styles.googleButtonDisabled]}
              onPress={handleSignIn}
              disabled={signingIn}
            >
              {signingIn ? (
                <View style={styles.googleButtonLoading}>
                  <ActivityIndicator size="small" color="#1F1F1F" />
                  <Text style={styles.googleButtonText}>Signing in…</Text>
                </View>
              ) : (
                <View style={styles.googleButtonContent}>
                  <GoogleMark size={20} />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </View>
              )}
            </PressableScale>

            {error && <Text style={styles.errorText}>{error}</Text>}

            {/* Skip link */}
            <PressableScale onPress={onSkip} style={styles.skipButton}>
              <Text style={styles.skipText}>Maybe later</Text>
            </PressableScale>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0B',
  },
  closeButton: {
    position: 'absolute',
    left: space.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  centerBlock: {
    width: '100%',
    alignItems: 'center',
  },
  logo: {
    width: 160,
    height: 54,
    marginBottom: space.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#A1A1A6',
    textAlign: 'center',
    marginBottom: space.xl,
    paddingHorizontal: space.sm,
  },
  features: {
    width: '100%',
    gap: 10,
    marginBottom: space.lg,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  featureText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  earlyAccessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: space.xl,
    paddingVertical: 4,
  },
  earlyAccessText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  googleButton: {
    alignSelf: 'center',
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  googleButtonDisabled: {
    opacity: 0.9,
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  googleButtonLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F1F1F',
    letterSpacing: -0.3,
  },
  errorText: {
    fontSize: 13,
    color: '#FF453A',
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: space.sm,
  },
  skipButton: {
    marginTop: space.lg,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipText: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#34C759',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  doneButton: {
    width: '100%',
    marginTop: space.sm,
  },
});