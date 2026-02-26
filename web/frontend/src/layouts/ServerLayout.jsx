import { Outlet, useParams, Navigate } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary';

export default function ServerLayout() {
  const { serverId } = useParams();

  if (!serverId) return <Navigate to="/" replace />;

  return (
    <ErrorBoundary>
      <Outlet context={{ serverId }} />
    </ErrorBoundary>
  );
}
