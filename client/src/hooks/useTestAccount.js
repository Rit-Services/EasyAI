import { useQuery } from '@tanstack/react-query';
import { organizationApi } from '@/apis/organizationApi';
import { useAuth } from '@/hooks/useAuth';

// Whether the signed-in user's organisation is a test account (no AVV: uploads,
// invitations and community posting are blocked on the server too). Shares the
// ['organization'] query with AppLayout and Settings.
export function useTestAccount() {
  const { status } = useAuth();
  const { data: org } = useQuery({
    queryKey: ['organization'],
    queryFn: organizationApi.current,
    enabled: status === 'authenticated',
  });
  return { isTest: org?.accountType === 'test' };
}
