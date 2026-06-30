import { lazy, Suspense } from 'react';

import BrandedRouteLoader from '../../components/layout/BrandedRouteLoader';

const LazyChatPageContent = lazy(() => import('./ChatPageContent').then((module) => ({
  default: module.ChatPageContent,
})));

export default function Chat() {
  return (
    <Suspense fallback={<BrandedRouteLoader />}>
      <LazyChatPageContent />
    </Suspense>
  );
}
