import PageContent from '@/components/page-content';

export default function TomorrowPage() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const tomorrow = d.toISOString().split('T')[0];
  return <PageContent date={tomorrow} label="Tomorrow" />;
}
