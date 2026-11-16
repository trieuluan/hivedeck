import { createFileRoute } from '@tanstack/react-router';
import { RouterPageContainer } from '@/pages/router/RouterPage';

export const Route = createFileRoute('/_app/router')({
  component: RouterPageContainer,
});
