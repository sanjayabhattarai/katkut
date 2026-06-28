import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

export interface SplashScreenProps {
  /** called after the brand beat (~1.5s); parent then shows Home */
  onDone: () => void;
}

export default function SplashScreen({ onDone }: SplashScreenProps) {
  const pulse = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.6, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    const t = setTimeout(onDone, 1500);
    return () => {
      loop.stop();
      clearTimeout(t);
    };
  }, [onDone, pulse]);

  const scale = pulse.interpolate({ inputRange: [0.6, 1], outputRange: [0.96, 1.04] });

  return (
    <View style={styles.root}>
      <Animated.View style={{ opacity: pulse, transform: [{ scale }] }}>
        <Text style={styles.logo}>KatKut</Text>
        <Text style={styles.tag}>AI</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  logo: { color: '#fff', fontSize: 44, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  tag: {
    color: '#3478f6',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 6,
    textAlign: 'center',
    marginTop: 4,
  },
});
