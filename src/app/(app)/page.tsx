import PageContent from '@/components/page-content';

export default function TodayPage() {
  const today = new Date().toISOString().split('T')[0];
  return <PageContent date={today} label="Today" />;
}
