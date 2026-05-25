import TodoList from '@/components/todo-list';

export default function TomorrowPage() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const tomorrow = d.toISOString().split('T')[0];
  return <TodoList date={tomorrow} label="Tomorrow" />;
}
