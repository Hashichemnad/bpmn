import { Navigate } from 'react-router-dom';
import { PERMISSIONS } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { ObjectLibraryPage } from '@/features/objects/ObjectLibraryPage';

/** IT systems are the application catalogue since Phase 4.3 (D-107); without `ea.read` the plain library stays. */
export function SystemsLibraryRoute() {
  const { can } = useAuth();
  return can(PERMISSIONS.EA_READ) ? (
    <Navigate to="/ea/applications" replace />
  ) : (
    <ObjectLibraryPage key="SYSTEM" type="SYSTEM" />
  );
}
