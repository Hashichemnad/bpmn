import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { LoadingState } from '@/components/states';

/** Router outlet with a loading state while the next screen's code arrives. */
export function SuspenseOutlet() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Outlet />
    </Suspense>
  );
}
