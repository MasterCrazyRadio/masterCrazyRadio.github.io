import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, SafeAreaView, Linking, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Facebook, MessageCircle } from 'lucide-react-native';
import Config from './master-crazy-radio/src/constants/Config';
import Player from './master-crazy-radio/src/components/Player';

export default function App() {
  const openLink = (url) => {
    Linking.openURL(url).catch(err => console.error("Couldn't load page", err));
  };

  return (
    <LinearGradient
      colors={[Config.COLORS.PRIMARY, Config.COLORS.SECONDARY, '#000000']}
      style={styles.container}
    >
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea}>

        <View style={styles.header}>
          <Text style={styles.title}>{Config.STATION_NAME}</Text>
          <Text style={styles.subtitle}>La Radio Que Te Mueve</Text>
        </View>

        <View style={styles.content}>
          <Player />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Follow Us</Text>
          <View style={styles.socialIcons}>
            <TouchableOpacity onPress={() => openLink(Config.SOCIALS.FACEBOOK)} style={styles.iconButton}>
              <Facebook color="#fff" size={24} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => openLink(Config.SOCIALS.WHATSAPP)} style={styles.iconButton}>
              <MessageCircle color="#fff" size={24} />
            </TouchableOpacity>
          </View>
        </View>

      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    marginTop: 60,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: Config.COLORS.TEXT,
    textShadowColor: Config.COLORS.ACCENT,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: Config.COLORS.TEXT_DIM,
    marginTop: 5,
    letterSpacing: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  footer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  footerText: {
    color: Config.COLORS.TEXT_DIM,
    marginBottom: 10,
    fontSize: 12,
  },
  socialIcons: {
    flexDirection: 'row',
    gap: 20,
  },
  iconButton: {
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 50,
  },
});
