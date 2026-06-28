// Local project persistence — drafts (timelines not yet exported) and the library
// (exported reels). File-system backed (expo-file-system), no server, no native module.
// One JSON index holds every project incl. its EDL + cached analyses so a draft can be
// fully reopened (edit + export) without re-analyzing. See CLAUDE.md (on-device only).
import { Directory, File, Paths } from 'expo-file-system';
import { AnalysisClip, Edl } from '../core';

export type ProjectStatus = 'draft' | 'exported';

export interface Project {
  id: string;
  status: ProjectStatus;
  title: string;
  vibeId: string;
  createdAt: number;
  updatedAt: number;
  durationSec: number;
  clipCount: number;
  thumbUri?: string;
  /** set once the reel has been exported — path to the saved MP4 */
  exportedPath?: string;
  edl: Edl;
  analyses: AnalysisClip[];
}

const DIR = new Directory(Paths.document, 'katkut-projects');
const INDEX = new File(DIR, 'projects.json');

function ensureDir() {
  try {
    if (!DIR.exists) DIR.create({ intermediates: true });
  } catch {
    // already exists / race — ignore
  }
}

async function loadAll(): Promise<Project[]> {
  try {
    if (!INDEX.exists) return [];
    const text = await INDEX.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Project[]) : [];
  } catch {
    return [];
  }
}

async function saveAll(projects: Project[]): Promise<void> {
  ensureDir();
  try {
    if (!INDEX.exists) INDEX.create();
  } catch {
    // exists — ignore
  }
  await INDEX.write(JSON.stringify(projects));
}

function durationOf(edl: Edl): number {
  return edl.timeline.reduce((s, t) => s + Math.max(0, t.out - t.in), 0);
}

function defaultTitle(now: number): string {
  const d = new Date(now);
  return `Reel · ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function makeId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listDrafts(): Promise<Project[]> {
  const all = await loadAll();
  return all.filter((p) => p.status === 'draft').sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listExports(): Promise<Project[]> {
  const all = await loadAll();
  return all.filter((p) => p.status === 'exported').sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | null> {
  const all = await loadAll();
  return all.find((p) => p.id === id) ?? null;
}

export interface SaveDraftInput {
  id?: string;
  vibeId: string;
  edl: Edl;
  analyses: AnalysisClip[];
  title?: string;
  thumbUri?: string;
}

/** Upsert a project as a draft (the app-abandonment auto-save). Returns the stored project. */
export async function saveDraft(input: SaveDraftInput): Promise<Project> {
  const all = await loadAll();
  const now = Date.now();
  const existing = input.id ? all.find((p) => p.id === input.id) : undefined;

  const project: Project = {
    id: existing?.id ?? input.id ?? makeId(),
    // keep it in the library if it was already exported, otherwise it's a draft
    status: existing?.status === 'exported' ? 'exported' : 'draft',
    title: input.title ?? existing?.title ?? defaultTitle(now),
    vibeId: input.vibeId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    durationSec: durationOf(input.edl),
    clipCount: input.edl.timeline.length,
    thumbUri: input.thumbUri ?? existing?.thumbUri,
    exportedPath: existing?.exportedPath,
    edl: input.edl,
    analyses: input.analyses,
  };

  const next = existing ? all.map((p) => (p.id === project.id ? project : p)) : [...all, project];
  await saveAll(next);
  return project;
}

/** Promote a project to the library once its reel is exported. */
export async function markExported(id: string, exportedPath: string): Promise<Project | null> {
  const all = await loadAll();
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const updated: Project = {
    ...all[idx],
    status: 'exported',
    exportedPath,
    updatedAt: Date.now(),
  };
  all[idx] = updated;
  await saveAll(all);
  return updated;
}

export async function deleteProject(id: string): Promise<void> {
  const all = await loadAll();
  await saveAll(all.filter((p) => p.id !== id));
}

/** A fresh project id for a new session — generated up front so the draft auto-save can use it. */
export function newProjectId(): string {
  return makeId();
}
