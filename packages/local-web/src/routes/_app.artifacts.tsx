import { createFileRoute } from '@tanstack/react-router';
import { ArtifactsDashboard } from '@/pages/artifacts/ArtifactsDashboard';

export const Route = createFileRoute('/_app/artifacts')({
  component: ArtifactsDashboard,
});
