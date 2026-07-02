import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { 
  Sparkles, 
  FolderOpen, 
  Film, 
  Plus, 
  Clock, 
  Play,
  ChevronRight,
  Grid3X3,
} from 'lucide-react-native';
import { colors, radius, space, type } from './theme';
import PressableScale from './components/PressableScale';
import { listDrafts, listExports, Project } from '../services';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - space.md * 2 - space.sm * 2) / 3;
const CARD_HEIGHT = CARD_WIDTH * (16 / 9);
const HORIZONTAL_CARD_WIDTH = width * 0.4;
const HORIZONTAL_CARD_HEIGHT = HORIZONTAL_CARD_WIDTH * (16 / 9);

export interface HomeScreenProps {
  onNewProject: () => void;
  onOpenDraft: (project: Project) => void;
  onOpenExport: (project: Project) => void;
  loading?: boolean;
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  
  if (h > 0) {
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatDate(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Draft Card Component
interface DraftCardProps {
  project: Project;
  onPress: () => void;
}

function DraftCard({ project, onPress }: DraftCardProps) {
  return (
    <PressableScale style={styles.draftCard} onPress={onPress}>
      <View style={styles.draftThumbnail}>
        {project.thumbUri ? (
          <Image source={{ uri: project.thumbUri }} style={styles.draftImage} />
        ) : (
          <View style={styles.draftPlaceholder}>
            <Film size={24} color="#48484A" strokeWidth={1.5} />
          </View>
        )}
        <View style={styles.draftOverlay}>
          <View style={styles.playButton}>
            <Play size={16} color="#FFFFFF" fill="#FFFFFF" />
          </View>
        </View>
        <View style={styles.draftBadge}>
          <Clock size={10} color="#FF9F0A" />
          <Text style={styles.draftBadgeText}>Draft</Text>
        </View>
      </View>
      <View style={styles.draftInfo}>
        <Text style={styles.draftTitle} numberOfLines={1}>
          {project.vibeId || 'Untitled Project'}
        </Text>
        <Text style={styles.draftMeta}>
          {formatDuration(project.durationSec)} · {formatDate(project.updatedAt)}
        </Text>
      </View>
    </PressableScale>
  );
}

// Export Card Component
interface ExportCardProps {
  project: Project;
  onPress: () => void;
}

function ExportCard({ project, onPress }: ExportCardProps) {
  return (
    <PressableScale style={styles.exportCard} onPress={onPress}>
      {project.thumbUri ? (
        <Image source={{ uri: project.thumbUri }} style={styles.exportImage} />
      ) : (
        <View style={styles.exportPlaceholder}>
          <Film size={20} color="#48484A" strokeWidth={1.5} />
        </View>
      )}
      <View style={styles.exportOverlay}>
        <View style={styles.exportDuration}>
          <Text style={styles.exportDurationText}>
            {formatDuration(project.durationSec)}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

export default function HomeScreen({ onNewProject, onOpenDraft, onOpenExport, loading }: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const [drafts, setDrafts] = useState<Project[]>([]);
  const [exports, setExports] = useState<Project[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadProjects = useCallback(async () => {
    const [d, e] = await Promise.all([listDrafts(), listExports()]);
    setDrafts(d || []);
    setExports(e || []);
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProjects();
    setRefreshing(false);
  }, [loadProjects]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../assets/katkutai_icon.png')}
            style={styles.logoMark}
            resizeMode="contain"
          />
        </View>
        
        <View style={styles.headerRight}>
          <View style={styles.proBadge}>
            <Sparkles size={12} color="#007AFF" />
            <Text style={styles.proBadgeText}>AI</Text>
          </View>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + space.xl }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8E8E93" />
        }
      >
        {/* New Project Button */}
        <PressableScale
          style={[styles.newProjectButton, loading && styles.newProjectDisabled]}
          onPress={onNewProject}
          disabled={loading}
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.loadingText}>Preparing workspace...</Text>
            </View>
          ) : (
            <>
              <View style={styles.newProjectIcon}>
                <Plus size={28} color="#000000" strokeWidth={2.5} />
              </View>
              <View style={styles.newProjectText}>
                <Text style={styles.newProjectTitle}>New Project</Text>
                <Text style={styles.newProjectSubtitle}>
                  Import videos and let AI create your edit
                </Text>
              </View>
              <ChevronRight size={20} color="#8E8E93" />
            </>
          )}
        </PressableScale>

        {/* Drafts Section */}
        {drafts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <FolderOpen size={16} color="#FF9F0A" strokeWidth={2} />
                <Text style={styles.sectionTitle}>In Progress</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{drafts.length}</Text>
                </View>
              </View>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.draftsScroll}
              decelerationRate="fast"
            >
              {drafts.map((project) => (
                <DraftCard
                  key={project.id}
                  project={project}
                  onPress={() => onOpenDraft(project)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Exports Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Film size={16} color="#34C759" strokeWidth={2} />
              <Text style={styles.sectionTitle}>Completed</Text>
              {exports.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{exports.length}</Text>
                </View>
              )}
            </View>
            {exports.length > 0 && (
              <Pressable style={styles.viewAllButton}>
                <Grid3X3 size={14} color="#8E8E93" />
                <Text style={styles.viewAllText}>View All</Text>
              </Pressable>
            )}
          </View>

          {exports.length === 0 ? (
            <View style={styles.emptyState}>
              <Film size={32} color="#48484A" strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>No exports yet</Text>
              <Text style={styles.emptyDescription}>
                Your completed videos will appear here
              </Text>
            </View>
          ) : (
            <View style={styles.exportsGrid}>
              {exports.slice(0, 6).map((project) => (
                <ExportCard
                  key={project.id}
                  project={project}
                  onPress={() => onOpenExport(project)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Empty Drafts State */}
        {drafts.length === 0 && (
          <View style={styles.emptyState}>
            <FolderOpen size={32} color="#48484A" strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Start creating</Text>
            <Text style={styles.emptyDescription}>
              Tap "New Project" to begin your first AI-powered edit
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1C1C1E',
  },
  headerLeft: {},
  logoMark: {
    width: 108,
    height: 36,
  },
  headerRight: {},
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
  },
  proBadgeText: {
    color: '#007AFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  
  // Scroll Content
  scrollContent: {
    paddingHorizontal: space.md,
    paddingTop: space.lg,
  },
  
  // New Project Button
  newProjectButton: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderColor: '#2C2C2E',
    marginBottom: space.xl,
  },
  newProjectDisabled: {
    opacity: 0.6,
  },
  newProjectIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newProjectText: {
    flex: 1,
  },
  newProjectTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  newProjectSubtitle: {
    fontSize: 13,
    color: '#8E8E93',
    lineHeight: 18,
  },
  loadingContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 15,
    color: '#8E8E93',
  },
  
  // Sections
  section: {
    marginBottom: space.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.md,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  countBadge: {
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8E8E93',
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewAllText: {
    fontSize: 13,
    color: '#8E8E93',
  },
  
  // Draft Cards
  draftsScroll: {
    gap: space.sm,
    paddingRight: space.md,
  },
  draftCard: {
    width: HORIZONTAL_CARD_WIDTH,
    gap: 8,
  },
  draftThumbnail: {
    width: '100%',
    height: HORIZONTAL_CARD_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1C1C1E',
    position: 'relative',
  },
  draftImage: {
    width: '100%',
    height: '100%',
  },
  draftPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  draftBadgeText: {
    color: '#FF9F0A',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  draftInfo: {
    gap: 2,
  },
  draftTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  draftMeta: {
    fontSize: 12,
    color: '#8E8E93',
  },
  
  // Export Cards
  exportsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  exportCard: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1C1C1E',
  },
  exportImage: {
    width: '100%',
    height: '100%',
  },
  exportPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  exportDuration: {
    alignSelf: 'flex-end',
  },
  exportDurationText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  
  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2C2C2E',
    borderStyle: 'dashed',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyDescription: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 18,
  },
});