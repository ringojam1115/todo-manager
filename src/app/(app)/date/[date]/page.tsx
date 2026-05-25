import PageContent from '@/components/page-content';

export default async function DatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const label = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
  return <PageContent date={date} label={label} />;
}
