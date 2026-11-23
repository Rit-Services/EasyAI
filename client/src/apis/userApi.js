import { createApiClient } from '@/config/httpClient';

const http = createApiClient('/users');

export const userApi = {
  updateMe: (data) => http.patch('/me', data).then((r) => r.data.user),
  updatePreferences: (data) => http.patch('/me/preferences', data).then((r) => r.data.preferences),
  updateRole: (id, role) => http.patch(`/${id}/role`, { role }).then((r) => r.data.user),
  remove: (id) => http.delete(`/${id}`).then((r) => r.data),
};
