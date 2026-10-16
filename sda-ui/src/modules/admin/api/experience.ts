import { api } from '@/lib/api/client';
import type {
  ActiveReleasePointer,
  ExperienceDraft,
  ExperienceMetadata,
  ExperienceRelease,
  SaveDraftInput,
} from '../types/experience';

export const experienceAdminApi = {
  listExperiences: () => api.get<ExperienceMetadata[]>('admin/experiences'),

  getExperience: (id: string) => api.get<ExperienceMetadata>(`admin/experiences/${id}`),

  getDraft: (id: string) => api.get<ExperienceDraft>(`admin/experiences/${id}/draft`),

  saveDraft: (id: string, input: SaveDraftInput) =>
    api.put<ExperienceDraft>(`admin/experiences/${id}/draft`, input),

  getRelease: (releaseId: string) =>
    api.get<ExperienceRelease>(`admin/experience-releases/${releaseId}`),

  listReleases: (id: string, limit = 50) =>
    api.get<ExperienceRelease[]>(`admin/experiences/${id}/releases?limit=${limit}`),

  getActiveRelease: (id: string, environment: string) =>
    api.get<ActiveReleasePointer>(
      `admin/experiences/${id}/active-release?environment=${environment}`,
    ),
};

