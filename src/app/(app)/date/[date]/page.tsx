import TodoList from '@/components/todo-list';

export default async function DatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const label = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
  return <TodoList date={date} label={label} />;
}
